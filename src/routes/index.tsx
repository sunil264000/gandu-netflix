import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppHeader } from "@/components/AppHeader";
import { VideoRow, VideoGridSkeleton } from "@/components/VideoCard";
import { listVideos, listContinueWatching, listFavorites } from "@/lib/videos.functions";

export const Route = createFileRoute("/")({
  component: Home,
  ssr: false,
  head: () => ({
    meta: [
      { title: "Vault — Your Private Video Library" },
      { name: "description", content: "Stream your personal video collection with a premium, YouTube-fast experience." },
      { property: "og:title", content: "Vault — Your Private Video Library" },
      { property: "og:description", content: "Stream your personal video collection with a premium, YouTube-fast experience." },
    ],
  }),
});

function Home() {
  const nav = useNavigate();
  const _listVideos = useServerFn(listVideos);
  const _continue = useServerFn(listContinueWatching);
  const _favorites = useServerFn(listFavorites);

  const recent = useQuery({ queryKey: ["home:recent"], queryFn: () => _listVideos({ data: { sort: "new", limit: 12 } }) });
  const continueW = useQuery({ queryKey: ["home:continue"], queryFn: () => _continue() });
  const popular = useQuery({ queryKey: ["home:popular"], queryFn: () => _listVideos({ data: { sort: "views", limit: 12 } }) });
  const favs = useQuery({ queryKey: ["home:favs"], queryFn: () => _favorites() });

  const empty = recent.data && recent.data.length === 0;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <AppHeader />
      <main className="max-w-[1600px] mx-auto px-6 py-8">
        {recent.isLoading ? (
          <VideoGridSkeleton count={12} />
        ) : empty ? (
          <div className="text-center py-24">
            <h1 className="text-3xl font-bold mb-3">Your vault is empty</h1>
            <p className="text-white/60 mb-6">Head to the admin panel to upload your first video.</p>
            <button onClick={() => nav({ to: "/admin" })} className="px-6 py-3 rounded-full bg-red-500 hover:bg-red-600 font-medium transition shadow-lg shadow-red-500/40">Go to Admin</button>
          </div>
        ) : (
          <>
            <VideoRow title="Continue Watching" videos={continueW.data ?? []} />
            <VideoRow title="Recently Added" videos={recent.data ?? []} />
            <VideoRow title="Most Watched" videos={popular.data ?? []} />
            <VideoRow title="Favorites" videos={favs.data ?? []} />
          </>
        )}
      </main>
    </div>
  );
}
