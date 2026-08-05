import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Play, Sparkles, Upload, Eye, Clock, Layers } from "lucide-react";
import { Page } from "@/components/PageShell";
import { VideoRow, VideoGridSkeleton, type VideoCardData } from "@/components/VideoCard";
import { listVideos, listContinueWatching, listFavorites } from "@/lib/videos.functions";
import { useLiveVideos } from "@/hooks/useLiveVideos";
import { parseEpisode } from "@/lib/series";

export const Route = createFileRoute("/")({
  component: Home,
  ssr: false,
  head: () => ({
    meta: [
      { title: "GANDU NETFLIX — Your Private Video Library" },
      { name: "description", content: "Stream your personal video collection with a premium, YouTube-fast experience." },
      { property: "og:title", content: "GANDU NETFLIX — Your Private Video Library" },
      { property: "og:description", content: "Stream your personal video collection with a premium, YouTube-fast experience." },
    ],
  }),
});

function fmtDur(s: number | null | undefined) {
  if (!s || s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function Hero({ v }: { v: VideoCardData }) {
  // Episode files read badly as a headline; show the show name big and the
  // episode marker as a chip beside it.
  const ep = parseEpisode(v.title);
  const heading = ep ? ep.series : v.title;
  const dur = fmtDur(v.duration_sec);

  return (
    <section className="relative mb-14 overflow-hidden rounded-[28px] border border-white/[0.07] shadow-[0_60px_140px_-60px_rgba(239,68,68,.6)]">
      <div className="absolute inset-0">
        {v.thumbnail_url ? (
          <img
            src={v.thumbnail_url}
            alt=""
            className="h-full w-full scale-[1.03] object-cover object-[center_28%]"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-red-900/50 to-black" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/75 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/25 to-transparent" />
      </div>

      <div className="relative flex min-h-[340px] flex-col justify-end gap-5 p-6 sm:min-h-[460px] sm:p-12">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex w-fit items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-red-300">
            <Sparkles className="h-3 w-3" /> Latest drop
          </span>
          {ep ? (
            <span className="flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.07] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70 backdrop-blur-md">
              <Layers className="h-3 w-3" /> {ep.label}
            </span>
          ) : null}
        </div>

        <h1 className="line-clamp-3 max-w-3xl break-words text-3xl font-black leading-[1.05] tracking-tight drop-shadow-[0_6px_30px_rgba(0,0,0,.9)] sm:text-5xl lg:text-6xl">
          {heading}
        </h1>

        <div className="flex flex-wrap items-center gap-4 text-[12.5px] font-medium text-white/55">
          {dur ? (
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> {dur}
            </span>
          ) : null}
          {(v.view_count ?? 0) > 0 ? (
            <span className="flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5" /> {v.view_count} view{v.view_count === 1 ? "" : "s"}
            </span>
          ) : null}
          <span className="hidden items-center gap-1.5 sm:flex">
            <span className="rounded border border-white/12 px-1.5 py-px text-[10px] font-bold tracking-widest text-white/60">
              4K
            </span>
            Ultra HD ready
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/watch/$slug"
            params={{ slug: v.slug || v.id }}
            className="inline-flex items-center gap-2 rounded-full bg-red-500 px-7 py-3.5 text-sm font-semibold text-white shadow-[0_18px_45px_-15px_rgba(239,68,68,.9)] transition hover:-translate-y-0.5 hover:bg-red-400"
          >
            <Play className="h-4 w-4 fill-white" /> Play now
          </Link>
          <Link
            to="/library"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-7 py-3.5 text-sm font-semibold text-white/90 backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-white/[0.12]"
          >
            Browse library
          </Link>
        </div>
      </div>
    </section>
  );
}

/** Same file uploaded twice shows up as two identical cards — keep the first. */
function dedupe(videos: VideoCardData[] | undefined): VideoCardData[] {
  const seen = new Set<string>();
  return (videos ?? []).filter((v) => {
    const key = v.title.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


function Home() {
  const nav = useNavigate();
  const _listVideos = useServerFn(listVideos);
  const _continue = useServerFn(listContinueWatching);
  const _favorites = useServerFn(listFavorites);

  const recent = useQuery({ queryKey: ["home:recent"], queryFn: () => _listVideos({ data: { sort: "new", limit: 40 } }) });
  const continueW = useQuery({ queryKey: ["home:continue"], queryFn: () => _continue() });
  const popular = useQuery({ queryKey: ["home:popular"], queryFn: () => _listVideos({ data: { sort: "views", limit: 40 } }) });

  const favs = useQuery({ queryKey: ["home:favs"], queryFn: () => _favorites() });

  useLiveVideos([["home:recent"], ["home:popular"], ["home:continue"], ["home:favs"]]);

  const empty = recent.data && recent.data.length === 0;
  const hero = recent.data?.[0];

  return (
    <Page>
      {recent.isLoading ? (
        <>
          <div className="gn-shimmer mb-12 h-[280px] rounded-3xl sm:h-[380px]" />
          <VideoGridSkeleton count={12} />
        </>
      ) : empty ? (
        <div className="mx-auto max-w-md py-28 text-center">
          <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <Upload className="h-7 w-7 text-red-400" />
          </div>
          <h1 className="mb-2 text-3xl font-black tracking-tight">Your vault is empty</h1>
          <p className="mb-7 text-sm text-white/45">Upload your first video from the admin panel and it'll show up here instantly.</p>
          <button
            onClick={() => nav({ to: "/admin" })}
            className="rounded-full bg-red-500 px-7 py-3 text-sm font-semibold shadow-[0_18px_45px_-15px_rgba(239,68,68,.9)] transition hover:-translate-y-0.5 hover:bg-red-400"
          >
            Go to Admin
          </button>
        </div>
      ) : (
        <>
          {hero ? <Hero v={hero} /> : null}
          <VideoRow title="Continue Watching" videos={dedupe(continueW.data)} />
          <VideoRow title="Recently Added" videos={dedupe(recent.data)} />
          <VideoRow title="Most Watched" videos={dedupe(popular.data)} />
          <VideoRow title="Favorites" videos={dedupe(favs.data)} />
        </>
      )}

    </Page>
  );
}
