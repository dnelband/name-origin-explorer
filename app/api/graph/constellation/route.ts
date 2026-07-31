import { NextResponse } from "next/server";
import { getConstellation, getIslandForName } from "@/lib/constellation";
import { ISLAND_COUNT, ISLAND_MAX_NODES } from "@/lib/graph-constants";

/** Landing constellation, or a single island via ?name=. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const nameId = searchParams.get("name");

  if (nameId) {
    const island = await getIslandForName(nameId, ISLAND_MAX_NODES);
    if (!island) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ islands: [island], focusNameId: nameId });
  }

  const constellation = await getConstellation(ISLAND_COUNT, ISLAND_MAX_NODES);
  return NextResponse.json(constellation);
}
