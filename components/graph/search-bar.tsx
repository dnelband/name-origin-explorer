"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export type SearchResult = {
  id: string;
  label: string;
  nativeLabel: string | null;
  language: string | null;
  gender: string | null;
};

type SearchBarProps = {
  onSelect: (id: string) => void;
  dbConfigured: boolean;
};

export function SearchBar({ onSelect, dbConfigured }: SearchBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipRef = useRef(false);
  const genRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    genRef.current += 1;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setOpen(false);
    setResults([]);
    setActiveIndex(0);
  }, []);

  const goToSearchPage = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      skipRef.current = true;
      close();
      setMobileOpen(false);
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    },
    [close, router],
  );

  useEffect(() => {
    if (!query.trim() || !dbConfigured) {
      setResults([]);
      setOpen(false);
      return;
    }
    if (skipRef.current) {
      skipRef.current = false;
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    const gen = ++genRef.current;
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(
        `/api/names/search?q=${encodeURIComponent(query.trim())}&suggestions=1&limit=8`,
      );
      if (!res.ok || gen !== genRef.current) return;
      const data = (await res.json()) as SearchResult[];
      if (gen !== genRef.current) return;
      setResults(data);
      setActiveIndex(0);
      setOpen(true);
    }, 220);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, dbConfigured]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        close();
        setMobileOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [close]);

  const pick = useCallback(
    (result: SearchResult) => {
      skipRef.current = true;
      close();
      setQuery(result.label);
      setMobileOpen(false);
      onSelect(result.id);
    },
    [close, onSelect],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && activeIndex === results.length) {
        goToSearchPage(query);
        return;
      }
      if (open && results[activeIndex]) {
        pick(results[activeIndex]!);
        return;
      }
      goToSearchPage(query);
      return;
    }
    if (e.key === "Escape") {
      close();
      setMobileOpen(false);
      return;
    }
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    }
  };

  const dropdown = (compact: boolean) => {
    if (!open || !query.trim()) return null;
    const seeAllActive = activeIndex === results.length;
    return (
      <ul
        className={
          compact
            ? "max-h-64 overflow-y-auto border-t border-white/10"
            : "absolute top-full right-0 left-0 z-30 mt-2 max-h-64 overflow-y-auto rounded-2xl border border-white/15 bg-[#0c1014]/95 py-1 shadow-lg backdrop-blur-md"
        }
        role="listbox"
      >
        {results.map((result, i) => (
          <li key={result.id} role="option" aria-selected={i === activeIndex}>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(result);
              }}
              className={`flex w-full items-baseline justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                i === activeIndex ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              <span className="font-medium text-white">{result.label}</span>
              <span className="shrink-0 text-[11px] text-white/35">
                {[result.language, result.gender].filter(Boolean).join(" · ")}
              </span>
            </button>
          </li>
        ))}
        <li role="option" aria-selected={seeAllActive}>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              goToSearchPage(query);
            }}
            className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
              seeAllActive ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/5 hover:text-white/80"
            }`}
          >
            See all results for “{query.trim()}”
          </button>
        </li>
      </ul>
    );
  };

  return (
    <div ref={rootRef} className="pointer-events-auto relative z-20 w-full">
      <div className="relative hidden md:block">
        <div className="overflow-hidden rounded-full border border-white/15 bg-[#0c1014]/90 backdrop-blur-md">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => query.trim() && setOpen(true)}
            placeholder="Search a name…"
            autoComplete="off"
            className="w-full bg-transparent px-5 py-3 text-sm text-white placeholder:text-white/35 outline-none"
          />
        </div>
        {dropdown(false)}
      </div>

      {/* Mobile: icon sits on the right of the header search column */}
      <div className="flex justify-end md:hidden">
        {!mobileOpen ? (
          <button
            type="button"
            aria-label="Search"
            onClick={() => setMobileOpen(true)}
            className="flex h-[46px] w-[46px] items-center justify-center rounded-full border border-white/15 bg-[#0c1014]/90 text-white/70 backdrop-blur-md"
          >
            ⌕
          </button>
        ) : (
          <div className="w-full overflow-hidden rounded-2xl border border-white/15 bg-[#0c1014]/95 backdrop-blur-md">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              autoFocus
              placeholder="Search a name…"
              autoComplete="off"
              className="w-full bg-transparent px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none"
            />
            {dropdown(true)}
          </div>
        )}
      </div>

      {!dbConfigured ? (
        <p className="mt-2 text-center text-[11px] text-white/35">
          Set POSTGRES_URL to enable search.
        </p>
      ) : null}
    </div>
  );
}
