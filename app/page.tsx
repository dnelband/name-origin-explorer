import Link from "next/link";
import { searchNames } from "@/lib/names";
import { db } from "@/db";

type HomeProps = {
  searchParams: Promise<{ q?: string }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const { q = "" } = await searchParams;
  const query = q.trim();
  const results = query ? await searchNames(query) : [];
  const dbConfigured = Boolean(db);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-16 sm:py-24">
      <header className="flex flex-col gap-3">
        <p className="text-sm tracking-[0.2em] text-muted uppercase">
          Name Origins
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-accent sm:text-5xl">
          Trace a name across languages
        </h1>
        <p className="max-w-xl text-lg text-muted">
          Search etymology and cognates from aggregated Wikidata and Behind the
          Name data.
        </p>
      </header>

      <form action="/" method="get" className="flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="q">
          Search for a name
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Try Maria, Yusuf, or Sophia"
          autoComplete="off"
          className="min-h-12 flex-1 border border-border bg-white px-4 text-base outline-none ring-accent focus:ring-2"
        />
        <button
          type="submit"
          className="min-h-12 bg-accent px-6 text-sm font-medium tracking-wide text-white"
        >
          Search
        </button>
      </form>

      {!dbConfigured && (
        <p className="border border-border bg-white/70 px-4 py-3 text-sm text-muted">
          Database not configured. Add{" "}
          <code className="text-foreground">DATABASE_URL</code> to{" "}
          <code className="text-foreground">.env.local</code> to enable search.
        </p>
      )}

      {query && dbConfigured && (
        <section className="flex flex-col gap-4" aria-live="polite">
          <h2 className="text-sm font-medium tracking-wide text-muted uppercase">
            {results.length} result{results.length === 1 ? "" : "s"} for “
            {query}”
          </h2>
          {results.length === 0 ? (
            <p className="text-muted">No names matched that search.</p>
          ) : (
            <ul className="divide-y divide-border border border-border bg-white/80">
              {results.map((name) => (
                <li key={name.id}>
                  <Link
                    href={`/names/${name.id}`}
                    className="flex items-baseline justify-between gap-4 px-4 py-3 transition-colors hover:bg-white"
                  >
                    <span className="text-lg font-medium text-foreground">
                      {name.label}
                      {name.nativeLabel && name.nativeLabel !== name.label ? (
                        <span className="ml-2 font-normal text-muted">
                          {name.nativeLabel}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-sm text-muted">
                      {[name.language, name.gender].filter(Boolean).join(" · ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
