import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import * as tus from "tus-js-client";
import { Upload, X, CheckCircle2, AlertCircle, Loader2, FolderUp, Activity } from "lucide-react";
import { createVideoRecord, createCategory, listCategories } from "@/lib/videos.functions";
import { createUploadJob, updateUploadJob } from "@/lib/uploadTracker";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const DIRECT_UPLOAD_LIMIT = 42 * 1024 * 1024;
const VIDEO_CHUNK_SIZE = 32 * 1024 * 1024;

type Canceller = { cancelled: boolean; abort?: () => void };

function tusUpload(bucket: string, path: string, file: File | Blob, onProgress?: (pct: number) => void, canceller?: Canceller) {
  return new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { Authorization: `Bearer ${SUPABASE_KEY}`, "x-upsert": "true", apikey: SUPABASE_KEY },
      uploadDataDuringCreation: false,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType: (file as File).type || "application/octet-stream",
        cacheControl: "3600",
      },
      chunkSize: 6 * 1024 * 1024,
      onError: (e) => reject(e),
      onProgress: (sent, total) => onProgress?.((sent / total) * 100),
      onSuccess: () => resolve(),
    });
    if (canceller) {
      canceller.abort = () => {
        try { upload.abort(true); } catch { /* ignore */ }
        reject(new Error("Cancelled"));
      };
    }
    upload.start();
  });
}

async function uploadObject(bucket: "videos" | "thumbnails", path: string, blob: Blob, contentType?: string) {
  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    upsert: true,
    contentType: contentType || blob.type || "application/octet-stream",
    cacheControl: "3600",
  });
  if (error) throw error;
}

async function uploadChunkedVideo(file: File, basePath: string, onProgress?: (pct: number) => void, canceller?: Canceller) {
  const chunkCount = Math.ceil(file.size / VIDEO_CHUNK_SIZE);
  let uploaded = 0;

  for (let index = 0; index < chunkCount; index += 1) {
    if (canceller?.cancelled) throw new Error("Cancelled");
    const start = index * VIDEO_CHUNK_SIZE;
    const end = Math.min(file.size, start + VIDEO_CHUNK_SIZE);
    const partPath = `${basePath}.part-${String(index).padStart(6, "0")}`;
    const chunk = file.slice(start, end, file.type || "application/octet-stream");
    await uploadObject("videos", partPath, chunk, file.type || "application/octet-stream");
    uploaded += chunk.size;
    onProgress?.((uploaded / file.size) * 100);
  }

  return { chunkCount, chunkSizeBytes: VIDEO_CHUNK_SIZE };
}

type Job = {
  id: string;
  file: File;
  progress: number;
  status: "queued" | "thumb" | "uploading" | "saving" | "done" | "error";
  message?: string;
  seriesLabel?: string;
  categoryOverride?: string | null;
};

const VIDEO_EXT_RE = /\.(mp4|webm|mov|mkv|avi|m4v|ts|mpeg|mpg|3gp|flv|wmv)$/i;

// Try native <video> decode; if the browser can't decode the codec (MKV/HEVC/10-bit),
// return null and let the caller build a stylized poster from the title.
async function extractThumbnail(file: File): Promise<{ blob: Blob | null; duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "auto"; v.src = url; v.muted = true; v.playsInline = true; v.crossOrigin = "anonymous";
    let settled = false;
    const done = (blob: Blob | null) => {
      if (settled) return; settled = true;
      URL.revokeObjectURL(url);
      resolve({ blob, duration: v.duration || 0, width: v.videoWidth || 0, height: v.videoHeight || 0 });
    };
    const draw = () => {
      try {
        const w = v.videoWidth, h = v.videoHeight;
        if (!w || !h) return false;
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 1920 / w);
        canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d"); if (!ctx) return false;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => { if (b) done(b); }, "image/jpeg", 0.92);
        return true;
      } catch { return false; }
    };
    let attempt = 0;
    const seekPositions = [3, 15, 60, 0.5];
    const trySeek = () => {
      if (attempt >= seekPositions.length) { done(null); return; }
      const target = seekPositions[attempt++];
      const t = isFinite(v.duration) && v.duration > 0
        ? Math.min(Math.max(0.1, target), Math.max(0.1, v.duration - 0.1))
        : target;
      try { v.currentTime = t; } catch { done(null); }
    };
    v.onloadedmetadata = () => trySeek();
    v.onseeked = () => { if (!draw()) trySeek(); };
    v.onerror = () => done(null);
    setTimeout(() => done(null), 20000);
  });
}

