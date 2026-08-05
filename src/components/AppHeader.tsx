import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Search, Home, Library, Shield, Film, Activity, Menu, X, Sparkles } from "lucide-react";

const NAV = [
  { to: "/", label: "Home", icon: Home },
  { to: "/library", label: "Library", icon: Library },
  { to: "/studio", label: "Studio", icon: Sparkles },
  { to: "/uploads", label: "Uploads", icon: Activity },
  { to: "/admin", label: "Admin", icon: Shield },
] as const;


export function AppHeader() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "/" || (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) {
      nav({ to: "/search", search: { q: q.trim() } });
      setMenuOpen(false);
      inputRef.current?.blur();
    }
  };

  const active = (p: string) => (p === "/" ? pathname === "/" : pathname.startsWith(p));
  const linkCls = (p: string) =>
    `relative flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-all duration-300 ${
      active(p)
        ? "bg-white/[0.09] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12)]"
        : "text-white/55 hover:bg-white/[0.05] hover:text-white"
    }`;

  return (
    <header
      className={`sticky top-0 z-40 transition-all duration-300 ${
        scrolled
          ? "border-b border-white/[0.07] bg-black/75 shadow-[0_10px_40px_-24px_rgba(239,68,68,.7)] backdrop-blur-2xl"
          : "border-b border-transparent bg-gradient-to-b from-black/80 to-transparent backdrop-blur-md"
      }`}
    >
      <div
        className={`mx-auto flex max-w-[1600px] items-center gap-3 px-3 transition-all duration-300 sm:gap-5 sm:px-6 ${
          scrolled ? "h-14" : "h-16 sm:h-[68px]"
        }`}
      >
        <Link to="/" className="group flex shrink-0 items-center gap-2.5" onClick={() => setMenuOpen(false)}>
          <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-red-500 to-red-700 shadow-lg shadow-red-600/40 transition-transform duration-300 group-hover:scale-105">
            <Film className="h-4.5 w-4.5 text-white" />
            <span className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/25" />
          </span>
          <span className="hidden text-sm font-black tracking-tight text-white sm:inline sm:text-[15px]">
            GANDU<span className="mx-0.5 text-red-500">·</span>NETFLIX
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} className={linkCls(to)}>
              <Icon className="h-4 w-4" />
              {label}
              {active(to) && (
                <span className="absolute -bottom-px left-1/2 h-px w-8 -translate-x-1/2 bg-gradient-to-r from-transparent via-red-500 to-transparent" />
              )}
            </Link>
          ))}
        </nav>

        <form onSubmit={onSearch} className="ml-auto min-w-0 max-w-xl flex-1">
          <div className="group relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40 transition-colors group-focus-within:text-red-400" />
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search your vault…"
              className="h-10 w-full rounded-full border border-white/[0.08] bg-white/[0.05] pl-10 pr-14 text-sm text-white placeholder-white/35 outline-none transition-all duration-300 focus:border-red-500/50 focus:bg-white/[0.08] focus:shadow-[0_0_0_4px_rgba(239,68,68,.12)]"
            />
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-white/40 sm:block">
              /
            </kbd>
          </div>
        </form>

        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/[0.08] bg-white/[0.04] text-white/80 transition hover:bg-white/10 md:hidden"
          aria-label="Menu"
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {menuOpen && (
        <nav className="flex flex-col gap-1 border-t border-white/[0.07] bg-black/95 px-3 py-3 backdrop-blur-2xl md:hidden">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link key={to} onClick={() => setMenuOpen(false)} to={to} className={linkCls(to)}>
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
