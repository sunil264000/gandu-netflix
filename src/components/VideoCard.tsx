import { Link } from "@tanstack/react-router";
import { Play, Clock, Eye, Layers } from "lucide-react";
import { motion } from "framer-motion";
import { SmartThumb } from "@/components/SmartThumb";
import { groupBySeries, type SeriesGroup } from "@/lib/series";


export type VideoCardData = {
  id: string;
  slug?: string | null;
  title: string;
  duration_sec: number | null;
  thumbnail_url: string | null;
  view_count?: number;
  size_bytes?: number;
  position_sec?: number;
};

function fmtDur(s: number | null | undefined) {
  if (!s || s <= 0) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

function hueOf(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export function VideoCard({ v, index = 0 }: { v: VideoCardData; index?: number }) {
  const progress =
    v.position_sec && v.duration_sec ? Math.min(100, (v.position_sec / v.duration_sec) * 100) : 0;
  const hue = hueOf(v.title);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.035, 0.35), ease: [0.2, 0.7, 0.2, 1] }}
      whileHover={{ y: -6 }}
      className="group"
    >
      <Link to="/watch/$slug" params={{ slug: v.slug ?? v.id }} className="block outline-none">
        <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.03] shadow-[0_10px_30px_-18px_rgba(0,0,0,.9)] transition-all duration-500 group-hover:border-red-500/40 group-hover:shadow-[0_24px_60px_-24px_rgba(239,68,68,.55)]">
          <SmartThumb
            src={v.thumbnail_url}
            alt={v.title}
            fallback={
              <div
                className="grid h-full w-full place-items-center"
                style={{
                  background: `linear-gradient(135deg, hsl(${hue} 55% 16%), hsl(${(hue + 40) % 360} 60% 9%))`,
                }}
              >
                <span className="px-3 text-center text-xs font-semibold uppercase tracking-[0.2em] text-white/35">
                  {v.title.slice(0, 22)}
                </span>
              </div>
            }
          />

          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent opacity-70 transition-opacity duration-300 group-hover:opacity-95" />

          <div className="absolute inset-0 grid place-items-center">
            <span className="grid h-14 w-14 scale-75 place-items-center rounded-full bg-red-500/95 opacity-0 shadow-[0_0_40px_rgba(239,68,68,.7)] backdrop-blur-sm transition-all duration-300 group-hover:scale-100 group-hover:opacity-100">
              <Play className="ml-0.5 h-6 w-6 fill-white text-white" />
            </span>
          </div>

          {v.duration_sec ? (
            <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white/90 backdrop-blur-sm">
              <Clock className="h-3 w-3" />
              {fmtDur(v.duration_sec)}
            </span>
          ) : null}

          {progress > 0 && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/15">
              <div
                className="h-full bg-gradient-to-r from-red-500 to-orange-400 shadow-[0_0_10px_rgba(239,68,68,.9)]"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>

        <div className="mt-3 px-0.5">
          <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-white/90 transition-colors group-hover:text-red-400">
            {v.title}
          </h3>
          {(v.view_count ?? 0) > 0 && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-white/35">
              <Eye className="h-3 w-3" />
              {v.view_count} view{v.view_count === 1 ? "" : "s"}
            </p>
          )}
        </div>
      </Link>
    </motion.div>
  );
}

export const gridCls =
  "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";

