import { CognateExperience } from "@/components/graph/cognate-experience";
import { db, requireDb } from "@/db";
import { names } from "@/db/schema";
import { searchNames } from "@/lib/names";
import { eq } from "drizzle-orm";

type HomeProps = {
  searchParams: Promise<{ name?: string; q?: string }>;
};

async function resolveFocusId(
  nameParam?: string,
  qParam?: string,
): Promise<string | null> {
  if (nameParam && db) {
    const database = requireDb();
    const [row] = await database
      .select({ id: names.id })
      .from(names)
      .where(eq(names.id, nameParam))
      .limit(1);
    if (row) return row.id;
  }

  if (qParam?.trim()) {
    const { results } = await searchNames(qParam.trim(), {
      pageSize: 12,
      dedupeLabels: true,
    });
    return results[0]?.id ?? null;
  }

  return null;
}

export default async function Home({ searchParams }: HomeProps) {
  const { name, q } = await searchParams;
  const initialFocusId = await resolveFocusId(name, q);

  return (
    <CognateExperience
      initialFocusId={initialFocusId}
      dbConfigured={Boolean(db)}
    />
  );
}
