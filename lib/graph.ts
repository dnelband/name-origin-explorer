import { eq, inArray, sql } from "drizzle-orm";
import { db, requireDb } from "@/db";
import { nameRelations, names } from "@/db/schema";

export type GraphEdgeKind = "cognate" | "similar_form";

export type GraphNode = {
  id: string;
  label: string;
  nativeLabel: string | null;
  language: string | null;
  gender: string | null;
  wikidataQid: string | null;
  depth: number;
  role?: "cognate" | "lookalike";
};

export type GraphEdge = {
  source: string;
  target: string;
  confidence: string;
  kind: GraphEdgeKind;
};

export type CognateSubgraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

const MAX_TOTAL_NODES = 60;
const MAX_DEPTH_1 = 15;
const MAX_DEPTH_2_PER_PARENT = 5;

type NeighborRow = {
  id: string;
  label: string;
  nativeLabel: string | null;
  language: string | null;
  gender: string | null;
  wikidataQid: string | null;
  confidence: string;
};

async function getNeighborsForNode(nodeId: string): Promise<NeighborRow[]> {
  const database = requireDb();

  const asA = await database
    .select({
      id: names.id,
      label: names.label,
      nativeLabel: names.nativeLabel,
      language: names.language,
      gender: names.gender,
      wikidataQid: names.wikidataQid,
      confidence: nameRelations.confidence,
    })
    .from(nameRelations)
    .innerJoin(names, eq(names.id, nameRelations.nameB))
    .where(eq(nameRelations.nameA, nodeId));

  const asB = await database
    .select({
      id: names.id,
      label: names.label,
      nativeLabel: names.nativeLabel,
      language: names.language,
      gender: names.gender,
      wikidataQid: names.wikidataQid,
      confidence: nameRelations.confidence,
    })
    .from(nameRelations)
    .innerJoin(names, eq(names.id, nameRelations.nameA))
    .where(eq(nameRelations.nameB, nodeId));

  const seen = new Set<string>();
  const merged: NeighborRow[] = [];
  for (const row of [...asA, ...asB]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}

async function getDegreeScores(nodeIds: string[]): Promise<Map<string, number>> {
  if (nodeIds.length === 0) return new Map();

  const database = requireDb();

  const counts = await database
    .select({
      id: names.id,
      degree: sql<number>`(
        SELECT COUNT(*)::int FROM ${nameRelations}
        WHERE ${nameRelations.nameA} = ${names.id} OR ${nameRelations.nameB} = ${names.id}
      )`,
    })
    .from(names)
    .where(inArray(names.id, nodeIds));

  return new Map(counts.map((r) => [r.id, r.degree]));
}

function sortByDegree(
  neighbors: NeighborRow[],
  degrees: Map<string, number>,
): NeighborRow[] {
  return [...neighbors].sort(
    (a, b) => (degrees.get(b.id) ?? 0) - (degrees.get(a.id) ?? 0),
  );
}

function addEdge(
  edges: GraphEdge[],
  edgeSet: Set<string>,
  source: string,
  target: string,
  confidence: string,
  kind: GraphEdgeKind = "cognate",
) {
  const key = source < target ? `${source}|${target}` : `${target}|${source}`;
  if (edgeSet.has(key)) return;
  edgeSet.add(key);
  edges.push({ source, target, confidence, kind });
}

import { FOCUS_MAX_NODES } from "@/lib/graph-constants";

export { FOCUS_MAX_NODES };

const EXPAND_HOP1_LIMIT = 28;
const EXPAND_HOP2_PER_PARENT = 6;
const EXPAND_HOP2_TOTAL = 50;

export async function getMostConnectedNameId(): Promise<string | null> {
  if (!db) return null;
  const database = requireDb();

  const [row] = await database
    .select({
      id: names.id,
      degree: sql<number>`(
        SELECT COUNT(*)::int FROM ${nameRelations}
        WHERE ${nameRelations.nameA} = ${names.id}
           OR ${nameRelations.nameB} = ${names.id}
      )`,
    })
    .from(names)
    .orderBy(
      sql`(
        SELECT COUNT(*)::int FROM ${nameRelations}
        WHERE ${nameRelations.nameA} = ${names.id}
           OR ${nameRelations.nameB} = ${names.id}
      ) DESC`,
    )
    .limit(1);

  return row?.id ?? null;
}

/**
 * Focus neighborhood for the cognate canvas: root + hop-1 + hop-2,
 * highest-degree first, hard-capped at maxNodes (default 30).
 */
export async function getFocusNeighborhood(
  nodeId: string,
  maxNodes: number = FOCUS_MAX_NODES,
): Promise<CognateSubgraph> {
  if (!db || maxNodes < 1) return { nodes: [], edges: [] };
  const database = requireDb();

  const [root] = await database
    .select()
    .from(names)
    .where(eq(names.id, nodeId))
    .limit(1);
  if (!root) return { nodes: [], edges: [] };

  const nodes: GraphNode[] = [toGraphNode(root, 0)];
  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>();
  const visited = new Set<string>([root.id]);

  const hop1Budget = Math.max(0, Math.min(EXPAND_HOP1_LIMIT, maxNodes - 1));
  const hop1Raw = await getNeighborsForNode(root.id);
  const hop1Degrees = await getDegreeScores(hop1Raw.map((n) => n.id));
  const hop1 = sortByDegree(hop1Raw, hop1Degrees).slice(0, hop1Budget);

  for (const n of hop1) {
    if (nodes.length >= maxNodes) break;
    visited.add(n.id);
    nodes.push(toGraphNode(n, 1, "cognate"));
    addEdge(edges, edgeSet, root.id, n.id, n.confidence, "cognate");
  }

  const hop1Cognates = nodes.filter((n) => n.depth === 1 && n.role !== "lookalike");
  for (const parent of hop1Cognates) {
    if (nodes.length >= maxNodes) break;
    const remaining = maxNodes - nodes.length;
    const perParent = Math.min(EXPAND_HOP2_PER_PARENT, remaining);
    if (perParent <= 0) break;

    const hop2Raw = await getNeighborsForNode(parent.id);
    const candidates = hop2Raw.filter((n) => !visited.has(n.id));
    const hop2Degrees = await getDegreeScores(candidates.map((n) => n.id));
    const hop2 = sortByDegree(candidates, hop2Degrees).slice(0, perParent);

    for (const n of hop2) {
      if (nodes.length >= maxNodes) break;
      visited.add(n.id);
      nodes.push(toGraphNode(n, 2, "cognate"));
      addEdge(edges, edgeSet, parent.id, n.id, n.confidence, "cognate");
    }
  }

  // Sparse roots stay sparse in v1 — no lookalike filler.
  return { nodes, edges };
}

function toGraphNode(
  row: {
    id: string;
    label: string;
    nativeLabel: string | null;
    language: string | null;
    gender: string | null;
    wikidataQid?: string | null;
  },
  depth: number,
  role: "cognate" | "lookalike" = "cognate",
): GraphNode {
  return {
    id: row.id,
    label: row.label,
    nativeLabel: row.nativeLabel,
    language: row.language,
    gender: row.gender,
    wikidataQid: row.wikidataQid ?? null,
    depth,
    role,
  };
}

/** One-hop expansion from a node — used for click-to-grow. */
export async function expandNodeHop1(
  nodeId: string,
  excludeIds: Set<string> = new Set(),
): Promise<CognateSubgraph> {
  if (!db) return { nodes: [], edges: [] };
  const database = requireDb();

  const [root] = await database
    .select()
    .from(names)
    .where(eq(names.id, nodeId))
    .limit(1);
  if (!root) return { nodes: [], edges: [] };

  const nodes: GraphNode[] = [toGraphNode(root, 0)];
  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>();
  const visited = new Set<string>([root.id, ...excludeIds]);

  const hop1Raw = await getNeighborsForNode(root.id);
  const hop1Degrees = await getDegreeScores(hop1Raw.map((n) => n.id));
  const hop1 = sortByDegree(
    hop1Raw.filter((n) => !visited.has(n.id)),
    hop1Degrees,
  ).slice(0, EXPAND_HOP1_LIMIT);

  for (const n of hop1) {
    visited.add(n.id);
    nodes.push(toGraphNode(n, 1, "cognate"));
    addEdge(edges, edgeSet, root.id, n.id, n.confidence, "cognate");
  }

  return { nodes, edges };
}

/** Two-hop expansion for initial search bloom. */
export async function expandNodeHop2(
  nodeId: string,
): Promise<CognateSubgraph> {
  if (!db) return { nodes: [], edges: [] };

  const hop1Result = await expandNodeHop1(nodeId);
  const nodes = [...hop1Result.nodes];
  const edges = [...hop1Result.edges];
  const edgeSet = new Set(
    edges.map((e) =>
      e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`,
    ),
  );
  const visited = new Set(nodes.map((n) => n.id));
  const hop1 = nodes.filter((n) => n.depth === 1 && n.role !== "lookalike");
  let hop2Count = 0;

  for (const parent of hop1) {
    if (hop2Count >= EXPAND_HOP2_TOTAL) break;
    const hop2Raw = await getNeighborsForNode(parent.id);
    const candidates = hop2Raw.filter((n) => !visited.has(n.id));
    const hop2Degrees = await getDegreeScores(candidates.map((n) => n.id));
    const hop2 = sortByDegree(candidates, hop2Degrees).slice(
      0,
      EXPAND_HOP2_PER_PARENT,
    );

    for (const n of hop2) {
      if (hop2Count >= EXPAND_HOP2_TOTAL) break;
      visited.add(n.id);
      nodes.push(toGraphNode(n, 2, "cognate"));
      addEdge(edges, edgeSet, parent.id, n.id, n.confidence, "cognate");
      hop2Count++;
    }
  }

  return { nodes, edges };
}

export async function getCognateSubgraph(
  rootId: string,
  depth: 1 | 2,
): Promise<CognateSubgraph> {
  if (!db) return { nodes: [], edges: [] };

  const database = requireDb();

  const [root] = await database
    .select()
    .from(names)
    .where(eq(names.id, rootId))
    .limit(1);

  if (!root) return { nodes: [], edges: [] };

  const nodes: GraphNode[] = [toGraphNode(root, 0)];
  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>();
  const visited = new Set<string>([root.id]);

  const hop1Raw = await getNeighborsForNode(root.id);
  const hop1Degrees = await getDegreeScores(hop1Raw.map((n) => n.id));
  const hop1 = sortByDegree(
    hop1Raw.filter((n) => !visited.has(n.id)),
    hop1Degrees,
  ).slice(0, MAX_DEPTH_1);

  for (const n of hop1) {
    visited.add(n.id);
    nodes.push(toGraphNode(n, 1, "cognate"));
    addEdge(edges, edgeSet, root.id, n.id, n.confidence, "cognate");
  }

  if (depth === 2 && nodes.length < MAX_TOTAL_NODES) {
    for (const parent of hop1) {
      if (nodes.length >= MAX_TOTAL_NODES) break;

      const hop2Raw = await getNeighborsForNode(parent.id);
      const candidates = hop2Raw.filter((n) => !visited.has(n.id));
      const hop2Degrees = await getDegreeScores(candidates.map((n) => n.id));
      const hop2 = sortByDegree(candidates, hop2Degrees).slice(
        0,
        MAX_DEPTH_2_PER_PARENT,
      );

      for (const n of hop2) {
        if (nodes.length >= MAX_TOTAL_NODES) break;
        visited.add(n.id);
        nodes.push(toGraphNode(n, 2, "cognate"));
        addEdge(edges, edgeSet, parent.id, n.id, n.confidence, "cognate");
      }
    }
  }

  return { nodes, edges };
}
