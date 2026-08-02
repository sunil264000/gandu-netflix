import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { Heart, ArrowLeft, Play, Share2, Clock, Info, Headphones, ExternalLink, Copy } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { VideoPlayer } from "@/components/VideoPlayer";
import { TurboDownload } from "@/components/TurboDownload";
import { extractCompatibleAudioFromServer, serverRescueSupported, type TranscodeProgress } from "@/lib/audioTranscode";
import { uploadAny } from "@/lib/storageUpload";

import { getVideo, saveProgress, bumpView, listVideos, isFavorite, toggleFavorite, attachAudioTrack } from "@/lib/videos.functions";


export const Route = createFileRoute("/watch/$slug")({
  component: Watch,
  ssr: false,
  head: () => ({
    meta: [
      { title: "Watch — GANDU NETFLIX" },
      { name: "description", content: "Streaming video." },
      { property: "og:title", content: "Watch — GANDU NETFLIX" },
      { property: "og:description", content: "Streaming video." },
    ],
  }),
});

function fmtBytes(b: number) {
  if (b >= 1e9) return (b / 1e9).toFixed(2) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  return (b / 1e3).toFixed(0) + " KB";
}

function fmtDur(s: number | null | undefined) {
  if (!s || s <= 0) return "";
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

type UpNextItem = {
  id: string;
  slug: string | null;
  title: string;
  duration_sec: number | null;
  thumbnail_url: string | null;
  view_count?: number;
  position_sec?: number;
};

function UpNextCard({ v }: { v: UpNextItem }) {
  const progress = v.position_sec && v.duration_sec ? Math.min(100, (v.position_sec / v.duration_sec) * 100) : 0;
  return (
    <Link to="/watch/$slug" params={{ slug: v.slug ?? v.id }} className="flex gap-3 sm:gap-4 group">
      <div className="relative w-36 sm:w-44 aspect-video rounded-xl overflow-hidden bg-zinc-900 shrink-0 ring-1 ring-white/5 group-hover:ring-red-500/40 transition-all">
        {v.thumbnail_url ? (
          <img src={v.thumbnail_url} alt={v.title} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full grid place-items-center"><Play className="w-6 h-6 text-white/20" /></div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        {v.duration_sec ? (
          <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-[10px] px-1.5 py-0.5 rounded-md font-bold tracking-tighter backdrop-blur-sm text-white">
            {fmtDur(v.duration_sec)}
          </span>
        ) : null}
        {progress > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
            <div className="h-full bg-red-500" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <h3 className="text-sm font-semibold line-clamp-2 leading-snug text-white group-hover:text-red-400 transition-colors">{v.title}</h3>
        {(v.view_count ?? 0) > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <span>{v.view_count} view{v.view_count === 1 ? "" : "s"}</span>
          </div>
        )}
      </div>
    </Link>
  );
}

function Watch() {
  const nav = useNavigate();
  const { slug } = Route.useParams();
  const _get = useServerFn(getVideo);
  const _progress = useServerFn(saveProgress);
  const _bump = useServerFn(bumpView);
  const _related = useServerFn(listVideos);
  const _isFav = useServerFn(isFavorite);
  const _toggleFav = useServerFn(toggleFavorite);
  const [fav, setFav] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [showTip, setShowTip] = useState(true);
  const [copied, setCopied] = useState(false);


  const video = useQuery({ queryKey: ["video", slug], queryFn: () => _get({ data: { id: slug } }) });
  const related = useQuery({
    queryKey: ["related", video.data?.category_id ?? null],
    queryFn: () => _related({ data: { sort: "new", categoryId: video.data?.category_id ?? null, limit: 12 } }),
    enabled: !!video.data,
  });

  const vid = video.data;

  useEffect(() => { if (vid) _isFav({ data: { videoId: vid.id } }).then((r) => setFav(r.favorited)); }, [_isFav, vid]);
  useEffect(() => { if (vid) _bump({ data: { videoId: vid.id } }).catch(() => {}); }, [vid, _bump]);

  const onProgress = useCallback((pos: number, dur: number) => {
    if (!vid) return;
    _progress({ data: { videoId: vid.id, positionSec: pos, completed: dur > 0 && pos / dur > 0.95 } }).catch(() => {});
  }, [_progress, vid]);

  const onEnded = useCallback(() => {
    if (!autoplay || !vid) return;
    const next = (related.data ?? []).find((v) => v.id !== vid.id);
    if (next) setTimeout(() => nav({ to: "/watch/$slug", params: { slug: next.slug ?? next.id } }), 1200);
  }, [related.data, vid, nav, autoplay]);

  const doToggleFav = async () => {
    if (!vid) return;
    const r = await _toggleFav({ data: { videoId: vid.id } });
    setFav(r.favorited);
  };

  // ---- Automatic AAC rescue -------------------------------------------------
  // If the browser reports that it decoded zero audio bytes, the soundtrack is
  // DTS / TrueHD / E-AC-3. Build a companion AAC rendition automatically from
  // the server copy (WebAssembly ffmpeg) and attach it — no manual step.
  const autoFixAudio = useCallback(() => {
    if (!vid || vid.audio_url || aacRunning.current) return;
    if (!serverRescueSupported()) return;
    aacRunning.current = true;
    setAac({ pct: 0, stage: "Preparing audio" });
    (async () => {
      try {
        const ext = ((vid as { storage_path?: string }).storage_path ?? "").split(".").pop() || "mkv";
        const res = await extractCompatibleAudioFromServer({
          streamUrl: `/api/public/videos/stream?id=${encodeURIComponent(vid.id)}`,
          fileName: `${vid.title}.${ext.toLowerCase()}`,
          sizeBytes: Number(vid.size_bytes ?? 0),
          onProgress: (p: TranscodeProgress) =>
            setAac({
              pct: p.pct,
              stage: p.phase === "converting" ? "Converting audio" : p.phase === "loading" ? "Loading engine" : "Reading source",
            }),
        });
        setAac({ pct: 0, stage: "Saving audio" });
        const path = `audio/${vid.id}.${res.ext}`;
        const toUpload = new File([res.blob], `${vid.id}.${res.ext}`, { type: "audio/mp4" });
        await uploadAny("videos", path, toUpload, (p: number) => setAac({ pct: p, stage: "Saving audio" }));
        await _attachAudio({ data: { videoId: vid.id, path, label: res.label } });
        setAac(null);
        video.refetch();
      } catch {
        setAac(null);
      } finally {
        aacRunning.current = false;
      }
    })();
  }, [vid, _attachAudio, video]);


  const upNext = (related.data ?? []).filter((v) => vid && v.id !== vid.id);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-red-500/30">
      <AppHeader />
      <main className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6 lg:py-10">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-500 hover:text-white transition-colors mb-4 sm:mb-6">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </Link>

        {video.isLoading ? (
          <div className="aspect-video w-full rounded-2xl sm:rounded-3xl bg-white/5 animate-pulse" />
        ) : video.error || !vid ? (
          <div className="text-center py-20 text-white/60">Video not found.</div>
        ) : (
          <div className="grid grid-cols-12 gap-4 sm:gap-6 lg:gap-10 items-start">
            <div className="col-span-12 lg:col-span-8 space-y-5 sm:space-y-8">
              <div className="relative">
                <div aria-hidden className="pointer-events-none absolute -inset-4 sm:-inset-8 rounded-[2rem] bg-gradient-to-tr from-red-500/20 via-red-600/5 to-transparent blur-3xl opacity-60" />
                <div className="relative aspect-video bg-black rounded-2xl sm:rounded-3xl overflow-hidden shadow-[0_32px_64px_-16px_rgba(0,0,0,0.7)] ring-1 ring-white/10">
                  {vid.stream_url && (
                    <VideoPlayer
                      src={vid.stream_url}
                      poster={vid.thumbnail_url}
                      startAt={vid.resume_at}
                      onProgress={onProgress}
                      onEnded={onEnded}
                      autoPlay
                      audioSrc={vid.audio_url}
                      onNoAudio={autoFixAudio}
                      audioLabel={(vid as { audio_label?: string | null }).audio_label ?? null}
                      playlistUrl={vid.playlist_url}
                    />
                  )}
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="flex items-start gap-2 text-[11px] text-zinc-400 bg-zinc-900/60 border border-white/5 rounded-lg px-3 py-2">
                    <Headphones className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-400" />
                    <p className="flex-1 leading-relaxed">
                      <span className="font-semibold text-white">Lossless audio:</span> browsers can't decode
                      DTS/TrueHD/Atmos. Open the original in a desktop player — nothing is re-encoded.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={vid.playlist_url}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold uppercase tracking-wider transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Play in VLC
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        const abs = new URL(vid.stream_url ?? "", window.location.origin).toString();
                        navigator.clipboard?.writeText(abs).then(() => setCopied(true)).catch(() => {});
                        setTimeout(() => setCopied(false), 1600);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800/70 hover:bg-zinc-700 border border-zinc-700/60 text-zinc-200 text-[11px] font-bold uppercase tracking-wider transition"
                    >
                      <Copy className="w-3.5 h-3.5" /> {copied ? "Copied" : "Copy stream URL"}
                    </button>
                    <TurboDownload
                      videoId={vid.id}
                      sizeBytes={Number(vid.size_bytes ?? 0)}
                      fileName={`${vid.title}.${(((vid as { storage_path?: string }).storage_path ?? "").split(".").pop() || "mp4").toLowerCase()}`}
                    />
                  </div>

                </div>
                {showTip && (
                  <div className="mt-2 flex items-start gap-2 text-[11px] text-zinc-400 bg-zinc-900/60 border border-white/5 rounded-lg px-3 py-2">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-400" />
                    <p className="flex-1">
                      <span className="font-semibold text-white">Live captions:</span> enable{" "}
                      <span className="text-white">chrome://settings/accessibility → Live Caption</span> for auto-generated subtitles on any video.
                    </p>
                    <button onClick={() => setShowTip(false)} className="text-zinc-500 hover:text-white text-xs">✕</button>
                  </div>
                )}

              </div>

              <div className="space-y-4 sm:space-y-6">
                <div className="flex flex-col gap-3">
                  <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight leading-tight text-white break-words">
                    {vid.title}
                  </h1>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs sm:text-sm font-medium text-zinc-400">
                    <span>{vid.view_count} view{vid.view_count === 1 ? "" : "s"}</span>
                    <span className="w-1 h-1 rounded-full bg-zinc-700" />
                    <span>{fmtBytes(vid.size_bytes)}</span>
                    {vid.width && vid.height ? (
                      <>
                        <span className="w-1 h-1 rounded-full bg-zinc-700" />
                        <span className="px-2 py-0.5 rounded-md bg-zinc-900 ring-1 ring-white/10 text-[10px] sm:text-xs font-semibold text-zinc-300">
                          {vid.width}×{vid.height}
                        </span>
                      </>
                    ) : null}
                    {vid.duration_sec ? (
                      <>
                        <span className="w-1 h-1 rounded-full bg-zinc-700" />
                        <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{fmtDur(vid.duration_sec)}</span>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3 py-4 sm:py-6 border-y border-zinc-800/60">
                  <button
                    onClick={doToggleFav}
                    className={`flex items-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 rounded-full font-semibold text-sm transition-all group border ${
                      fav
                        ? "bg-red-500/15 border-red-500/50 text-red-300 hover:bg-red-500/25"
                        : "bg-zinc-800/50 border-zinc-700/50 text-zinc-200 hover:bg-zinc-800"
                    }`}
                  >
                    <Heart className={`w-4 h-4 transition-colors ${fav ? "fill-red-400 text-red-400" : "text-zinc-400 group-hover:text-red-400"}`} />
                    {fav ? "Favorited" : "Favorite"}
                  </button>
                  <button
                    onClick={() => {
                      const url = typeof window !== "undefined" ? window.location.href : "";
                      if (navigator.share) navigator.share({ title: vid.title, url }).catch(() => {});
                      else if (url) navigator.clipboard?.writeText(url).catch(() => {});
                    }}
                    className="p-2 sm:p-2.5 rounded-full bg-zinc-800/50 border border-zinc-700/50 hover:bg-zinc-800 transition-all text-zinc-200"
                    aria-label="Share"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                </div>

                {vid.description && (
                  <div className="p-4 sm:p-5 rounded-2xl bg-zinc-900/40 border border-white/5 whitespace-pre-wrap text-sm text-zinc-300 leading-relaxed">
                    {vid.description}
                  </div>
                )}
              </div>
            </div>

            <aside className="col-span-12 lg:col-span-4 space-y-5 sm:space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-black uppercase tracking-[0.25em] text-zinc-500">Up Next</h2>
                <button
                  type="button"
                  onClick={() => setAutoplay((a) => !a)}
                  className="flex items-center gap-2 group"
                  aria-label="Toggle autoplay"
                >
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest group-hover:text-zinc-300 transition-colors">Autoplay</span>
                  <span className={`w-8 h-4 rounded-full relative p-0.5 transition-colors ${autoplay ? "bg-red-600/80" : "bg-zinc-800"}`}>
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${autoplay ? "right-0.5 bg-white" : "left-0.5 bg-zinc-400"}`} />
                  </span>
                </button>
              </div>

              <div className="space-y-4 sm:space-y-5">
                {upNext.length === 0 ? (
                  <p className="text-sm text-zinc-500">Nothing else here yet.</p>
                ) : (
                  upNext.slice(0, 10).map((v) => <UpNextCard key={v.id} v={v} />)
                )}
              </div>

              {upNext.length > 10 && (
                <Link to="/library" className="block w-full text-center py-3 bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800 rounded-xl text-xs font-bold text-zinc-400 hover:text-white uppercase tracking-widest transition-all">
                  Browse Library
                </Link>
              )}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
