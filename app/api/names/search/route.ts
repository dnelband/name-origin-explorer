import { NextResponse } from "next/server";
import { listNameLanguages, searchNames } from "@/lib/names";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  if (searchParams.get("meta") === "languages") {
    const languages = await listNameLanguages();
    return NextResponse.json({ languages });
  }

  const q = searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({
      results: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  }

  const language = searchParams.get("lang")?.trim() || null;
  const page = Number(searchParams.get("page") ?? 1);
  const pageSize = Number(searchParams.get("limit") ?? searchParams.get("pageSize") ?? 20);
  const suggestions = searchParams.get("suggestions") === "1";

  const data = await searchNames(q, {
    language,
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 20,
    dedupeLabels: suggestions,
  });

  // Typeahead clients historically expected a bare array
  if (suggestions) {
    return NextResponse.json(data.results);
  }

  return NextResponse.json(data);
}
