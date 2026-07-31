import { eq, inArray, sql } from "drizzle-orm";
import { db, requireDb } from "@/db";
import { nameLineage, names } from "@/db/schema";
import { FEATURED_ROOT_COUNT } from "@/lib/graph-constants";
import type {
  FeaturedRoot,
  LineageTree,
  TreeEdge,
  TreeNode,
} from "@/lib/lineage-types";
import {
  allocateSides,
  computeViewportCapacity,
  type SideAllocation,
  type ViewportSize,
} from "@/lib/viewport-budget";
import {
  collapseOvercrowdedDepth,
  collapseOvercrowdedSiblings,
} from "@/lib/lineage-group";

export type { FeaturedRoot, LineageTree, TreeEdge, TreeNode };

type NameRow = {
  id: string;
  label: string;
  nativeLabel: string | null;
  language: string | null;
  gender: string | null;
  wikidataQid: string | null;
};

async function loadNames(ids: string[]): Promise<Map<string, NameRow>> {
  const map = new Map<string, NameRow>();
  if (ids.length === 0) return map;
  const database = requireDb();
  const rows = await database
    .select({
      id: names.id,
      label: names.label,
      nativeLabel: names.nativeLabel,
      language: names.language,
      gender: names.gender,
      wikidataQid: names.wikidataQid,
    })
    .from(names)
    .where(inArray(names.id, ids));
  for (const r of rows) map.set(r.id, r);
  return map;
}

async function parentsOf(childIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (childIds.length === 0) return out;
  const database = requireDb();
  const rows = await database
    .select({
      childId: nameLineage.childId,
      parentId: nameLineage.parentId,
    })
    .from(nameLineage)
    .where(inArray(nameLineage.childId, childIds));
  for (const r of rows) {
    const list = out.get(r.childId) ?? [];
    list.push(r.parentId);
    out.set(r.childId, list);
  }
  return out;
}

async function childrenOf(parentIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (parentIds.length === 0) return out;
  const database = requireDb();
  const rows = await database
    .select({
      childId: nameLineage.childId,
      parentId: nameLineage.parentId,
    })
    .from(nameLineage)
    .where(inArray(nameLineage.parentId, parentIds));
  for (const r of rows) {
    const list = out.get(r.parentId) ?? [];
    list.push(r.childId);
    out.set(r.parentId, list);
  }
  return out;
}

/** Out-degree as parent (how many children), one grouped query. */
async function childCounts(ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  for (const id of ids) map.set(id, 0);
  const database = requireDb();
  const rows = await database
    .select({
      id: nameLineage.parentId,
      degree: sql<number>`count(*)::int`,
    })
    .from(nameLineage)
    .where(inArray(nameLineage.parentId, ids))
    .groupBy(nameLineage.parentId);
  for (const r of rows) map.set(r.id, r.degree);
  return map;
}

/** True if a label is a real readable name, not a Wiktionary stub hub. */
function isDisplayableNameLabel(label: string | null | undefined): boolean {
  const s = (label ?? "").trim();
  if (s.length < 2) return false;
  // stubs: "-", "--", "*", "…", etc.
  if (/^[-–—.*·•_…]+$/u.test(s)) return false;
  // must contain at least one letter (any script)
  return /\p{L}/u.test(s);
}

/** Featured etymological roots: highest out-degree, prefer zero parents. */
export async function getFeaturedRoots(
  count: number = FEATURED_ROOT_COUNT,
): Promise<FeaturedRoot[]> {
  if (!db || count < 1) return [];
  const database = requireDb();

  const rows = await database.execute<{
    id: string;
    label: string;
    native_label: string | null;
    parents: number;
  }>(sql`
    SELECT n.id, n.label, n.native_label,
      (
        SELECT COUNT(*)::int FROM name_lineage nl
        WHERE nl.child_id = n.id
      ) AS parents
    FROM (
      SELECT parent_id AS id, COUNT(*)::int AS kids
      FROM name_lineage
      GROUP BY parent_id
      ORDER BY COUNT(*) DESC
      LIMIT ${count * 40}
    ) top
    JOIN names n ON n.id = top.id
    WHERE length(trim(n.label)) >= 2
      AND n.label !~ '^[-–—.*·•_]+$'
      AND n.label ~ '[[:alpha:]]'
    ORDER BY top.kids DESC
  `);

  const list = rows as unknown as {
    id: string;
    label: string;
    native_label: string | null;
    parents: number;
  }[];

  const displayOf = (r: (typeof list)[number]) => {
    const label = r.label?.trim() ?? "";
    const native = r.native_label?.trim() ?? "";
    if (isDisplayableNameLabel(label)) return label;
    if (isDisplayableNameLabel(native)) return native;
    return "";
  };

  const usable = list.filter((r) => displayOf(r));
  const preferred = usable.filter((r) => {
    const name = displayOf(r);
    return (
      Number(r.parents) === 0 &&
      !name.includes(",") &&
      name.split(/\s+/).length <= 2
    );
  });
  const pool = preferred.length >= count ? preferred : usable;
  return pool.slice(0, count).map((r) => ({
    id: r.id,
    label: displayOf(r),
  }));
}

