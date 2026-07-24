import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { Search, Home, Library, Shield, Film, Activity, Menu, X } from "lucide-react";

export function AppHeader() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) {
      nav({ to: "/search", search: { q: q.trim() } });
      setMenuOpen(false);
    }
  };

  const active = (p: string) => pathname === p || (p !== "/" && pathname.startsWith(p));
  const linkCls = (p: string) =>
    `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
      active(p) ? "bg-white/10 text-white" : "text-white/60 hover:text-white hover:bg-white/5"
    }`;

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-black/70 border-b border-white/5">
      <div className="max-w-[1600px] mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center gap-3 sm:gap-6">
        <Link to="/" className="flex items-center gap-2 group shrink-0" onClick={() => setMenuOpen(false)}>
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl grid place-items-center bg-gradient-to-br from-red-500 to-red-700 shadow-lg shadow-red-500/30">
            <Film className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </div>
          <span className="text-white font-black text-sm sm:text-base tracking-tight bg-gradient-to-r from-white to-white/70 bg-clip-text">
            GANDU<span className="text-red-500">·</span>NETFLIX
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          <Link to="/" className={linkCls("/")}><Home className="w-4 h-4" />Home</Link>
          <Link to="/library" className={linkCls("/library")}><Library className="w-4 h-4" />Library</Link>
          <Link to="/admin" className={linkCls("/admin")}><Shield className="w-4 h-4" />Admin</Link>
          <Link to="/uploads" className={linkCls("/uploads")}><Activity className="w-4 h-4" />Uploads</Link>
        </nav>

        <form onSubmit={onSearch} className="flex-1 max-w-xl ml-auto min-w-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              type="text" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className="w-full h-9 sm:h-10 pl-9 sm:pl-10 pr-3 sm:pr-4 rounded-full bg-white/5 border border-white/10 text-white placeholder-white/40 text-sm outline-none focus:border-red-500/60 focus:bg-white/10 transition-all"
            />
          </div>
        </form>

        {/* Mobile menu button */}
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="md:hidden p-2 rounded-lg text-white/70 hover:bg-white/5"
          aria-label="Menu"
        >
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {menuOpen && (
        <nav className="md:hidden border-t border-white/5 bg-black/90 px-3 py-2 flex flex-col gap-1">
          <Link onClick={() => setMenuOpen(false)} to="/" className={linkCls("/")}><Home className="w-4 h-4" />Home</Link>
          <Link onClick={() => setMenuOpen(false)} to="/library" className={linkCls("/library")}><Library className="w-4 h-4" />Library</Link>
          <Link onClick={() => setMenuOpen(false)} to="/admin" className={linkCls("/admin")}><Shield className="w-4 h-4" />Admin</Link>
          <Link onClick={() => setMenuOpen(false)} to="/uploads" className={linkCls("/uploads")}><Activity className="w-4 h-4" />Uploads</Link>
        </nav>
      )}
    </header>
  );
}
