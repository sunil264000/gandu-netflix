import type { ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";

/** Cinematic ambient backdrop shared by every page. */
export function Ambience() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute -top-40 -left-32 h-[520px] w-[520px] rounded-full opacity-[0.22] blur-[120px] gn-drift"
why      style={{ background: "radial-gradient(circle,#ef4444,transparent 70%)" }} />
    </div>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

export function PageHeading({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
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
