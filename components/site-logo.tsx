import Link from "next/link";

type SiteLogoProps = {
  className?: string;
};

export function SiteLogo({ className = "" }: SiteLogoProps) {
  return (
    <Link
      href="/"
      className={[
        "pointer-events-auto inline-flex h-[46px] items-center font-serif tracking-[0.08em] text-white/85 uppercase transition-colors hover:text-white",
        className || "text-lg sm:text-xl",
      ].join(" ")}
    >
      NAME <b className="font-semibold not-italic">EXPLORER</b>
    </Link>
  );
}
