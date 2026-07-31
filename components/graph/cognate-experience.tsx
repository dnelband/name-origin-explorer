"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteLogo } from "@/components/site-logo";
import { LineageCanvas } from "./lineage-canvas";
import { SearchBar } from "./search-bar";

type CognateExperienceProps = {
  initialFocusId: string | null;
  dbConfigured: boolean;
};

export function CognateExperience({
  initialFocusId,
  dbConfigured,
}: CognateExperienceProps) {
  const router = useRouter();
  const [focusId, setFocusId] = useState<string | null>(initialFocusId);

  useEffect(() => {
    setFocusId(initialFocusId);
  }, [initialFocusId]);

  const goTo = useCallback(
    (id: string) => {
      setFocusId(id);
      router.replace(`/?name=${id}`, { scroll: false });
    },
    [router],
  );

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0a0f14]">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 40% 45%, #121820 0%, #0a0f14 70%)",
        }}
      />
      <header className="absolute inset-x-0 top-5 z-30 flex items-center gap-4 px-4 sm:px-6">
        <SiteLogo className="relative z-10 shrink-0 text-base leading-none sm:text-lg" />
        <div className="flex min-w-0 flex-1 justify-center md:px-2">
          <div className="w-full max-w-md">
            <SearchBar onSelect={goTo} dbConfigured={dbConfigured} />
          </div>
        </div>
        {/* Mirror logo width on desktop so the search stays centered in the row */}
        <span
          className="invisible hidden h-[46px] shrink-0 select-none items-center text-base leading-none md:inline-flex sm:text-lg"
          aria-hidden
        >
          NAME <b className="font-semibold">EXPLORER</b>
        </span>
      </header>
      <div className="absolute inset-0 z-0">
        <LineageCanvas focusNameId={focusId} onFocusChange={goTo} />
      </div>
    </div>
  );
}
