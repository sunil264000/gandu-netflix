import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Trash2, Plus, Film, HardDrive, Eye, Sparkles, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { UploadZone } from "@/components/UploadZone";
import {
  listVideos, listCategories, deleteVideo, updateVideo,
  createCategory, deleteCategory, storageStats, backfillThumbnails,
} from "@/lib/videos.functions";
import { autoPosterSweep } from "@/lib/posters.functions";
import { useLiveVideos } from "@/hooks/useLiveVideos";

export const Route = createFileRoute("/admin")({
  component: Admin, ssr: false,
  head: () => ({ meta: [
    { title: "Admin — GANDU NETFLIX" },
    { name: "description", content: "Manage videos, categories, and library." },
    { property: "og:title", content: "Admin — GANDU NETFLIX" },
    { property: "og:description", content: "Manage videos, categories, and library." },
  ]}),
});

function fmtBytes(b: number) {
  if (b >= 1e12) return (b / 1e12).toFixed(2) + " TB";
  if (b >= 1e9) return (b / 1e9).toFixed(2) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  return (b / 1e3).toFixed(0) + " KB";
}

function Admin() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const _list = useServerFn(listVideos);
  const _cats = useServerFn(listCategories);
  const _del = useServerFn(deleteVideo);
  const _upd = useServerFn(updateVideo);
  const _createCat = useServerFn(createCategory);
  const _delCat = useServerFn(deleteCategory);
  const _stats = useServerFn(storageStats);
  const _backfill = useServerFn(backfillThumbnails);
  const _autoPoster = useServerFn(autoPosterSweep);

  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [newCat, setNewCat] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [backfilling, setBackfilling] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);

  const vids = useQuery({ queryKey: ["admin:videos"], queryFn: () => _list({ data: { sort: "new", limit: 60 } }) });
  const cats = useQuery({ queryKey: ["admin:cats"], queryFn: () => _cats() });
  const stats = useQuery({ queryKey: ["admin:stats"], queryFn: () => _stats() });

  useLiveVideos([["admin:videos"], ["admin:stats"]]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin:videos"] });
    qc.invalidateQueries({ queryKey: ["admin:stats"] });
  };

  const runBackfill = async () => {
    setBackfilling(true); setBackfillMsg(null);
    try {
      // 1) Look up real artwork by filename, 2) generate a poster for the rest.
      const auto = await _autoPoster({ data: { force: false } });
      const r = await _backfill();
      const parts: string[] = [];
      if (auto.matched > 0) parts.push(`Found artwork for ${auto.matched} title${auto.matched === 1 ? "" : "s"}`);
      if (r.generated > 0) parts.push(`generated ${r.generated} fallback poster${r.generated === 1 ? "" : "s"}`);
      if (!parts.length) parts.push(auto.scanned ? `Checked ${auto.scanned}, no match found` : "Everything already has a poster.");
      if (auto.missed.length) parts.push(auto.missed[0]!);
      setBackfillMsg(parts.join(" · "));
      refresh();
    } catch (e) {
      setBackfillMsg((e as Error).message || "Backfill failed");
    } finally {
      setBackfilling(false);
    }
  };



  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <AppHeader />
      <main className="max-w-[1600px] mx-auto px-6 py-8 space-y-8">
        <h1 className="text-3xl font-bold">Admin</h1>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard icon={<Film className="w-5 h-5" />} label="Videos" value={String(stats.data?.total_videos ?? 0)} />
          <StatCard icon={<HardDrive className="w-5 h-5" />} label="Storage" value={fmtBytes(stats.data?.total_bytes ?? 0)} />
          <StatCard icon={<Eye className="w-5 h-5" />} label="Total Views" value={String(stats.data?.total_views ?? 0)} />
        </div>

        {/* Artwork automation */}
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">Automatic artwork</div>
            <div className="text-xs text-white/60">Reads the release filename, looks the title up online, and attaches the real movie poster. Anything without a match falls back to a generated poster.</div>
            {backfillMsg && <div className="mt-1 text-xs text-emerald-400">{backfillMsg}</div>}
          </div>
          <button
            type="button" onClick={runBackfill} disabled={backfilling}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-red-500 to-red-700 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-red-500/30 hover:shadow-red-500/50 disabled:opacity-50"
          >
            {backfilling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {backfilling ? "Fetching artwork..." : "Fetch posters automatically"}
          </button>
        </section>


        {/* Upload */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-bold">Upload</h2>
            <select value={selectedCat ?? ""} onChange={(e) => setSelectedCat(e.target.value || null)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
              <option value="">Uncategorized</option>
              {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <UploadZone categoryId={selectedCat} onDone={refresh} />
        </section>

        {/* Categories */}
        <section>
          <h2 className="text-xl font-bold mb-3">Categories</h2>
          <div className="flex flex-wrap gap-2 mb-3">
            {(cats.data ?? []).map((c) => (
              <div key={c.id} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                <span className="text-sm">{c.name}</span>
                <button onClick={async () => { await _delCat({ data: { id: c.id } }); qc.invalidateQueries({ queryKey: ["admin:cats"] }); qc.invalidateQueries({ queryKey: ["cats"] }); }}
                  className="text-white/40 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
          <form onSubmit={async (e) => {
            e.preventDefault(); if (!newCat.trim()) return;
            await _createCat({ data: { name: newCat.trim() } }); setNewCat("");
            qc.invalidateQueries({ queryKey: ["admin:cats"] }); qc.invalidateQueries({ queryKey: ["cats"] });
          }} className="flex gap-2 max-w-sm">
            <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category name"
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-500/60" />
            <button className="px-4 rounded-lg bg-white/10 hover:bg-white/20 text-sm flex items-center gap-1"><Plus className="w-4 h-4" />Add</button>
          </form>
        </section>

        {/* Videos list */}
        <section>
          <h2 className="text-xl font-bold mb-3">Videos ({vids.data?.length ?? 0})</h2>
          <div className="space-y-2">
            {(vids.data ?? []).map((v) => (
              <div key={v.id} className="flex items-center gap-4 p-3 rounded-xl bg-white/5 border border-white/10">
                <div className="w-24 aspect-video rounded overflow-hidden bg-white/10 flex-shrink-0">
                  {v.thumbnail_url ? <img src={v.thumbnail_url} className="w-full h-full object-cover" /> : null}
                </div>
                <div className="flex-1 min-w-0">
                  {editing === v.id ? (
                    <div className="flex gap-2">
                      <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                        className="flex-1 bg-white/10 border border-white/20 rounded px-2 py-1 text-sm" />
                      <button onClick={async () => { await _upd({ data: { id: v.id, title: editTitle } }); setEditing(null); refresh(); }}
                        className="px-3 py-1 rounded bg-red-500 text-sm">Save</button>
                      <button onClick={() => setEditing(null)} className="px-3 py-1 rounded bg-white/10 text-sm">Cancel</button>
                    </div>
                  ) : (
                    <>
                      <p className="font-medium truncate cursor-pointer hover:text-red-400" onClick={() => { setEditing(v.id); setEditTitle(v.title); }}>{v.title}</p>
                      <p className="text-xs text-white/50">{fmtBytes(v.size_bytes)} · {v.view_count} views</p>
                    </>
                  )}
                </div>
                <button onClick={() => nav({ to: "/watch/$id", params: { id: v.id } })}
                  className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-sm">Watch</button>
                <button onClick={async () => { if (confirm(`Delete "${v.title}"?`)) { await _del({ data: { id: v.id } }); refresh(); } }}
                  className="p-2 rounded text-white/60 hover:text-red-400 hover:bg-red-500/10"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="p-5 rounded-2xl bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10">
      <div className="flex items-center gap-2 text-white/60 mb-1">{icon}<span className="text-xs uppercase tracking-wider">{label}</span></div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
