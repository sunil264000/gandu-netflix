import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { Heart, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { VideoPlayer } from "@/components/VideoPlayer";
import { VideoCard } from "@/components/VideoCard";
import { getVideo, saveProgress, bumpView, listVideos, isFavorite, toggleFavorite } from "@/lib/videos.functions";

export const Route = createFileRoute("/watch/$id")({
  component: Watch, ssr: false,
  head: () => ({ meta: [
    { title: "Watch — Vault" },
    { name: "description", content: "Streaming video." },
    { property: "og:title", content: "Watch — Vault" },
    { property: "og:description", content: "Streaming video." },
  ]}),
});

function fmtBytes(b: number) {
  if (b >= 1e9) return (b / 1e9).toFixed(2) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  return (b / 1e3).toFixed(0) + " KB";
}

function Watch() {
  const nav = useNavigate();
  const { id } = Route.useParams();
  const _get = useServerFn(getVideo);
  const _progress = useServerFn(saveProgress);
  const _bump = useServerFn(bumpView);
  const _related = useServerFn(listVideos);
  const _isFav = useServerFn(isFavorite);
  const _toggleFav = useServerFn(toggleFavorite);
  const [fav, setFav] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => { supabase.auth.getUser().then(({ data }) => { if (!data.user) nav({ to: "/auth" }); else setAuthed(true); }); }, [nav]);

  const video = useQuery({ enabled: authed, queryKey: ["video", id], queryFn: () => _get({ data: { id } }) });
  const related = useQuery({ queryKey: ["related", video.data?.category_id ?? null], queryFn: () => _related({ data: { sort: "new", categoryId: video.data?.category_id ?? null, limit: 12 } }), enabled: authed && !!video.data });

  useEffect(() => { if (authed) _isFav({ data: { videoId: id } }).then((r) => setFav(r.favorited)); }, [_isFav, id, authed]);
  useEffect(() => { if (video.data) _bump({ data: { videoId: id } }).catch(() => {}); }, [video.data?.id, _bump, id]);

  const onProgress = useCallback((pos: number, dur: number) => {
    _progress({ data: { videoId: id, positionSec: pos, completed: dur > 0 && pos / dur > 0.95 } }).catch(() => {});
  }, [_progress, id]);

  const onEnded = useCallback(() => {
    const next = (related.data ?? []).find((v) => v.id !== id);
    if (next) setTimeout(() => nav({ to: "/watch/$id", params: { id: next.id } }), 1200);
  }, [related.data, id, nav]);

  const doToggleFav = async () => {
    const r = await _toggleFav({ data: { videoId: id } });
    setFav(r.favorited);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <AppHeader />
      <main className="max-w-[1600px] mx-auto px-6 py-6">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white mb-4">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>

        {video.isLoading ? (
          <div className="aspect-video w-full rounded-2xl bg-white/5 animate-pulse" />
        ) : video.error || !video.data ? (
          <div className="text-center py-20 text-white/60">Video not found.</div>
        ) : (
          <div className="grid lg:grid-cols-[1fr_360px] gap-6">
            <div>
              {video.data.stream_url && (
                <VideoPlayer
                  src={video.data.stream_url}
                  poster={video.data.thumbnail_url}
                  startAt={video.data.resume_at}
                  onProgress={onProgress}
                  onEnded={onEnded}
                  autoPlay
                />
              )}
              <div className="mt-5 flex items-start gap-4">
                <div className="flex-1">
                  <h1 className="text-2xl font-bold">{video.data.title}</h1>
                  <p className="mt-1 text-sm text-white/50">
                    {video.data.view_count} views · {fmtBytes(video.data.size_bytes)}
                    {video.data.width && video.data.height ? ` · ${video.data.width}×${video.data.height}` : ""}
                  </p>
                </div>
                <button onClick={doToggleFav} className={`flex items-center gap-2 px-4 py-2 rounded-full border transition ${fav ? "bg-red-500/20 border-red-500/50 text-red-400" : "bg-white/5 border-white/10 hover:bg-white/10"}`}>
                  <Heart className={`w-4 h-4 ${fav ? "fill-red-400" : ""}`} />
                  <span className="text-sm">{fav ? "Favorited" : "Favorite"}</span>
                </button>
              </div>
              {video.data.description && (
                <div className="mt-5 p-4 rounded-xl bg-white/5 border border-white/10 whitespace-pre-wrap text-sm text-white/80">
                  {video.data.description}
                </div>
              )}
            </div>

            <aside>
              <h3 className="text-sm uppercase tracking-wider text-white/50 mb-3">Up Next</h3>
              <div className="space-y-3">
                {(related.data ?? []).filter((v) => v.id !== id).slice(0, 10).map((v, i) => (
                  <VideoCard key={v.id} v={v} index={i} />
                ))}
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
