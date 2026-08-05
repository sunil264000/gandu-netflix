import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Page, PageHeading } from "@/components/PageShell";
import { VideoCard, VideoGridSkeleton, gridCls } from "@/components/VideoCard";
import { searchVideos } from "@/lib/videos.functions";

export const Route = createFileRoute("/search")({
  component: Search, ssr: false,
  validateSearch: z.object({ q: z.string().default("") }),
  head: () => ({ meta: [
    { title: "Search — GANDU NETFLIX" },
    { name: "description", content: "Search your video library." },
    { property: "og:title", content: "Search — GANDU NETFLIX" },
    { property: "og:description", content: "Search your video library." },
  ]}),
});

function Search() {
  const { q } = Route.useSearch();
  const _search = useServerFn(searchVideos);

  const results = useQuery({
    queryKey: ["search", q], queryFn: () => _search({ data: { q } }), enabled: q.length > 0,
  });

  const count = results.data?.length ?? 0;

  return (
    <Page>
      <PageHeading
        title={q ? <>Results for <span className="text-red-400">“{q}”</span></> : "Search"}
        subtitle={q ? (results.isLoading ? "Searching…" : `${count} match${count === 1 ? "" : "es"}`) : "Press / anywhere to focus the search bar"}
      />
      {!q ? (
        <p className="py-24 text-center text-sm text-white/40">Type a query in the header search to begin.</p>
      ) : results.isLoading ? (
        <VideoGridSkeleton count={12} />
      ) : count === 0 ? (
        <div className="py-24 text-center">
          <p className="text-lg font-semibold text-white/70">No matches</p>
          <p className="mt-1 text-sm text-white/40">Try a shorter or different keyword.</p>
        </div>
      ) : (
        <div className={gridCls}>
          {(results.data ?? []).map((v, i) => (
            <VideoCard key={v.id} v={v} index={i} />
          ))}
        </div>
      )}
    </Page>
  );
}
