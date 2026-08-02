import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Play, Sparkles, Upload } from "lucide-react";
import { Page } from "@/components/PageShell";
import { VideoRow, VideoGridSkeleton, type VideoCardData } from "@/components/VideoCard";
import { listVideos, listContinueWatching, listFavorites } from "@/lib/videos.functions";
import { useLiveVideos } from "@/hooks/useLiveVideos";

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

function Hero({ v }: { v: VideoCardData }) {
  return (
    <section className="relative mb-12 overflow-hidden rounded-3xl border border-white/[0.07] shadow-[0_40px_100px_-50px_rgba(239,68,68,.5)]">
      <div className="absolute inset-0">
        {v.thumbnail_url ? (
          <img src={v.thumbnail_url} alt="" className="h-full w-full scale-105 object-cover blur-[1px]" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-red-900/50 to-black" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-black/20" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/40" />
      </div>

      <div className="relative flex min-h-[280px] flex-col justify-end gap-4 p-6 sm:min-h-[380px] sm:p-10">
        <span className="flex w-fit items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-red-300">
          <Sparkles className="h-3 w-3" /> Latest drop
        </span>
        <h1 className="line-clamp-3 max-w-3xl break-words text-xl font-black leading-tight tracking-tight sm:text-3xl lg:text-4xl">
          {v.title}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/watch/$slug"
            params={{ slug: v.slug ?? v.id }}
            className="inline-flex items-center gap-2 rounded-full bg-red-500 px-6 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_-15px_rgba(239,68,68,.9)] transition hover:-translate-y-0.5 hover:bg-red-400"
          >
            <Play className="h-4 w-4 fill-white" /> Play now
          </Link>
          <Link
            to="/library"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-6 py-3 text-sm font-semibold text-white/90 backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-white/[0.12]"
          >
            Browse library
          </Link>
        </div>
      </div>
    </section>
  );
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
          <VideoRow title="Continue Watching" videos={continueW.data ?? []} />
          <VideoRow title="Recently Added" videos={recent.data ?? []} />
          <VideoRow title="Most Watched" videos={popular.data ?? []} />
          <VideoRow title="Favorites" videos={favs.data ?? []} />
        </>
      )}
    </Page>
  );
}
