import { NextResponse } from "next/server";
import { getConstellation } from "@/lib/constellation";
import { ISLAND_COUNT, ISLAND_MAX_NODES } from "@/lib/graph-constants";

/** @deprecated Prefer /api/graph/constellation — kept as alias. */
export async function GET() {
  const constellation = await getConstellation(ISLAND_COUNT, ISLAND_MAX_NODES);
  const hubId = constellation.islands[0]?.hubId ?? null;
  return NextResponse.json({ hubId, ...constellation });
}
