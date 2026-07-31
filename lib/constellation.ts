import { eq, inArray } from "drizzle-orm";
import { db, requireDb } from "@/db";
import { nameRelations, names } from "@/db/schema";
import { ISLAND_COUNT, ISLAND_MAX_NODES } from "@/lib/graph-constants";
import type { GraphEdge, GraphNode } from "@/lib/graph";

export type ConstellationIsland = {
  /** Stable island id (= hub id). */
  id: string;
  hubId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type Constellation = {
  islands: ConstellationIsland[];
};

type AdjEdge = { id: string; confidence: string };

function buildAdj(edgeRows: { a: string; b: string; confidence: string }[]) {
  const adj = new Map<string, AdjEdge[]>();
  const degree = new Map<string, number>();

  const add = (from: string, to: string, confidence: string) => {
    const list = adj.get(from) ?? [];
    list.push({ id: to, confidence });
    adj.set(from, list);
    degree.set(from, (degree.get(from) ?? 0) + 1);
  };

  for (const e of edgeRows) {
    add(e.a, e.b, e.confidence);
    add(e.b, e.a, e.confidence);
  }

  return { adj, degree };
}

function componentMembers(
  seed: string,
  adj: Map<string, AdjEdge[]>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>([seed]);
  const queue = [seed];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    out.push(cur);
    for (const n of adj.get(cur) ?? []) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      queue.push(n.id);
    }
  }
  return out;
}

/** BFS from hub, prefer high-degree neighbors, hard-capped. */
function selectIslandNodeIds(
  hubId: string,
  adj: Map<string, AdjEdge[]>,
  degree: Map<string, number>,
  maxNodes: number,
): string[] {
  const selected: string[] = [hubId];
  const selectedSet = new Set<string>([hubId]);
  const frontier = [...(adj.get(hubId) ?? [])].sort(
    (a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0),
  );

  while (selected.length < maxNodes && frontier.length > 0) {
    const next = frontier.shift()!;
    if (selectedSet.has(next.id)) continue;
    selectedSet.add(next.id);
    selected.push(next.id);

    const neighbors = [...(adj.get(next.id) ?? [])].sort(
      (a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0),
    );
    for (const n of neighbors) {
      if (!selectedSet.has(n.id)) frontier.push(n);
    }
  }

  return selected;
}

