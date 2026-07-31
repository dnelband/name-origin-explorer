import { NextResponse } from "next/server";
import {
  FOCUS_MAX_NODES,
  expandNodeHop1,
  getFocusNeighborhood,
} from "@/lib/graph";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const nodeId = searchParams.get("nodeId");
  const hopParam = searchParams.get("hop") ?? "2";

  if (!nodeId) {
    return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
  }

  const maxRaw = Number(searchParams.get("max") ?? FOCUS_MAX_NODES);
  const maxNodes = Number.isFinite(maxRaw)
    ? Math.min(Math.max(1, maxRaw), 60)
    : FOCUS_MAX_NODES;

  if (hopParam === "1") {
    const excludeRaw = searchParams.get("exclude") ?? "";
    const excludeIds = new Set(
      excludeRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const subgraph = await expandNodeHop1(nodeId, excludeIds);
    return NextResponse.json({
      nodes: subgraph.nodes.slice(0, maxNodes),
      edges: subgraph.edges,
    });
  }

  const subgraph = await getFocusNeighborhood(nodeId, maxNodes);
  return NextResponse.json(subgraph);
}
