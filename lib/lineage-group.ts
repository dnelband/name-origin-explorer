import type { LineageTree, TreeEdge, TreeNode, GroupMember } from "./lineage-types";

function buildKidsMap(edges: TreeEdge[]): Map<string, string[]> {
  const kidsOf = new Map<string, string[]>();
  for (const e of edges) {
    const list = kidsOf.get(e.source) ?? [];
    list.push(e.target);
    kidsOf.set(e.source, list);
  }
  return kidsOf;
}

/**
 * Collapse overcrowded sibling sets into "+N more" group nodes.
 * Keep branches with more children; group leaves / sparse branches first.
 */
export function collapseOvercrowdedSiblings(
  tree: LineageTree,
  maxKidsPerParent: number,
): LineageTree {
  if (maxKidsPerParent < 2 || tree.nodes.length === 0) return tree;

  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const kidsOf = buildKidsMap(tree.edges);

  const childCount = (id: string) => (kidsOf.get(id) ?? []).length;
  const removed = new Set<string>();
  const addedNodes: TreeNode[] = [];
  const keptEdges: TreeEdge[] = [];

  const dropSubtree = (id: string, members: GroupMember[]) => {
    if (removed.has(id)) return;
    removed.add(id);
    const node = byId.get(id);
    if (node && node.kind !== "group") {
      members.push({
        id: node.id,
        label: node.label,
        language: node.language,
      });
    }
    for (const c of kidsOf.get(id) ?? []) dropSubtree(c, members);
  };

  const parentIds = [...kidsOf.keys()].sort((a, b) => {
    return Math.abs(byId.get(a)?.depth ?? 0) - Math.abs(byId.get(b)?.depth ?? 0);
  });

  for (const parentId of parentIds) {
    if (removed.has(parentId)) continue;
    const kids = (kidsOf.get(parentId) ?? []).filter((id) => byId.has(id));
    if (kids.length === 0) continue;

    if (kids.length <= maxKidsPerParent) {
      for (const k of kids) keptEdges.push({ source: parentId, target: k });
      continue;
    }

    const parent = byId.get(parentId);
    if (!parent) continue;

    const ranked = [...kids].sort((a, b) => {
      const ca = childCount(a);
      const cb = childCount(b);
      if (cb !== ca) return cb - ca;
      return (byId.get(a)?.label ?? "").localeCompare(byId.get(b)?.label ?? "");
    });

    const keepCount = Math.max(1, maxKidsPerParent - 1);
    const keep = ranked.slice(0, keepCount);
    const overflow = ranked.slice(keepCount);

    for (const k of keep) keptEdges.push({ source: parentId, target: k });

    const members: GroupMember[] = [];
    for (const id of overflow) dropSubtree(id, members);
    if (members.length === 0) continue;

    const sampleDepth = byId.get(keep[0] ?? overflow[0]!)?.depth;
    const kidDepth =
      sampleDepth ??
      (parent.depth === 0 ? 1 : parent.depth + (parent.depth < 0 ? -1 : 1));

    const groupId = `group:${parentId}:${kidDepth}:${members.length}`;
    addedNodes.push({
      id: groupId,
      label: `+${members.length} more`,
      nativeLabel: null,
      language: null,
      gender: null,
      wikidataQid: null,
      depth: kidDepth,
      parentId,
      kind: "group",
      members,
    });
    keptEdges.push({ source: parentId, target: groupId });
  }

  const nodes = [
    ...tree.nodes.filter((n) => !removed.has(n.id)),
    ...addedNodes,
  ];
  const ids = new Set(nodes.map((n) => n.id));
  const edges = keptEdges.filter((e) => ids.has(e.source) && ids.has(e.target));

  return { ...tree, nodes, edges };
}

/**
 * Cap total nodes at each absolute depth so columns stay readable.
 * Prefer grouping leaves, then sparse branches; attach to existing groups when possible.
 */
export function collapseOvercrowdedDepth(
  tree: LineageTree,
  maxPerDepth: number,
): LineageTree {
  if (maxPerDepth < 2 || tree.nodes.length === 0) return tree;

  let current = tree;
  const absDepths = [
    ...new Set(current.nodes.map((n) => Math.abs(n.depth))),
  ]
    .filter((d) => d > 0)
    .sort((a, b) => a - b);

  for (const absDepth of absDepths) {
    current = collapseOneDepth(current, absDepth, maxPerDepth);
  }
  return current;
}

