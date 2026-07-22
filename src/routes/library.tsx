import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { VideoCard, VideoGridSkeleton } from "@/components/VideoCard";
import { listVideos, listCategories } from "@/lib/videos.functions";

export const Route = createFileRoute("/library")({
  component: Library, ssr: false,
  head: () => ({ meta: [
    { title: "Library — Vault" },
    { name: "description", content: "Browse your full video library." },
    { property: "og:title", content: "Library — Vault" },
    { property: "og:description", content: "Browse your full video library." },
  ]}),
});

function Library() {
  const nav = useNavigate();
  const [sort, setSort] = useState<"new" | "az" | "large" | "views">("new");
  const [cat, setCat] = useState<string | null>(null);
  const _list = useServerFn(listVideos);
  const _cats = useServerFn(listCategories);

  useEffect(() => { supabase.auth.getUser().then(({ data }) => { if (!data.user) nav({ to: "/auth" }); }); }, [nav]);

  const cats = useQuery({ queryKey: ["cats"], queryFn: () => _cats() });
  const list = useQuery({
    queryKey: ["library", sort, cat],
    queryFn: () => _list({ data: { sort, categoryId: cat, limit: 60 } }),
  });

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <AppHeader />
      <main className="max-w-[1600px] mx-auto px-6 py-8">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <h1 className="text-2xl font-bold mr-auto">Library</h1>
          <select value={sort} onChange={(e) => setSort(e.target.value as any)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-500/60">
            <option value="new">Newest</option>
            <option value="az">A → Z</option>
            <option value="large">Largest</option>
            <option value="views">Most Watched</option>
          </select>
          <select value={cat ?? ""} onChange={(e) => setCat(e.target.value || null)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-500/60">
            <option value="">All categories</option>
            {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {list.isLoading ? <VideoGridSkeleton count={18} /> : (
          (list.data ?? []).length === 0 ? (
            <p className="text-white/50 py-20 text-center">No videos here yet.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {list.data!.map((v, i) => <VideoCard key={v.id} v={v} index={i} />)}
            </div>
          )
        )}
      </main>
    </div>
  );
}
