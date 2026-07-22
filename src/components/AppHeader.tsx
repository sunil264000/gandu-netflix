import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { Search, Home, Library, Shield, Film } from "lucide-react";

export function AppHeader() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) nav({ to: "/search", search: { q: q.trim() } });
  };

  const active = (p: string) => pathname === p || (p !== "/" && pathname.startsWith(p));
  const linkCls = (p: string) =>
    `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
      active(p) ? "bg-white/10 text-white" : "text-white/60 hover:text-white hover:bg-white/5"
    }`;

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-black/60 border-b border-white/5">
      <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center gap-6">
        <Link to="/" className="flex items-center gap-2 group">
          <div className="w-9 h-9 rounded-xl grid place-items-center bg-gradient-to-br from-red-500 to-red-700 shadow-lg shadow-red-500/30">
            <Film className="w-5 h-5 text-white" />
          </div>
          <span className="text-white font-bold text-lg tracking-tight hidden sm:block">Vault</span>
        </Link>

        <nav className="flex items-center gap-1">
          <Link to="/" className={linkCls("/")}><Home className="w-4 h-4" /><span className="hidden sm:inline">Home</span></Link>
          <Link to="/library" className={linkCls("/library")}><Library className="w-4 h-4" /><span className="hidden sm:inline">Library</span></Link>
          <Link to="/admin" className={linkCls("/admin")}><Shield className="w-4 h-4" /><span className="hidden sm:inline">Admin</span></Link>
        </nav>

        <form onSubmit={onSearch} className="flex-1 max-w-xl ml-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              type="text" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search videos..."
              className="w-full h-10 pl-10 pr-4 rounded-full bg-white/5 border border-white/10 text-white placeholder-white/40 text-sm outline-none focus:border-red-500/60 focus:bg-white/10 transition-all"
            />
          </div>
        </form>
      </div>
    </header>
  );
}
