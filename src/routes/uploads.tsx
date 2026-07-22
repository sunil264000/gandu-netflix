import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Activity, CheckCircle2, AlertCircle, Loader2, Trash2, Wifi, Monitor } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceLabel } from "@/lib/uploadTracker";

export const Route = createFileRoute("/uploads")({
  component: LiveUploads,
  ssr: false,
  head: () => ({ meta: [
    { title: "Live Uploads — Vault" },
    { name: "description", content: "Watch every device's upload progress in real time." },
    { property: "og:title", content: "Live Uploads — Vault" },
    { property: "og:description", content: "Watch every device's upload progress in real time." },
  ]}),
});

type Job = {
  id: string;
  filename: string;
  size_bytes: number;
  uploaded_bytes: number;
  progress: number;
  status: "queued" | "thumb" | "uploading" | "saving" | "done" | "error";
  message: string | null;
  speed_bps: number;
  device_label: string | null;
  series_label: string | null;
  started_at: string;
  updated_at: string;
};

function fmtMB(b: number) {
  if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(2) + " GB";
  return (b / 1024 / 1024).toFixed(1) + " MB";
}
function fmtSpeed(bps: number) { return (bps / 1024 / 1024).toFixed(2) + " MB/s"; }
function fmtETA(s: number) {
  if (!isFinite(s) || s <= 0) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
function fmtAge(iso: string) {
  const dt = (Date.now() - new Date(iso).getTime()) / 1000;
  if (dt < 60) return `${Math.floor(dt)}s ago`;
  if (dt < 3600) return `${Math.floor(dt / 60)}m ago`;
  return `${Math.floor(dt / 3600)}h ago`;
}

const STATUS_LABEL: Record<Job["status"], string> = {
  queued: "Queued", thumb: "Generating thumbnail", uploading: "Uploading",
  saving: "Finalizing", done: "Done", error: "Error",
};

function LiveUploads() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [connected, setConnected] = useState(false);
  const [, setTick] = useState(0);
  const myDevice = useRef<string>("");

  useEffect(() => { myDevice.current = getDeviceLabel(); }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("upload_jobs")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (!cancelled && data) setJobs(data as Job[]);
    };
    load();

    const ch = supabase
      .channel("upload_jobs-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "upload_jobs" }, (payload) => {
        setJobs((prev) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as { id?: string })?.id;
            return prev.filter((j) => j.id !== oldId);
          }
          const row = payload.new as Job;
          const idx = prev.findIndex((j) => j.id === row.id);
          if (idx === -1) return [row, ...prev];
          const copy = prev.slice(); copy[idx] = row; return copy;
        });
      })
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    const tick = setInterval(() => setTick((n) => n + 1), 1000);
    return () => { cancelled = true; clearInterval(tick); supabase.removeChannel(ch); };
  }, []);

  const active = jobs.filter((j) => j.status !== "done" && j.status !== "error");
  const done = jobs.filter((j) => j.status === "done");
  const errored = jobs.filter((j) => j.status === "error");

  const totalBytes = active.reduce((s, j) => s + j.size_bytes, 0);
  const uploadedBytes = active.reduce((s, j) => s + j.uploaded_bytes, 0);
  const totalSpeed = active.reduce((s, j) => s + j.speed_bps, 0);
  const combinedPct = totalBytes > 0 ? (uploadedBytes / totalBytes) * 100 : 0;
  const combinedEta = totalSpeed > 0 ? (totalBytes - uploadedBytes) / totalSpeed : 0;

  // Group by device
  const devices = new Map<string, Job[]>();
  for (const j of active) {
    const key = j.device_label || "unknown";
    if (!devices.has(key)) devices.set(key, []);
    devices.get(key)!.push(j);
  }

  const clearDone = async () => {
    if (!done.length) return;
    await supabase.from("upload_jobs").delete().in("id", done.map((j) => j.id));
    setJobs((prev) => prev.filter((j) => j.status !== "done"));
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <AppHeader />
      <main className="max-w-6xl mx-auto px-4 lg:px-8 py-8 space-y-8">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.25em] text-zinc-500 mb-2">Vault · Live</div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Uploads across all devices</h1>
            <p className="mt-2 text-sm text-zinc-400 flex items-center gap-2">
              <Wifi className={`w-4 h-4 ${connected ? "text-emerald-400" : "text-zinc-500"}`} />
              {connected ? "Live · realtime stream connected" : "Connecting…"}
              <span className="mx-2 text-zinc-700">·</span>
              <Monitor className="w-4 h-4 text-zinc-500" />
              You are <span className="text-zinc-200 font-semibold ml-1">{myDevice.current || "…"}</span>
            </p>
          </div>
          {done.length > 0 && (
            <button onClick={clearDone}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-xs font-semibold uppercase tracking-widest text-zinc-300">
              <Trash2 className="w-3.5 h-3.5" /> Clear completed ({done.length})
            </button>
          )}
        </div>

        {/* Combined banner */}
        <div className="relative overflow-hidden p-6 rounded-3xl bg-gradient-to-br from-red-500/15 via-red-600/5 to-transparent border border-red-500/30">
          <div aria-hidden className="absolute -top-20 -right-20 w-64 h-64 bg-red-500/20 rounded-full blur-3xl" />
          <div className="relative flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <Activity className={`w-5 h-5 text-red-400 ${active.length ? "animate-pulse" : ""}`} />
              <div>
                <div className="text-xs font-black uppercase tracking-[0.2em] text-red-300/80">Now Uploading</div>
                <div className="text-2xl font-bold text-white tabular-nums">
                  {active.length} <span className="text-zinc-400 text-base font-medium">file{active.length === 1 ? "" : "s"} · {devices.size} device{devices.size === 1 ? "" : "s"}</span>
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500">Combined Speed</div>
              <div className="text-2xl font-bold text-white tabular-nums">{fmtSpeed(totalSpeed)}</div>
              <div className="text-xs text-zinc-400 tabular-nums mt-0.5">ETA {fmtETA(combinedEta)}</div>
            </div>
          </div>
          <div className="relative mt-5 h-2 bg-black/40 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-red-500 to-red-400 transition-all"
              style={{ width: `${combinedPct}%` }} />
          </div>
          <div className="relative mt-2 flex justify-between text-xs text-zinc-400 tabular-nums">
            <span>{fmtMB(uploadedBytes)} uploaded</span>
            <span>{combinedPct.toFixed(1)}% · {fmtMB(totalBytes)} total</span>
          </div>
        </div>

        {/* Active jobs grouped by device */}
        {active.length === 0 ? (
          <div className="text-center py-16 rounded-3xl bg-zinc-900/40 border border-zinc-800/60">
            <Activity className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
            <p className="text-zinc-400">No active uploads right now.</p>
            <p className="text-xs text-zinc-600 mt-1">Start an upload on any device and it will appear here instantly.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Array.from(devices.entries()).map(([device, deviceJobs]) => (
              <section key={device} className="space-y-3">
                <div className="flex items-center gap-3">
                  <Monitor className="w-4 h-4 text-zinc-500" />
                  <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-300">{device}</h2>
                  <span className="text-xs text-zinc-500">
                    {deviceJobs.length} file{deviceJobs.length === 1 ? "" : "s"} · {fmtSpeed(deviceJobs.reduce((s, j) => s + j.speed_bps, 0))}
                  </span>
                  {device === myDevice.current && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold uppercase tracking-widest">This device</span>
                  )}
                </div>
                {deviceJobs.map((j) => <JobRow key={j.id} j={j} />)}
              </section>
            ))}
          </div>
        )}

        {/* Errors */}
        {errored.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-widest text-red-400">Failed ({errored.length})</h2>
            {errored.map((j) => <JobRow key={j.id} j={j} />)}
          </section>
        )}

        {/* Recent done */}
        {done.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-500">Recently completed ({done.length})</h2>
            <div className="space-y-2">
              {done.slice(0, 20).map((j) => (
                <div key={j.id} className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/60">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-200 truncate">{j.filename}</p>
                    <p className="text-xs text-zinc-500">{j.device_label} · {fmtMB(j.size_bytes)} · {fmtAge(j.updated_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function JobRow({ j }: { j: Job }) {
  const isActive = j.status !== "done" && j.status !== "error";
  const showBar = j.status === "uploading" || j.status === "saving";
  const remaining = Math.max(0, j.size_bytes - j.uploaded_bytes);
  const eta = j.speed_bps > 0 ? remaining / j.speed_bps : 0;
  const elapsed = (Date.now() - new Date(j.started_at).getTime()) / 1000;
  const avg = elapsed > 0 ? j.uploaded_bytes / elapsed : 0;
  const stale = (Date.now() - new Date(j.updated_at).getTime()) > 15000 && isActive;

  const Icon = j.status === "done" ? CheckCircle2 : j.status === "error" ? AlertCircle : Loader2;
  const iconColor = j.status === "done" ? "text-emerald-400" : j.status === "error" ? "text-red-400" : "text-red-400 animate-spin";

  return (
    <div className={`p-4 rounded-2xl border ${
      stale ? "bg-amber-500/5 border-amber-500/30" :
      j.status === "error" ? "bg-red-500/5 border-red-500/30" :
      "bg-zinc-900/50 border-zinc-800"
    }`}>
      <div className="flex items-center gap-3">
        <Icon className={`w-5 h-5 flex-shrink-0 ${iconColor}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">
            {j.series_label && <span className="text-red-400 mr-1.5">[{j.series_label}]</span>}
            {j.filename}
          </p>
          <p className="text-xs text-zinc-400 mt-0.5">
            <span className="text-red-300">{STATUS_LABEL[j.status]}</span>
            {j.message && j.status === "error" ? ` — ${j.message}` : ""}
            {stale && <span className="ml-2 text-amber-400">· stalled</span>}
          </p>
        </div>
        {isActive && (
          <div className="text-right tabular-nums whitespace-nowrap">
            <div className="text-lg font-bold text-white">{j.progress.toFixed(1)}%</div>
            <div className="text-xs text-zinc-400">{fmtSpeed(j.speed_bps)}</div>
          </div>
        )}
      </div>

      {isActive && (
        <>
          <div className="mt-3 h-1.5 bg-black/40 rounded-full overflow-hidden">
            {showBar ? (
              <div className="h-full bg-gradient-to-r from-red-500 to-red-400 transition-all"
                style={{ width: `${j.progress}%` }} />
            ) : (
              <div className="h-full w-1/3 bg-gradient-to-r from-red-500/60 to-red-400/60 animate-[indeterminate_1.4s_ease-in-out_infinite]" />
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <Stat label="Uploaded" value={`${fmtMB(j.uploaded_bytes)} / ${fmtMB(j.size_bytes)}`} />
            <Stat label="Speed" value={fmtSpeed(j.speed_bps)} />
            <Stat label="Avg" value={fmtSpeed(avg)} />
            <Stat label="ETA" value={fmtETA(eta)} />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">{label}</div>
      <div className="text-zinc-100 tabular-nums font-semibold">{value}</div>
    </div>
  );
}
