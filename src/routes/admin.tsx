import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Trash2, Plus, Film, HardDrive, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { UploadZone } from "@/components/UploadZone";
import { isOwner, claimOwner } from "@/lib/ext/admin.functions";
import {
  listVideos, listCategories, deleteVideo, updateVideo,
  createCategory, deleteCategory, storageStats,
} from "@/lib/videos.functions";

export const Route = createFileRoute("/admin")({
  component: Admin, ssr: false,
  head: () => ({ meta: [
    { title: "Admin — Vault" },
    { name: "description", content: "Manage videos, categories, and library." },
    { property: "og:title", content: "Admin — Vault" },
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
  const _isOwner = useServerFn(isOwner);
  const _claim = useServerFn(claimOwner);
  const _list = useServerFn(listVideos);
  const _cats = useServerFn(listCategories);
  const _del = useServerFn(deleteVideo);
  const _upd = useServerFn(updateVideo);
  const _createCat = useServerFn(createCategory);
  const _delCat = useServerFn(deleteCategory);
  const _stats = useServerFn(storageStats);

  const [state, setState] = useState<"loading" | "signin" | "claim" | "locked" | "ready">("loading");
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [newCat, setNewCat] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return setState("signin");
      try {
        const r = await _isOwner();
        if (r.isOwner) setState("ready");
        else if (r.claimed) setState("locked");
        else setState("claim");
      } catch { setState("signin"); }
    })();
  }, [_isOwner]);

  const vids = useQuery({ queryKey: ["admin:videos"], queryFn: () => _list({ data: { sort: "new", limit: 60 } }), enabled: state === "ready" });
  const cats = useQuery({ queryKey: ["admin:cats"], queryFn: () => _cats(), enabled: state === "ready" });
  const stats = useQuery({ queryKey: ["admin:stats"], queryFn: () => _stats(), enabled: state === "ready" });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin:videos"] });
    qc.invalidateQueries({ queryKey: ["admin:stats"] });
  };

  if (state === "loading") return <div className="min-h-screen bg-[#0a0a0a] grid place-items-center text-white/60">Loading...</div>;
  if (state === "signin") return (
    <div className="min-h-screen bg-[#0a0a0a] grid place-items-center text-white">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-3">Sign in required</h1>
        <button onClick={() => nav({ to: "/auth" })} className="px-6 py-3 rounded-full bg-red-500 hover:bg-red-600 font-medium">Sign in</button>
      </div>
    </div>
  );
  if (state === "claim") return (
    <div className="min-h-screen bg-[#0a0a0a] grid place-items-center text-white">
      <div className="text-center max-w-md p-8 rounded-2xl bg-white/5 border border-white/10">
        <h1 className="text-2xl font-bold mb-2">Claim Ownership</h1>
        <p className="text-white/60 mb-6 text-sm">No admin exists yet. Claim to become the sole administrator.</p>
        <button onClick={async () => { await _claim(); setState("ready"); }} className="px-6 py-3 rounded-full bg-red-500 hover:bg-red-600 font-medium shadow-lg shadow-red-500/40">Claim Owner</button>
      </div>
    </div>
  );
  if (state === "locked") return (
    <div className="min-h-screen bg-[#0a0a0a] grid place-items-center text-white text-center">
      <div>
        <h1 className="text-2xl font-bold mb-2">Admin locked</h1>
        <p className="text-white/60">Another user has already claimed ownership.</p>
      </div>
    </div>
  );

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
