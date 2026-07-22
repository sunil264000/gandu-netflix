import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { VideoCard, VideoGridSkeleton } from "@/components/VideoCard";
import { searchVideos } from "@/lib/videos.functions";

export const Route = createFileRoute("/search")({
  component: Search, ssr: false,
  validateSearch: (s) => z.object({ q: z.string().default("") }).parse(s),
  head: () => ({ meta: [
    { title: "Search — Vault" },
    { name: "description", content: "Search your video library." },
    { property: "og:title", content: "Search — Vault" },
    { property: "og:description", content: "Search your video library." },
  ]}),
});

function Search() {
  const nav = useNavigate();
  const { q } = Route.useSearch();
  const _search = useServerFn(searchVideos);

  const [authed, setAuthed] = useState(false);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => { if (!data.user) nav({ to: "/auth" }); else setAuthed(true); }); }, [nav]);

  const results = useQuery({
    queryKey: ["search", q], queryFn: () => _search({ data: { q } }), enabled: authed && q.length > 0,
  });

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <AppHeader />
      <main className="max-w-[1600px] mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold mb-6">
          {q ? <>Results for <span className="text-red-400">"{q}"</span></> : "Search"}
        </h1>
        {!q ? <p className="text-white/50">Type a query in the header search.</p> :
         results.isLoading ? <VideoGridSkeleton /> :
         (results.data ?? []).length === 0 ? <p className="text-white/50">No matches.</p> :
         <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
           {results.data!.map((v, i) => <VideoCard key={v.id} v={v} index={i} />)}
         </div>}
      </main>
    </div>
  );
}
