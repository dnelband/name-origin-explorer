import { NextResponse } from "next/server";
import { getCognateSubgraph } from "@/lib/graph";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rootId = searchParams.get("rootId");
  const depthParam = searchParams.get("depth");

  if (!rootId) {
    return NextResponse.json({ error: "rootId is required" }, { status: 400 });
  }

  const depth = depthParam === "1" ? 1 : 2;
  const subgraph = await getCognateSubgraph(rootId, depth);

  return NextResponse.json(subgraph);
}