function collapseOneDepth(
  tree: LineageTree,
  absDepth: number,
  maxPerDepth: number,
): LineageTree {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const kidsOf = buildKidsMap(tree.edges);
  const childCount = (id: string) => (kidsOf.get(id) ?? []).length;

  const atDepth = () =>
    [...byId.values()].filter((n) => Math.abs(n.depth) === absDepth);

  if (atDepth().length <= maxPerDepth) return tree;

  const removed = new Set<string>();
  /** parentId → group node being filled */
  const groups = new Map<string, TreeNode>();

  // Seed with any existing group nodes at this depth
  for (const n of atDepth()) {
    if (n.kind === "group" && n.parentId) {
      groups.set(n.parentId, { ...n, members: [...(n.members ?? [])] });
    }
  }

  const dropSubtree = (id: string, members: GroupMember[]) => {
    if (removed.has(id)) return;
    removed.add(id);
    const node = byId.get(id);
    if (node?.kind === "group") {
      members.push(...(node.members ?? []));
    } else if (node) {
      members.push({
        id: node.id,
        label: node.label,
        language: node.language,
      });
    }
    byId.delete(id);
    for (const c of kidsOf.get(id) ?? []) dropSubtree(c, members);
  };

  const absorbIntoGroup = (node: TreeNode) => {
    const parentId = node.parentId;
    if (!parentId) return false;

    let group = groups.get(parentId);
    const members: GroupMember[] = [];
    dropSubtree(node.id, members);
    if (members.length === 0) return false;

    if (!group) {
      group = {
        id: `group:${parentId}:${node.depth}:d`,
        label: "+0 more",
        nativeLabel: null,
        language: null,
        gender: null,
        wikidataQid: null,
        depth: node.depth,
        parentId,
        kind: "group",
        members: [],
      };
      groups.set(parentId, group);
      byId.set(group.id, group);
    }
    group.members = [...(group.members ?? []), ...members];
    group.label = `+${group.members.length} more`;
    byId.set(group.id, group);
    return true;
  };

  let guard = 0;
  while (atDepth().length > maxPerDepth && guard < 200) {
    guard++;
    const candidates = atDepth()
      .filter((n) => n.kind !== "group" && n.parentId)
      .sort((a, b) => {
        const ca = childCount(a.id);
        const cb = childCount(b.id);
        if (ca !== cb) return ca - cb; // leaves first
        const ga = groups.has(a.parentId!) ? 0 : 1;
        const gb = groups.has(b.parentId!) ? 0 : 1;
        if (ga !== gb) return ga - gb; // prefer parents that already have a group
        return a.label.localeCompare(b.label);
      });

    const pick = candidates[0];
    if (!pick) break;
    if (!absorbIntoGroup(pick)) break;
  }

  const nodes = [...byId.values()];
  const ids = new Set(nodes.map((n) => n.id));
  const edges: TreeEdge[] = [];
  for (const e of tree.edges) {
    if (removed.has(e.source) || removed.has(e.target)) continue;
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    edges.push(e);
  }
  for (const group of groups.values()) {
    if (!group.parentId || !ids.has(group.id)) continue;
    if (!edges.some((e) => e.source === group.parentId && e.target === group.id)) {
      edges.push({ source: group.parentId, target: group.id });
    }
  }

  return { ...tree, nodes, edges };
}

/** Expand a group node into its members (client-side). */
export function expandGroupInTree(
  tree: LineageTree,
  groupId: string,
): LineageTree {
  const group = tree.nodes.find((n) => n.id === groupId && n.kind === "group");
  if (!group?.members?.length || !group.parentId) return tree;

  const nodes = tree.nodes.filter((n) => n.id !== groupId);
  const edges = tree.edges.filter(
    (e) => e.source !== groupId && e.target !== groupId,
  );

  for (const m of group.members) {
    if (nodes.some((n) => n.id === m.id)) continue;
    nodes.push({
      id: m.id,
      label: m.label,
      nativeLabel: null,
      language: m.language,
      gender: null,
      wikidataQid: null,
      depth: group.depth,
      parentId: group.parentId,
      kind: "name",
    });
    edges.push({ source: group.parentId, target: m.id });
  }

  return { ...tree, nodes, edges };
}
