import { canonicalPair } from "../shared/db";
import type { RawCognateEdge } from "./transform";

export type ClosureEdge = { a: string; b: string };

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    const p = this.parent.get(x);
    if (!p || p === x) {
      this.parent.set(x, x);
      return x;
    }
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }

  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }

  components(): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const key of this.parent.keys()) {
      const root = this.find(key);
      const list = groups.get(root) ?? [];
      list.push(key);
      groups.set(root, list);
    }
    return groups;
  }
}

/**
 * Transitive closure per connected component, capped at maxComponentSize.
 * Components larger than the cap keep direct edges only (logged by caller).
 */
export function computeClosure(
  directEdges: RawCognateEdge[],
  maxComponentSize: number,
): { edges: ClosureEdge[]; skippedLargeComponents: number } {
  const uf = new UnionFind();
  const direct: ClosureEdge[] = [];

  for (const edge of directEdges) {
    const [a, b] = canonicalPair(edge.qidA, edge.qidB);
    if (a === b) continue;
    uf.union(a, b);
    direct.push({ a, b });
  }

  const closed = new Map<string, ClosureEdge>();
  const add = (a: string, b: string) => {
    const [x, y] = canonicalPair(a, b);
    if (x === y) return;
    closed.set(`${x}|${y}`, { a: x, b: y });
  };

  for (const edge of direct) add(edge.a, edge.b);

  let skippedLargeComponents = 0;
  for (const members of uf.components().values()) {
    if (members.length <= 1) continue;
    if (members.length > maxComponentSize) {
      skippedLargeComponents++;
      continue;
    }
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        add(members[i], members[j]);
      }
    }
  }

  return { edges: [...closed.values()], skippedLargeComponents };
}