// Deterministic hash for consistent colors per title.
function hashStr(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

// Build a cinematic gradient poster from the title when the video can't be decoded.
async function generatePosterThumbnail(title: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const W = 1280, H = 720;
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d"); if (!ctx) return resolve(null);
      const clean = title.replace(/\.[^.]+$/, "").replace(/\[[^\]]*\]|\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
      const hue = hashStr(clean) % 360;
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, `hsl(${hue}, 65%, 22%)`);
      g.addColorStop(0.5, `hsl(${(hue + 30) % 360}, 55%, 12%)`);
      g.addColorStop(1, `hsl(${(hue + 60) % 360}, 70%, 8%)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // Vignette
      const rg = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, W * 0.7);
      rg.addColorStop(0, "rgba(0,0,0,0)"); rg.addColorStop(1, "rgba(0,0,0,0.65)");
      ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
      // Play glyph
      ctx.save();
      ctx.translate(W / 2, H / 2 - 40);
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.beginPath(); ctx.arc(0, 0, 80, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath(); ctx.moveTo(-22, -30); ctx.lineTo(-22, 30); ctx.lineTo(30, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
      // Title
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = "600 42px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const words = clean.split(" ");
      const lines: string[] = [];
      let line = "";
      for (const w of words) {
        const test = line ? line + " " + w : w;
        if (ctx.measureText(test).width > W - 120 && line) { lines.push(line); line = w; } else { line = test; }
        if (lines.length >= 2) break;
      }
      if (line) lines.push(line);
      const shown = lines.slice(0, 2);
      shown.forEach((ln, i) => ctx.fillText(ln, W / 2, H / 2 + 110 + i * 52));
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9);
    } catch { resolve(null); }
  });
}

export function UploadZone({ categoryId, onDone }: { categoryId: string | null; onDone: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const _create = useServerFn(createVideoRecord);
  const _createCat = useServerFn(createCategory);
  const _listCats = useServerFn(listCategories);
  const qc = useQueryClient();
  const cancellersRef = useRef<Map<string, Canceller>>(new Map());

  const updateJob = (id: string, patch: Partial<Job>) =>
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const cancelJob = (id: string) => {
    const c = cancellersRef.current.get(id);
    if (c) { c.cancelled = true; c.abort?.(); }
    updateJob(id, { status: "error", message: "Cancelled" });
    updateUploadJob(id, { status: "error", message: "Cancelled", progress: 0 });
    cancellersRef.current.delete(id);
  };

  const processFile = useCallback(async (job: Job) => {
    // Server tracker heartbeat state (throttled remote update)
    let lastRemote = 0;
    let lastRemoteBytes = 0;
    let lastRemoteT = Date.now();
    const remote = (patch: { status?: Job["status"]; message?: string; progress?: number; force?: boolean }) => {
      const now = Date.now();
      const bytes = job.file.size * Math.min(100, patch.progress ?? 0) / 100;
      const dt = (now - lastRemoteT) / 1000;
      const speedBps = dt > 0 ? Math.max(0, (bytes - lastRemoteBytes) / dt) : 0;
      // Throttle: only push every ~1.5s during upload, always on status change
      if (!patch.force && patch.status === undefined && now - lastRemote < 1500) return;
      lastRemote = now;
      lastRemoteT = now;
      lastRemoteBytes = bytes;
      updateUploadJob(job.id, {
        status: patch.status,
        message: patch.message,
        progress: patch.progress,
        uploadedBytes: Math.round(bytes),
        speedBps: Math.round(speedBps),
      });
    };

    const canceller: Canceller = { cancelled: false };
    cancellersRef.current.set(job.id, canceller);

    try {
      const file = job.file;
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const uid = crypto.randomUUID();
      const storagePath = `${uid}.${ext || "bin"}`;

      // Register the job so other devices can see it
      await createUploadJob({
        id: job.id, filename: file.name, sizeBytes: file.size, seriesLabel: job.seriesLabel,
      });

      if (canceller.cancelled) throw new Error("Cancelled");
      updateJob(job.id, { status: "thumb", message: "Generating thumbnail..." });
      remote({ status: "thumb", message: "Generating thumbnail...", progress: 0, force: true });
      const meta = await extractThumbnail(file);

      let thumbnailPath: string | undefined;
      if (meta.blob) {
        thumbnailPath = `${uid}.jpg`;
        try {
          await tusUpload("thumbnails", thumbnailPath, meta.blob);
        } catch { thumbnailPath = undefined; }
      }

      if (canceller.cancelled) throw new Error("Cancelled");
      updateJob(job.id, { status: "uploading", message: "Uploading...", progress: 0 });
      remote({ status: "uploading", message: "Uploading...", progress: 0, force: true });

      let uploadMode: "single" | "chunked" = "single";
      let chunkCount: number | undefined;
      let chunkSizeBytes: number | undefined;

      const onPct = (pct: number) => {
        updateJob(job.id, { progress: pct });
        remote({ progress: pct });
      };

      if (file.size > DIRECT_UPLOAD_LIMIT) {
        uploadMode = "chunked";
        const chunkMeta = await uploadChunkedVideo(file, storagePath, onPct, canceller);
        chunkCount = chunkMeta.chunkCount;
        chunkSizeBytes = chunkMeta.chunkSizeBytes;
      } else {
        await tusUpload("videos", storagePath, file, onPct, canceller);
      }

      updateJob(job.id, { status: "saving", message: "Finalizing...", progress: 100 });
      remote({ status: "saving", message: "Finalizing...", progress: 100, force: true });

      const title = file.name.replace(/\.[^.]+$/, "");
      const effectiveCategoryId = job.categoryOverride !== undefined ? job.categoryOverride : categoryId;
      await _create({ data: {
        title, storagePath, thumbnailPath, sizeBytes: file.size, mimeType: file.type || undefined,
        extension: ext || undefined, durationSec: meta.duration || undefined,
        width: meta.width || undefined, height: meta.height || undefined,
        categoryId: effectiveCategoryId, uploadMode, chunkCount, chunkSizeBytes,
      }});

      updateJob(job.id, { status: "done", message: "Uploaded" });
      remote({ status: "done", message: "Uploaded", progress: 100, force: true });
      onDone();
    } catch (e: unknown) {
      const msg = (e as Error).message || "Upload failed";
      updateJob(job.id, { status: "error", message: msg });
      updateUploadJob(job.id, { status: "error", message: msg });
    } finally {
      cancellersRef.current.delete(job.id);
    }
  }, [_create, categoryId, onDone]);


  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const vids = Array.from(files).filter((f) => VIDEO_EXT_RE.test(f.name) || f.type.startsWith("video/"));
    if (!vids.length) return;
    const newJobs: Job[] = vids.map((file) => ({
      id: crypto.randomUUID(), file, progress: 0, status: "queued",
    }));
    setJobs((prev) => [...prev, ...newJobs]);
    newJobs.forEach(processFile);
  };

  const naturalCmp = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

  const addFolder = async (files: FileList | null) => {
    if (!files) return;
    const all = Array.from(files).filter((f) => VIDEO_EXT_RE.test(f.name) || f.type.startsWith("video/"));
    if (!all.length) return;

    // Group by top-level folder from webkitRelativePath ("Series Name/S01/ep1.mkv")
    const groups = new Map<string, File[]>();
    for (const f of all) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const parts = rel.split("/");
      const series = parts.length > 1 ? parts[0] : "";
      const key = series || "__root__";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(f);
    }

    // Fetch existing categories once, case-insensitive dedupe
    const existing = await _listCats();
    const byName = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]));

    const pending: Job[] = [];
    for (const [seriesName, filesInSeries] of groups) {
      let catId: string | null = null;
      let label: string | undefined;
      if (seriesName !== "__root__") {
        label = seriesName;
        const existingId = byName.get(seriesName.toLowerCase());
        if (existingId) {
          catId = existingId;
        } else {
          try {
            const created = await _createCat({ data: { name: seriesName } });
            catId = created.id;
            byName.set(seriesName.toLowerCase(), created.id);
          } catch { catId = null; }
        }
      }
      const sorted = filesInSeries.sort((a, b) => {
        const ra = (a as File & { webkitRelativePath?: string }).webkitRelativePath || a.name;
        const rb = (b as File & { webkitRelativePath?: string }).webkitRelativePath || b.name;
        return naturalCmp(ra, rb);
      });
      for (const file of sorted) {
        pending.push({
          id: crypto.randomUUID(), file, progress: 0, status: "queued",
          seriesLabel: label, categoryOverride: catId,
        });
      }
    }

    qc.invalidateQueries({ queryKey: ["admin:cats"] });
    qc.invalidateQueries({ queryKey: ["cats"] });

    setJobs((prev) => [...prev, ...pending]);
    // Throttle: run 3 in parallel
    const queue = [...pending];
    const workers = Array.from({ length: 3 }, async () => {
      while (queue.length) {
        const next = queue.shift();
        if (next) await processFile(next);
      }
    });
    Promise.all(workers);
  };

  // Aggregate live progress across active jobs
  const active = useMemo(
    () => jobs.filter((j) => j.status !== "done" && j.status !== "error"),
    [jobs],
  );
  const totalBytes = active.reduce((s, j) => s + j.file.size, 0);
  const doneBytes = active.reduce((s, j) => s + (j.file.size * Math.min(100, j.progress)) / 100, 0);
  const combinedPct = totalBytes > 0 ? (doneBytes / totalBytes) * 100 : 0;

  const lastRef = useRef<{ bytes: number; t: number }>({ bytes: 0, t: Date.now() });
  const [speed, setSpeed] = useState(0); // bytes/sec, smoothed
  const perJobRef = useRef<Map<string, { bytes: number; t: number; speed: number; history: number[]; startedAt: number }>>(new Map());
  const SPARK_MAX = 40;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (active.length === 0) { lastRef.current = { bytes: 0, t: Date.now() }; setSpeed(0); perJobRef.current.clear(); return; }
    const id = setInterval(() => {
      const now = Date.now();
      const dt = (now - lastRef.current.t) / 1000;
      const db = doneBytes - lastRef.current.bytes;
      if (dt > 0) {
        const inst = Math.max(0, db / dt);
        setSpeed((prev) => prev === 0 ? inst : prev * 0.6 + inst * 0.4);
      }
      lastRef.current = { bytes: doneBytes, t: now };

      for (const j of active) {
        const cur = (j.file.size * Math.min(100, j.progress)) / 100;
        const prev = perJobRef.current.get(j.id);
        if (!prev) {
          perJobRef.current.set(j.id, { bytes: cur, t: now, speed: 0, history: [0], startedAt: now });
        } else {
          const jdt = (now - prev.t) / 1000;
          const jdb = cur - prev.bytes;
          if (jdt > 0) {
            const inst = Math.max(0, jdb / jdt);
            const smoothed = prev.speed === 0 ? inst : prev.speed * 0.6 + inst * 0.4;
            const history = [...prev.history, smoothed].slice(-SPARK_MAX);
            perJobRef.current.set(j.id, { bytes: cur, t: now, speed: smoothed, history, startedAt: prev.startedAt });
          }
        }
      }
      setTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [active, doneBytes]);

  const fmtMB = (b: number) => (b / 1024 / 1024).toFixed(1);
  const eta = speed > 0 ? Math.max(0, (totalBytes - doneBytes) / speed) : 0;
  const fmtETA = (s: number) => {
    if (!isFinite(s) || s <= 0) return "—";
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };
  const Sparkline = ({ data, width = 90, height = 28 }: { data: number[]; width?: number; height?: number }) => {
    if (!data.length) return null;
    const max = Math.max(...data, 1);
    const step = data.length > 1 ? width / (data.length - 1) : width;
    const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * height).toFixed(1)}`);
    const line = `M${pts.join(" L")}`;
    const area = `${line} L${width},${height} L0,${height} Z`;
    return (
      <svg width={width} height={height} className="overflow-visible">
        <defs>
          <linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(248 113 113)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(248 113 113)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#sparkFill)" />
        <path d={line} fill="none" stroke="rgb(248 113 113)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    );
  };
  const Stat = ({ label, value }: { label: string; value: string }) => (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-white/40">{label}</span>
      <span className="text-xs text-white tabular-nums">{value}</span>
    </div>
  );



  return (
    <div>
      {active.length > 0 && (
        <div className="mb-4 p-4 rounded-2xl bg-gradient-to-br from-red-500/10 to-white/[0.02] border border-red-500/30">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-red-400 animate-pulse" />
              <span className="text-sm font-semibold text-white">Live uploads</span>
              <span className="text-xs text-white/60">
                {active.length} active · {fmtMB(doneBytes)} / {fmtMB(totalBytes)} MB
              </span>
            </div>
            <div className="text-xs text-white/70 tabular-nums">
              {(speed / 1024 / 1024).toFixed(2)} MB/s · ETA {fmtETA(eta)}
            </div>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-red-500 to-red-400 transition-all"
              style={{ width: `${combinedPct}%` }} />
          </div>
          <div className="mt-1 text-right text-[11px] text-white/50 tabular-nums">{combinedPct.toFixed(1)}%</div>
        </div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer border-2 border-dashed rounded-2xl p-10 text-center transition-all ${
          drag ? "border-red-500 bg-red-500/10" : "border-white/10 bg-white/5 hover:border-white/30 hover:bg-white/10"
        }`}
      >
        <Upload className="w-10 h-10 mx-auto text-white/40 mb-3" />
        <p className="text-white font-medium">Drop videos here or click to browse</p>
        <p className="mt-1 text-xs text-white/50">MP4, WebM, MOV, MKV — large files upload in safe chunks</p>
        <input ref={inputRef} type="file" multiple accept="video/*,.mkv,.avi" hidden onChange={(e) => addFiles(e.target.files)} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); folderRef.current?.click(); }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-medium"
        >
          <FolderUp className="w-4 h-4" />
          Upload folder as series
        </button>
        <p className="text-xs text-white/50">
          Each top-level folder becomes a series (auto-creates a category with the folder name).
        </p>
        <input
          ref={folderRef}
          type="file"
          hidden
          multiple
          onChange={(e) => { addFolder(e.target.files); e.currentTarget.value = ""; }}
          // @ts-expect-error non-standard directory attributes
          webkitdirectory=""
          directory=""
        />
      </div>

      {jobs.length > 0 && (
        <div className="mt-4 space-y-2">
          {jobs.map((j) => {
            const jStats = perJobRef.current.get(j.id);
            const jSpeed = jStats?.speed ?? 0;
            const jDone = (j.file.size * Math.min(100, j.progress)) / 100;
            const jEta = jSpeed > 0 ? Math.max(0, (j.file.size - jDone) / jSpeed) : 0;
            const jElapsed = jStats ? (Date.now() - jStats.startedAt) / 1000 : 0;
            const jAvg = jElapsed > 0 ? jDone / jElapsed : 0;
            const jPeak = jStats?.history?.length ? Math.max(...jStats.history) : 0;
            const isActive = j.status !== "done" && j.status !== "error";
            const showStats = j.status === "uploading" || j.status === "saving";
            const statusLabel =
              j.status === "queued" ? "Queued" :
              j.status === "thumb" ? "Generating thumbnail" :
              j.status === "uploading" ? "Uploading" :
              j.status === "saving" ? "Finalizing" :
              j.status === "done" ? "Done" : "Error";
            return (
              <div key={j.id} className="p-3 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0">
                    {j.status === "done" ? <CheckCircle2 className="w-5 h-5 text-green-400" /> :
                     j.status === "error" ? <AlertCircle className="w-5 h-5 text-red-400" /> :
                     <Loader2 className="w-5 h-5 text-red-400 animate-spin" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">
                      {j.seriesLabel ? <span className="text-red-400 mr-1.5">[{j.seriesLabel}]</span> : null}
                      {j.file.name}
                    </p>
                    <p className="text-xs text-white/50">
                      <span className="text-red-300">{statusLabel}</span>
                      {j.message && j.status === "error" ? ` — ${j.message}` : ""} · {fmtMB(j.file.size)} MB
                    </p>
                  </div>
                  {isActive && (
                    <div className="text-right text-xs text-white/70 tabular-nums whitespace-nowrap">
                      <div className="text-white font-semibold text-sm">{j.progress.toFixed(1)}%</div>
                      <div>{showStats ? `${(jSpeed / 1024 / 1024).toFixed(2)} MB/s` : "—"}</div>
                    </div>
                  )}
                  {isActive && (
                    <button
                      onClick={() => cancelJob(j.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-500/15 hover:bg-red-500/30 text-red-300 text-xs font-medium border border-red-500/30"
                      title="Cancel upload"
                    >
                      <X className="w-3.5 h-3.5" />
                      Cancel
                    </button>
                  )}
                  {(j.status === "done" || j.status === "error") && (
                    <button onClick={() => setJobs((p) => p.filter((x) => x.id !== j.id))} className="p-1 text-white/40 hover:text-white" title="Remove">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {isActive && (
                  <>
                    <div className="mt-2 h-1.5 bg-white/10 rounded overflow-hidden relative">
                      {showStats ? (
                        <div className="h-full bg-gradient-to-r from-red-500 to-red-400 transition-all" style={{ width: `${j.progress}%` }} />
                      ) : (
                        <div className="h-full w-1/3 bg-gradient-to-r from-red-500/60 to-red-400/60 animate-[indeterminate_1.4s_ease-in-out_infinite]" />
                      )}
                    </div>
                    {showStats && (
                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                        <Stat label="Uploaded" value={`${fmtMB(jDone)} / ${fmtMB(j.file.size)} MB`} />
                        <Stat label="Speed" value={`${(jSpeed / 1024 / 1024).toFixed(2)} MB/s`} />
                        <Stat label="Avg" value={`${(jAvg / 1024 / 1024).toFixed(2)} MB/s`} />
                        <Stat label="Elapsed / ETA" value={`${fmtETA(jElapsed)} · ${fmtETA(jEta)}`} />
                        <div className="col-span-2 sm:col-span-1 flex flex-col items-end">
                          <span className="text-[10px] uppercase tracking-wide text-white/40">Trend · peak {(jPeak / 1024 / 1024).toFixed(1)} MB/s</span>
                          <Sparkline data={(jStats?.history ?? []).map((b) => b / 1024 / 1024)} width={120} height={30} />
                        </div>
                      </div>
                    )}
                    {!showStats && (
                      <div className="mt-1 text-[11px] text-white/50">{statusLabel}…</div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