export type LineageTreeOptions = {
  viewport?: ViewportSize;
  allocation?: SideAllocation;
  /** Featured / known-lineage roots can skip twin resolution. */
  skipResolve?: boolean;
};

/**
 * If this id has no lineage, prefer a same-label row that does
 * (Wikidata inventory vs Wiktionary lineage twins).
 */
async function resolveLineageFocus(rootId: string): Promise<string> {
  const database = requireDb();
  const [degree] = await database
    .select({
      n: sql<number>`(
        SELECT COUNT(*)::int FROM ${nameLineage}
        WHERE ${nameLineage.childId} = ${rootId}
           OR ${nameLineage.parentId} = ${rootId}
      )`,
    })
    .from(names)
    .where(eq(names.id, rootId))
    .limit(1);
  if ((degree?.n ?? 0) > 0) return rootId;

  const [focus] = await database
    .select({
      label: names.label,
      language: names.language,
    })
    .from(names)
    .where(eq(names.id, rootId))
    .limit(1);
  if (!focus?.label) return rootId;

  const twins = await database
    .select({ id: names.id })
    .from(names)
    .where(
      sql`lower(${names.label}) = lower(${focus.label})
        AND (
          SELECT COUNT(*)::int FROM ${nameLineage}
          WHERE ${nameLineage.childId} = ${names.id}
             OR ${nameLineage.parentId} = ${names.id}
        ) > 0`,
    )
    .orderBy(
      sql`(
        SELECT COUNT(*)::int FROM ${nameLineage}
        WHERE ${nameLineage.childId} = ${names.id}
           OR ${nameLineage.parentId} = ${names.id}
      ) DESC`,
      sql`(${names.language} ILIKE ${focus.language ?? "english"}) DESC`,
      sql`(${names.wiktionaryKey} IS NOT NULL) DESC`,
    )
    .limit(1);

  return twins[0]?.id ?? rootId;
}

/**
 * Bidirectional etymological tree around focus.
 * Ancestors: depth < 0; focus: 0; descendants: depth > 0.
 * Depth/breadth budgets come from viewport allocation.
 */
