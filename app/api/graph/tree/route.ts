import { NextResponse } from "next/server";
import { FEATURED_ROOT_COUNT } from "@/lib/graph-constants";
import { getFeaturedRoots, getLineageTree } from "@/lib/lineage-tree";

/**
 * GET /api/graph/tree?root=<id>&w=&h=
 * GET /api/graph/tree?featured=1&w=&h=          → roots + first tree only (fast paint)
 * GET /api/graph/tree?featured=1&rest=1&w=&h=   → remaining featured trees
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rootId = searchParams.get("root");
  const featured = searchParams.get("featured");
  const rest = searchParams.get("rest");
  const w = Number(searchParams.get("w") ?? 1200);
  const h = Number(searchParams.get("h") ?? 800);
  const viewport = {
    width: Number.isFinite(w) && w > 0 ? w : 1200,
    height: Number.isFinite(h) && h > 0 ? h : 800,
  };

  if (featured === "1" || featured === "true") {
    const roots = await getFeaturedRoots(FEATURED_ROOT_COUNT);

    if (rest === "1" || rest === "true") {
      const remaining = roots.slice(1);
      const trees = (
        await Promise.all(
          remaining.map((r) =>
            getLineageTree(r.id, { viewport, skipResolve: true }),
          ),
        )
      ).filter((t): t is NonNullable<typeof t> => Boolean(t));
      return NextResponse.json({ featured: roots, trees });
    }

    const first = roots[0];
    const tree = first
      ? await getLineageTree(first.id, { viewport, skipResolve: true })
      : null;
    return NextResponse.json({
      featured: roots,
      trees: tree ? [tree] : [],
    });
  }

  if (!rootId) {
    return NextResponse.json(
      { error: "root or featured=1 is required" },
      { status: 400 },
    );
  }

  const tree = await getLineageTree(rootId, { viewport });
  if (!tree) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(tree);
}