/** One card standing in for a whole folder/season of episodes. */
export function SeriesCard({ g, index = 0 }: { g: SeriesGroup<VideoCardData>; index?: number }) {
  const first = g.episodes.find((e) => e.thumbnail_url) ?? g.episodes[0];
  const start =
    g.episodes.find((e) => (e.position_sec ?? 0) > 0 && (e.duration_sec ?? 0) > 0 && (e.position_sec ?? 0) / (e.duration_sec ?? 1) < 0.95) ??
    g.episodes[0];
  const hue = hueOf(g.name);
  const seasons = Array.from(new Set(g.episodes.map((e) => e.ep.season)));

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.035, 0.35), ease: [0.2, 0.7, 0.2, 1] }}
      whileHover={{ y: -6 }}
      className="group"
    >
      <Link to="/watch/$slug" params={{ slug: start.slug ?? start.id }} className="block outline-none">
        <div className="relative">
          {/* stacked-cards edge, hints that this is a collection */}
          <div className="absolute -top-1.5 left-3 right-3 h-3 rounded-t-xl border border-white/[0.06] bg-white/[0.05]" />
          <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.03] shadow-[0_10px_30px_-18px_rgba(0,0,0,.9)] transition-all duration-500 group-hover:border-red-500/40 group-hover:shadow-[0_24px_60px_-24px_rgba(239,68,68,.55)]">
            <SmartThumb
              src={first.thumbnail_url}
              alt={g.name}
              fallback={
                <div
                  className="grid h-full w-full place-items-center"
                  style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 16%), hsl(${(hue + 40) % 360} 60% 9%))` }}
                >
                  <span className="px-3 text-center text-xs font-semibold uppercase tracking-[0.2em] text-white/35">
                    {g.name.slice(0, 22)}
                  </span>
                </div>
              }
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent opacity-70 transition-opacity duration-300 group-hover:opacity-95" />
            <div className="absolute inset-0 grid place-items-center">
              <span className="grid h-14 w-14 scale-75 place-items-center rounded-full bg-red-500/95 opacity-0 shadow-[0_0_40px_rgba(239,68,68,.7)] backdrop-blur-sm transition-all duration-300 group-hover:scale-100 group-hover:opacity-100">
                <Play className="ml-0.5 h-6 w-6 fill-white text-white" />
              </span>
            </div>
            <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-red-500/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur-sm">
              <Layers className="h-3 w-3" /> Series
            </span>
            <span className="absolute bottom-2 right-2 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold text-white/90 backdrop-blur-sm">
              {g.episodes.length} episodes
            </span>
          </div>
        </div>

        <div className="mt-3 px-0.5">
          <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-white/90 transition-colors group-hover:text-red-400">
            {g.name}
          </h3>
          <p className="mt-1 text-[11px] text-white/35">
            {seasons.length > 1 ? `${seasons.length} seasons` : `Season ${seasons[0]}`} · Start {start.ep.label}
          </p>
        </div>
      </Link>
    </motion.div>
  );
}

/** Grid that collapses detected episodes into a single series card. */
export function VideoGrid({ videos }: { videos: VideoCardData[] }) {
  const items = groupBySeries(videos);
  return (
    <div className={gridCls}>
      {items.map((item, i) =>
        item.kind === "series" ? (
          <SeriesCard key={`s:${item.key}`} g={item} index={i} />
        ) : (
          <VideoCard key={item.video.id} v={item.video} index={i} />
        ),
      )}
    </div>
  );
}

export function VideoRow({ title, videos }: { title: string; videos: VideoCardData[] }) {
  if (videos.length === 0) return null;
  const items = groupBySeries(videos);
  return (
    <section className="mb-12">
      <div className="mb-4 flex items-center gap-3 px-0.5">
        <span className="h-5 w-1 rounded-full bg-gradient-to-b from-red-500 to-orange-400" />
        <h2 className="text-lg font-bold tracking-tight text-white sm:text-xl">{title}</h2>
        <span className="rounded-full border border-white/[0.07] bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-white/45">
          {items.length}
        </span>
      </div>
      <VideoGrid videos={videos} />
    </section>
  );
}


export function VideoGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className={gridCls}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-3">
          <div className="gn-shimmer aspect-video rounded-2xl border border-white/[0.05]" />
          <div className="gn-shimmer h-3 w-4/5 rounded" />
          <div className="gn-shimmer h-2.5 w-1/3 rounded" />
        </div>
      ))}
    </div>
  );
}
