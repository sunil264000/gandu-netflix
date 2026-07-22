import { Link } from "@tanstack/react-router";
import { Play, Clock } from "lucide-react";
import { motion } from "framer-motion";

export type VideoCardData = {
  id: string;
  title: string;
  duration_sec: number | null;
  thumbnail_url: string | null;
  view_count?: number;
  size_bytes?: number;
  position_sec?: number;
};

function fmtDur(s: number | null | undefined) {
  if (!s || s <= 0) return "";
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export function VideoCard({ v, index = 0 }: { v: VideoCardData; index?: number }) {
  const progress = v.position_sec && v.duration_sec ? Math.min(100, (v.position_sec / v.duration_sec) * 100) : 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.03, 0.3), ease: [0.2, 0.7, 0.2, 1] }}
      whileHover={{ y: -4 }}
      className="group"
    >
      <Link to="/watch/$id" params={{ id: v.id }} className="block">
        <div className="relative aspect-video rounded-2xl overflow-hidden bg-white/5 border border-white/5 group-hover:border-red-500/40 transition-all shadow-lg group-hover:shadow-red-500/20">
          {v.thumbnail_url ? (
            <img src={v.thumbnail_url} alt={v.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
          ) : (
            <div className="w-full h-full grid place-items-center bg-gradient-to-br from-white/5 to-white/0">
              <Play className="w-10 h-10 text-white/20" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="w-14 h-14 rounded-full bg-red-500 grid place-items-center shadow-xl shadow-red-500/60">
              <Play className="w-6 h-6 text-white fill-white ml-0.5" />
            </div>
          </div>
          {v.duration_sec ? (
            <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-white text-xs font-medium flex items-center gap-1">
              <Clock className="w-3 h-3" />{fmtDur(v.duration_sec)}
            </span>
          ) : null}
          {progress > 0 && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
              <div className="h-full bg-red-500" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
        <div className="mt-2.5 px-1">
          <h3 className="text-sm font-medium text-white line-clamp-2 group-hover:text-red-400 transition-colors">{v.title}</h3>
          {(v.view_count ?? 0) > 0 && (
            <p className="mt-1 text-xs text-white/40">{v.view_count} view{v.view_count === 1 ? "" : "s"}</p>
          )}
        </div>
      </Link>
    </motion.div>
  );
}

export function VideoRow({ title, videos }: { title: string; videos: VideoCardData[] }) {
  if (videos.length === 0) return null;
  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold text-white mb-4 px-1">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {videos.map((v, i) => <VideoCard key={v.id} v={v} index={i} />)}
      </div>
    </section>
  );
}

export function VideoGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="aspect-video rounded-2xl bg-white/5 animate-pulse" />
      ))}
    </div>
  );
}
