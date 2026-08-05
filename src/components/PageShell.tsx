import type { ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";

/** Cinematic ambient backdrop shared by every page. */
export function Ambience() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="gn-drift absolute -top-40 -left-32 h-[520px] w-[520px] rounded-full opacity-[0.20] blur-[120px]"
        style={{ background: "radial-gradient(circle,#ef4444,transparent 70%)" }}
      />
      <div
        className="gn-drift-slow absolute top-40 -right-40 h-[560px] w-[560px] rounded-full opacity-[0.14] blur-[130px]"
        style={{ background: "radial-gradient(circle,#f97316,transparent 70%)" }}
      />
      <div
        className="absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at 50% -10%, rgba(239,68,68,.10), transparent 60%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.03) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse at 50% 0%, black 20%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(ellipse at 50% 0%, black 20%, transparent 70%)",
        }}
      />
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-8 border-t border-white/[0.06] bg-black/40 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col items-start gap-3 px-4 py-8 text-xs text-white/35 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span className="font-semibold tracking-[0.18em] text-white/50">GANDU·NETFLIX</span>
        <span>Private library · 4K/8K streaming · built for one household</span>
      </div>
    </footer>
  );
}

/** Standard page frame: ambience + header + centered content column. */
export function Page({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-[#08080a] text-white">
      <Ambience />
      <div className="relative z-10 flex min-h-screen flex-col">
        <AppHeader />
        <main className={`mx-auto w-full flex-1 ${wide ? "max-w-[1800px]" : "max-w-[1600px]"} px-4 pb-20 pt-6 sm:px-6 sm:pt-8`}>
          {children}
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}


export function PageHeading({
  title,
  subtitle,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-black tracking-tight sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 truncate text-sm text-white/45">{subtitle}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export { AppHeader };
