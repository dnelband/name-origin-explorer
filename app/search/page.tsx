import Link from "next/link";
import { db } from "@/db";
import { listNameLanguages, searchNames } from "@/lib/names";
import { SearchPageForm } from "@/components/search/search-page-form";
import { SiteLogo } from "@/components/site-logo";

export const metadata = {
  title: "Search",
};

type SearchPageProps = {
  searchParams: Promise<{
    q?: string;
    lang?: string;
    page?: string;
  }>;
};

function buildHref(parts: {
  q: string;
  lang?: string;
  page?: number;
}): string {
  const sp = new URLSearchParams();
  if (parts.q) sp.set("q", parts.q);
  if (parts.lang) sp.set("lang", parts.lang);
  if (parts.page && parts.page > 1) sp.set("page", String(parts.page));
  const qs = sp.toString();
  return qs ? `/search?${qs}` : "/search";
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q: qRaw, lang: langRaw, page: pageRaw } = await searchParams;
  const q = qRaw?.trim() ?? "";
  const lang = langRaw?.trim() || undefined;
  const page = Math.max(1, Number(pageRaw) || 1);
  const pageSize = 20;

  const [languages, pageData] = await Promise.all([
    listNameLanguages(),
    q ? searchNames(q, { language: lang, page, pageSize }) : null,
  ]);

  const total = pageData?.total ?? 0;
  const results = pageData?.results ?? [];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  return (
    <div className="min-h-full bg-[#0a0f14] text-white">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 40% 30%, #121820 0%, #0a0f14 70%)",
        }}
      />
      <div className="relative mx-auto w-full max-w-2xl px-5 pb-16 pt-10 sm:px-8">
        <div className="mb-8 flex items-baseline justify-between gap-4">
          <SiteLogo className="text-2xl" />
          <Link
            href="/"
            className="font-sans text-[12px] tracking-wide text-white/40 hover:text-white/70"
          >
            ← Tree
          </Link>
        </div>

        <h1 className="font-serif text-3xl tracking-tight text-white sm:text-4xl">
          Search
        </h1>
        <p className="mt-2 max-w-md font-sans text-sm text-white/45">
          Find a name across languages, then open its lineage tree.
        </p>

        <div className="mt-8">
          <SearchPageForm
            initialQuery={q}
            initialLang={lang ?? ""}
            languages={languages}
            dbConfigured={Boolean(db)}
          />
        </div>

        {!db ? (
          <p className="mt-10 font-sans text-sm text-white/40">
            Set POSTGRES_URL to enable search.
          </p>
        ) : !q ? (
          <p className="mt-10 font-sans text-sm text-white/35">
            Enter a name to see matching results.
          </p>
        ) : (
          <div className="mt-10">
            <p className="mb-4 font-sans text-[12px] tracking-wide text-white/40">
              {total === 0
                ? `No matches for “${q}”`
                : `${total.toLocaleString()} match${total === 1 ? "" : "es"}`}
              {lang ? ` · ${lang}` : ""}
            </p>

            {results.length > 0 ? (
              <ul className="divide-y divide-white/10 border-y border-white/10">
                {results.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/?name=${r.id}`}
                      className="flex items-baseline justify-between gap-4 py-3.5 transition-colors hover:bg-white/[0.03]"
                    >
                      <span className="font-serif text-xl text-white/90">
                        {r.label}
                      </span>
                      <span className="shrink-0 font-sans text-[12px] text-white/35">
                        {[r.language, r.gender].filter(Boolean).join(" · ")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}

            {totalPages > 1 ? (
              <nav
                className="mt-8 flex items-center justify-between gap-4 font-sans text-sm"
                aria-label="Pagination"
              >
                {safePage > 1 ? (
                  <Link
                    href={buildHref({ q, lang, page: safePage - 1 })}
                    className="text-white/55 hover:text-white"
                  >
                    ← Previous
                  </Link>
                ) : (
                  <span className="text-white/20">← Previous</span>
                )}
                <span className="text-white/35">
                  Page {safePage} of {totalPages}
                </span>
                {safePage < totalPages ? (
                  <Link
                    href={buildHref({ q, lang, page: safePage + 1 })}
                    className="text-white/55 hover:text-white"
                  >
                    Next →
                  </Link>
                ) : (
                  <span className="text-white/20">Next →</span>
                )}
              </nav>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
