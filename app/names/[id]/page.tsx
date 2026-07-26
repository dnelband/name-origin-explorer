import Link from "next/link";
import { notFound } from "next/navigation";
import { getNameDetail } from "@/lib/names";

type NamePageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: NamePageProps) {
  const { id } = await params;
  const detail = await getNameDetail(id);
  if (!detail) return { title: "Name not found" };
  return { title: detail.name.label };
}

export default async function NamePage({ params }: NamePageProps) {
  const { id } = await params;
  const detail = await getNameDetail(id);

  if (!detail) notFound();

  const { name, enrichments, cognates } = detail;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-16 sm:py-24">
      <div>
        <Link
          href="/"
          className="text-sm text-muted transition-colors hover:text-foreground"
        >
          ← Search
        </Link>
      </div>

      <header className="flex flex-col gap-2">
        <h1 className="text-4xl font-semibold tracking-tight text-accent sm:text-5xl">
          {name.label}
        </h1>
        {name.nativeLabel && name.nativeLabel !== name.label ? (
          <p className="text-2xl text-muted">{name.nativeLabel}</p>
        ) : null}
        <p className="text-sm text-muted">
          {[name.language, name.gender, name.traditionType]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium tracking-wide text-muted uppercase">
          Enrichment
        </h2>
        {enrichments.length === 0 ? (
          <p className="text-muted">No enrichment text for this name yet.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {enrichments.map((row) => (
              <li
                key={row.id}
                className="border border-border bg-white/80 px-4 py-4"
              >
                <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-sm font-medium tracking-wide uppercase">
                    {row.field}
                  </span>
                  <span className="text-sm text-muted">{row.source}</span>
                  {row.sourceUrl ? (
                    <a
                      href={row.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-accent underline-offset-2 hover:underline"
                    >
                      source
                    </a>
                  ) : null}
                </div>
                <p className="leading-relaxed whitespace-pre-wrap">
                  {row.content}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium tracking-wide text-muted uppercase">
          Cognates
        </h2>
        {cognates.length === 0 ? (
          <p className="text-muted">No cognate links stored for this name.</p>
        ) : (
          <ul className="divide-y divide-border border border-border bg-white/80">
            {cognates.map((cognate) => (
              <li key={cognate.id}>
                <Link
                  href={`/names/${cognate.id}`}
                  className="flex items-baseline justify-between gap-4 px-4 py-3 transition-colors hover:bg-white"
                >
                  <span className="text-lg font-medium">
                    {cognate.label}
                    {cognate.nativeLabel &&
                    cognate.nativeLabel !== cognate.label ? (
                      <span className="ml-2 font-normal text-muted">
                        {cognate.nativeLabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-sm text-muted">
                    {[cognate.language, cognate.gender]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