export async function getLineageTree(
  rootId: string,
  options: LineageTreeOptions = {},
): Promise<LineageTree | null> {
  if (!db) return null;
  const database = requireDb();
  if (!options.skipResolve) {
    rootId = await resolveLineageFocus(rootId);
  }

  const [root] = await database
    .select({
      id: names.id,
      label: names.label,
      nativeLabel: names.nativeLabel,
      language: names.language,
      gender: names.gender,
      wikidataQid: names.wikidataQid,
    })
    .from(names)
    .where(eq(names.id, rootId))
    .limit(1);
  if (!root) return null;

  const viewport = options.viewport ?? { width: 1200, height: 800 };
  const capacity = computeViewportCapacity(viewport);

  // One hop each way — also tells allocateSides whether sides exist.
  // Avoids walking entire bushy descendant DAGs just for a depth number.
  const [rootKidsMap, rootParentsMap] = await Promise.all([
    childrenOf([root.id]),
    parentsOf([root.id]),
  ]);
  const rootKidIds = rootKidsMap.get(root.id) ?? [];
  const rootParentIds = rootParentsMap.get(root.id) ?? [];

  const allocation =
    options.allocation ??
    allocateSides(
      capacity,
      rootParentIds.length > 0 ? capacity.depthSlots : 0,
      rootKidIds.length > 0 ? capacity.depthSlots : 0,
    );

  const readableKids = Math.min(
    Math.max(3, Math.floor(capacity.breadthSlots * 0.5)),
    6,
  );
  const fetchRoot = Math.min(16, Math.max(allocation.rootFanout, readableKids * 2));
  const fetchBranch = Math.min(
    10,
    Math.max(allocation.branchFanout, readableKids + 2),
  );

  const nodes: TreeNode[] = [
    {
      id: root.id,
      label: root.label,
      nativeLabel: root.nativeLabel,
      language: root.language,
      gender: root.gender,
      wikidataQid: root.wikidataQid,
      depth: 0,
      parentId: null,
      kind: "name",
    },
  ];
  const edges: TreeEdge[] = [];
  const visited = new Set<string>([root.id]);
  const edgeSet = new Set<string>();
  const nodeById = new Map<string, TreeNode>([[root.id, nodes[0]!]]);

  const addEdge = (parent: string, child: string) => {
    const k = `${parent}->${child}`;
    if (edgeSet.has(k)) return;
    edgeSet.add(k);
    edges.push({ source: parent, target: child });
  };

  // —— Descendants: one DB round-trip trio per depth level ——
  let downFrontier = [root.id];
  for (
    let depth = 0;
    depth < allocation.descendantDepth &&
    downFrontier.length > 0 &&
    nodes.length < allocation.maxNodes;
    depth++
  ) {
    const kidsMap =
      depth === 0 ? rootKidsMap : await childrenOf(downFrontier);

    const candidateIds: string[] = [];
    for (const pid of downFrontier) {
      for (const kid of kidsMap.get(pid) ?? []) {
        if (!visited.has(kid)) candidateIds.push(kid);
      }
    }
    const uniqueCandidates = [...new Set(candidateIds)];
    if (uniqueCandidates.length === 0) break;

    const [degrees, nameMap] = await Promise.all([
      childCounts(uniqueCandidates),
      loadNames(uniqueCandidates),
    ]);

    const nextFrontier: string[] = [];
    const cap = depth === 0 ? fetchRoot : fetchBranch;

    for (const parentId of downFrontier) {
      if (nodes.length >= allocation.maxNodes) break;
      const kids = [...(kidsMap.get(parentId) ?? [])].sort(
        (a, b) => (degrees.get(b) ?? 0) - (degrees.get(a) ?? 0),
      );
      let added = 0;
      for (const kidId of kids) {
        if (nodes.length >= allocation.maxNodes || added >= cap) break;
        if (visited.has(kidId)) continue;
        const row = nameMap.get(kidId);
        if (!row) continue;
        visited.add(kidId);
        const nodeDepth = depth + 1;
        const node: TreeNode = {
          id: row.id,
          label: row.label,
          nativeLabel: row.nativeLabel,
          language: row.language,
          gender: row.gender,
          wikidataQid: row.wikidataQid,
          depth: nodeDepth,
          parentId: parentId,
          kind: "name",
        };
        nodes.push(node);
        nodeById.set(node.id, node);
        addEdge(parentId, kidId);
        nextFrontier.push(kidId);
        added++;
      }
    }
    downFrontier = nextFrontier;
  }

  // —— Ancestors: level-batched ——
  let upFrontier = [root.id];
  for (
    let hop = 0;
    hop < allocation.ancestorDepth &&
    upFrontier.length > 0 &&
    nodes.length < allocation.maxNodes;
    hop++
  ) {
    const parentsMap =
      hop === 0 ? rootParentsMap : await parentsOf(upFrontier);

    const candidateIds: string[] = [];
    for (const cid of upFrontier) {
      for (const pid of parentsMap.get(cid) ?? []) {
        if (!visited.has(pid)) candidateIds.push(pid);
      }
    }
    const uniqueCandidates = [...new Set(candidateIds)];
    if (uniqueCandidates.length === 0) break;

    const [degrees, grandParentsMap, nameMap] = await Promise.all([
      childCounts(uniqueCandidates),
      parentsOf(uniqueCandidates),
      loadNames(uniqueCandidates),
    ]);

    const nextFrontier: string[] = [];
    const cap = hop === 0 ? allocation.ancestorFanout : fetchBranch;

    for (const childId of upFrontier) {
      if (nodes.length >= allocation.maxNodes) break;
      const parentIds = [...(parentsMap.get(childId) ?? [])].sort((a, b) => {
        const chain =
          (grandParentsMap.get(b)?.length ?? 0) -
          (grandParentsMap.get(a)?.length ?? 0);
        if (chain !== 0) return chain;
        return (degrees.get(b) ?? 0) - (degrees.get(a) ?? 0);
      });

      let added = 0;
      for (const parentId of parentIds) {
        if (nodes.length >= allocation.maxNodes || added >= cap) break;
        if (visited.has(parentId)) continue;
        const row = nameMap.get(parentId);
        if (!row) continue;
        visited.add(parentId);
        const nodeDepth = -(hop + 1);
        const node: TreeNode = {
          id: row.id,
          label: row.label,
          nativeLabel: row.nativeLabel,
          language: row.language,
          gender: row.gender,
          wikidataQid: row.wikidataQid,
          depth: nodeDepth,
          parentId: null,
          kind: "name",
        };
        nodes.push(node);
        nodeById.set(node.id, node);
        addEdge(parentId, childId);
        const childNode = nodeById.get(childId);
        if (childNode && childNode.depth < 0) {
          childNode.parentId = parentId;
        }
        nextFrontier.push(parentId);
        added++;
      }
    }
    upFrontier = nextFrontier;
  }

  const built: LineageTree = {
    rootId: root.id,
    nodes,
    edges,
    budget: {
      ancestorDepth: allocation.ancestorDepth,
      descendantDepth: allocation.descendantDepth,
      orientation: allocation.orientation,
    },
  };

  return collapseOvercrowdedDepth(
    collapseOvercrowdedSiblings(built, readableKids),
    Math.max(3, capacity.breadthSlots),
  );
}
