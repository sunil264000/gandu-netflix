import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Page, PageHeading } from "@/components/PageShell";
import { VideoGrid, VideoGridSkeleton } from "@/components/VideoCard";
import { listVideos, listCategories } from "@/lib/videos.functions";

export const Route = createFileRoute("/library")({
  component: Library, ssr: false,
  head: () => ({ meta: [
    { title: "Library — GANDU NETFLIX" },
    { name: "description", content: "Browse your full video library." },
    { property: "og:title", content: "Library — GANDU NETFLIX" },
    { property: "og:description", content: "Browse your full video library." },
  ]}),
});

function Library() {
  const [sort, setSort] = useState<"new" | "az" | "large" | "views">("new");
  const [cat, setCat] = useState<string | null>(null);
  const _list = useServerFn(listVideos);
  const _cats = useServerFn(listCategories);

  const cats = useQuery({ queryKey: ["cats"], queryFn: () => _cats() });
  const list = useQuery({
    queryKey: ["library", sort, cat],
    queryFn: () => _list({ data: { sort, categoryId: cat, limit: 60 } }),
  });

  const sorts = [
    { k: "new", label: "Newest" },
    { k: "az", label: "A → Z" },
    { k: "large", label: "Largest" },
    { k: "views", label: "Most Watched" },
  ] as const;
  const count = list.data?.length ?? 0;

  return (
    <Page>
      <PageHeading
        title="Library"
        subtitle={list.isLoading ? "Loading your collection…" : `${count} title${count === 1 ? "" : "s"}`}
      />

      <div className="sticky top-14 z-20 -mx-4 mb-6 flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-[#08080a]/80 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-1.5">
          {sorts.map((s) => (
            <button
              key={s.k}
              onClick={() => setSort(s.k)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
                sort === s.k
                  ? "bg-red-500 text-white shadow-[0_10px_28px_-12px_rgba(239,68,68,.9)]"
                  : "border border-white/[0.08] bg-white/[0.04] text-white/55 hover:bg-white/[0.09] hover:text-white"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <select
          value={cat ?? ""}
          onChange={(e) => setCat(e.target.value || null)}
          className="ml-auto rounded-full border border-white/[0.08] bg-white/[0.04] px-3.5 py-1.5 text-xs font-semibold text-white/80 outline-none transition focus:border-red-500/50"
        >
          <option value="">All Categories</option>
          {(cats.data ?? []).map((c) => (
            <option key={c.id} value={c.id} className="bg-[#111]">{c.name}</option>
          ))}
        </select>
      </div>

      {list.isLoading ? (
        <VideoGridSkeleton count={18} />
      ) : count === 0 ? (
        <div className="py-28 text-center">
          <p className="text-lg font-semibold text-white/70">Nothing here yet</p>
          <p className="mt-1 text-sm text-white/40">Try a different category or upload something new.</p>
        </div>
      ) : (
        <VideoGrid videos={list.data ?? []} />
      )}

    </Page>
  );
}
