"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SearchPageFormProps = {
  initialQuery: string;
  initialLang: string;
  languages: string[];
  dbConfigured: boolean;
};

export function SearchPageForm({
  initialQuery,
  initialLang,
  languages,
  dbConfigured,
}: SearchPageFormProps) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [lang, setLang] = useState(initialLang);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = q.trim();
    if (!trimmed) return;
    const sp = new URLSearchParams();
    sp.set("q", trimmed);
    if (lang.trim()) sp.set("lang", lang.trim());
    router.push(`/search?${sp.toString()}`);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search a name…"
        autoComplete="off"
        disabled={!dbConfigured}
        className="min-w-0 flex-1 rounded-full border border-white/15 bg-[#0c1014]/90 px-5 py-3 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/30"
      />
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value)}
        disabled={!dbConfigured}
        aria-label="Language"
        className="rounded-full border border-white/15 bg-[#0c1014]/90 px-4 py-3 text-sm text-white/80 outline-none focus:border-white/30 sm:w-44"
      >
        <option value="">All languages</option>
        {languages.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={!dbConfigured || !q.trim()}
        className="rounded-full border border-white/20 bg-white/10 px-6 py-3 text-sm text-white transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Search
      </button>
    </form>
  );
}