function edgesAmong(
  memberIds: Set<string>,
  adj: Map<string, AdjEdge[]>,
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const id of memberIds) {
    for (const n of adj.get(id) ?? []) {
      if (!memberIds.has(n.id)) continue;
      const key = id < n.id ? `${id}|${n.id}` : `${n.id}|${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        source: id,
        target: n.id,
        confidence: n.confidence,
        kind: "cognate",
      });
    }
  }
  return edges;
}

async function loadNameRows(ids: string[]) {
  if (ids.length === 0) return new Map<string, typeof names.$inferSelect>();
  const database = requireDb();
  const rows = await database.select().from(names).where(inArray(names.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

function toNodes(
  hubId: string,
  memberIds: string[],
  byId: Map<string, typeof names.$inferSelect>,
  adj: Map<string, AdjEdge[]>,
): GraphNode[] {
  const depthOf = new Map<string, number>();
  depthOf.set(hubId, 0);
  const q = [hubId];
  while (q.length > 0) {
    const cur = q.shift()!;
    const d = depthOf.get(cur) ?? 0;
    for (const n of adj.get(cur) ?? []) {
      if (!memberIds.includes(n.id) || depthOf.has(n.id)) continue;
      depthOf.set(n.id, d + 1);
      q.push(n.id);
    }
  }

  const nodes: GraphNode[] = [];
  for (const id of memberIds) {
    const row = byId.get(id);
    if (!row) continue;
    nodes.push({
      id: row.id,
      label: row.label,
      nativeLabel: row.nativeLabel,
      language: row.language,
      gender: row.gender,
      wikidataQid: row.wikidataQid,
      depth: Math.min(depthOf.get(id) ?? 2, 2),
      role: "cognate",
    });
  }
  return nodes;
}

async function buildIsland(
  hubId: string,
  memberIds: string[],
  adj: Map<string, AdjEdge[]>,
): Promise<ConstellationIsland | null> {
  const byId = await loadNameRows(memberIds);
  if (!byId.has(hubId)) return null;
  const memberSet = new Set(memberIds);
  return {
    id: hubId,
    hubId,
    nodes: toNodes(hubId, memberIds, byId, adj),
    edges: edgesAmong(memberSet, adj),
  };
}

/**
 * Landing constellation: up to `islandCount` distinct cognate components,
 * each trimmed to `maxPerIsland` nodes around its highest-degree hub.
 */
export async function getConstellation(
  islandCount: number = ISLAND_COUNT,
  maxPerIsland: number = ISLAND_MAX_NODES,
): Promise<Constellation> {
  if (!db) return { islands: [] };
  const database = requireDb();

  const edgeRows = await database
    .select({
      a: nameRelations.nameA,
      b: nameRelations.nameB,
      confidence: nameRelations.confidence,
    })
    .from(nameRelations);

  if (edgeRows.length === 0) return { islands: [] };

  const { adj, degree } = buildAdj(edgeRows);
  const seeds = [...degree.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  const claimed = new Set<string>();
  const planned: { hubId: string; memberIds: string[] }[] = [];

  for (const seed of seeds) {
    if (planned.length >= islandCount) break;
    if (claimed.has(seed)) continue;

    const component = componentMembers(seed, adj);
    for (const id of component) claimed.add(id);

    const hubId = component.reduce(
      (best, id) =>
        (degree.get(id) ?? 0) > (degree.get(best) ?? 0) ? id : best,
      component[0]!,
    );
    const memberIds = selectIslandNodeIds(hubId, adj, degree, maxPerIsland);
    planned.push({ hubId, memberIds });
  }

  const islands: ConstellationIsland[] = [];
  for (const p of planned) {
    const island = await buildIsland(p.hubId, p.memberIds, adj);
    if (island && island.nodes.length > 0) islands.push(island);
  }

  return { islands };
}

/** Single cognate island around a name (for search miss on landing set). */
export async function getIslandForName(
  nameId: string,
  maxPerIsland: number = ISLAND_MAX_NODES,
): Promise<ConstellationIsland | null> {
  if (!db) return null;
  const database = requireDb();

  const [exists] = await database
    .select({ id: names.id })
    .from(names)
    .where(eq(names.id, nameId))
    .limit(1);
  if (!exists) return null;

  const edgeRows = await database
    .select({
      a: nameRelations.nameA,
      b: nameRelations.nameB,
      confidence: nameRelations.confidence,
    })
    .from(nameRelations);

  const { adj, degree } = buildAdj(edgeRows);

  if (!adj.has(nameId) && (degree.get(nameId) ?? 0) === 0) {
    const byId = await loadNameRows([nameId]);
    const row = byId.get(nameId);
    if (!row) return null;
    return {
      id: nameId,
      hubId: nameId,
      nodes: [
        {
          id: row.id,
          label: row.label,
          nativeLabel: row.nativeLabel,
          language: row.language,
          gender: row.gender,
          wikidataQid: row.wikidataQid,
          depth: 0,
          role: "cognate",
        },
      ],
      edges: [],
    };
  }

  const component = componentMembers(nameId, adj);
  const hubId = component.reduce(
    (best, id) =>
      (degree.get(id) ?? 0) > (degree.get(best) ?? 0) ? id : best,
    nameId,
  );

  // Prefer including the searched name even if hub differs.
  let memberIds = selectIslandNodeIds(hubId, adj, degree, maxPerIsland);
  if (!memberIds.includes(nameId)) {
    memberIds = selectIslandNodeIds(nameId, adj, degree, maxPerIsland);
  }

  return buildIsland(memberIds.includes(hubId) ? hubId : nameId, memberIds, adj);
}
