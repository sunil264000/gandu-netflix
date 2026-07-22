import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import * as tus from "tus-js-client";
import { Upload, X, CheckCircle2, AlertCircle, Loader2, FolderUp, Activity } from "lucide-react";
import { createVideoRecord, createCategory, listCategories } from "@/lib/videos.functions";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const DIRECT_UPLOAD_LIMIT = 42 * 1024 * 1024;
const VIDEO_CHUNK_SIZE = 32 * 1024 * 1024;

function tusUpload(bucket: string, path: string, file: File | Blob, onProgress?: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { Authorization: `Bearer ${SUPABASE_KEY}`, "x-upsert": "true", apikey: SUPABASE_KEY },
      // Keep the initial POST body empty. Sending data during creation can make
      // large browser uploads fail with a 413 before chunked PATCH uploads start.
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

async function uploadChunkedVideo(file: File, basePath: string, onProgress?: (pct: number) => void) {
  const chunkCount = Math.ceil(file.size / VIDEO_CHUNK_SIZE);
  let uploaded = 0;

  for (let index = 0; index < chunkCount; index += 1) {
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

// Grab a thumbnail from the video by seeking + drawing to canvas.
async function extractThumbnail(file: File): Promise<{ blob: Blob | null; duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata"; v.src = url; v.muted = true; v.playsInline = true;
    const done = (blob: Blob | null) => { URL.revokeObjectURL(url); resolve({ blob, duration: v.duration || 0, width: v.videoWidth || 0, height: v.videoHeight || 0 }); };
    v.onloadedmetadata = () => {
      const seekTo = Math.min(Math.max(1, v.duration * 0.1), 30);
      v.currentTime = isFinite(seekTo) ? seekTo : 1;
    };
    v.onseeked = () => {
      try {
        const w = v.videoWidth, h = v.videoHeight;
        if (!w || !h) { done(null); return; }
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 1920 / w);
        canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d"); if (!ctx) { done(null); return; }
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => done(b), "image/jpeg", 0.95);
      } catch { done(null); }
    };
    v.onerror = () => done(null);
    setTimeout(() => done(null), 15000);
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

  const updateJob = (id: string, patch: Partial<Job>) =>
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const processFile = useCallback(async (job: Job) => {
    try {
      const file = job.file;
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const uid = crypto.randomUUID();
      const storagePath = `${uid}.${ext || "bin"}`;

      updateJob(job.id, { status: "thumb", message: "Generating thumbnail..." });
      const meta = await extractThumbnail(file);

      let thumbnailPath: string | undefined;
      if (meta.blob) {
        thumbnailPath = `${uid}.jpg`;
        try {
          await tusUpload("thumbnails", thumbnailPath, meta.blob);
        } catch { thumbnailPath = undefined; }
      }

      updateJob(job.id, { status: "uploading", message: "Uploading...", progress: 0 });

      let uploadMode: "single" | "chunked" = "single";
      let chunkCount: number | undefined;
      let chunkSizeBytes: number | undefined;

      if (file.size > DIRECT_UPLOAD_LIMIT) {
        uploadMode = "chunked";
        const chunkMeta = await uploadChunkedVideo(file, storagePath, (pct) => updateJob(job.id, { progress: pct }));
        chunkCount = chunkMeta.chunkCount;
        chunkSizeBytes = chunkMeta.chunkSizeBytes;
      } else {
        await tusUpload("videos", storagePath, file, (pct) => updateJob(job.id, { progress: pct }));
      }

      updateJob(job.id, { status: "saving", message: "Finalizing...", progress: 100 });

      const title = file.name.replace(/\.[^.]+$/, "");
      const effectiveCategoryId = job.categoryOverride !== undefined ? job.categoryOverride : categoryId;
      await _create({ data: {
        title, storagePath, thumbnailPath, sizeBytes: file.size, mimeType: file.type || undefined,
        extension: ext || undefined, durationSec: meta.duration || undefined,
        width: meta.width || undefined, height: meta.height || undefined,
        categoryId: effectiveCategoryId, uploadMode, chunkCount, chunkSizeBytes,
      }});

      updateJob(job.id, { status: "done", message: "Uploaded" });
      onDone();
    } catch (e: unknown) {
      updateJob(job.id, { status: "error", message: (e as Error).message || "Upload failed" });
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
  const perJobRef = useRef<Map<string, { bytes: number; t: number; speed: number; history: number[] }>>(new Map());
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
          perJobRef.current.set(j.id, { bytes: cur, t: now, speed: 0, history: [0] });
        } else {
          const jdt = (now - prev.t) / 1000;
          const jdb = cur - prev.bytes;
          if (jdt > 0) {
            const inst = Math.max(0, jdb / jdt);
            const smoothed = prev.speed === 0 ? inst : prev.speed * 0.6 + inst * 0.4;
            const history = [...prev.history, smoothed].slice(-SPARK_MAX);
            perJobRef.current.set(j.id, { bytes: cur, t: now, speed: smoothed, history });
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
                  {showStats && (
                    <div className="text-right text-xs text-white/70 tabular-nums whitespace-nowrap">
                      <div className="text-white font-medium">{j.progress.toFixed(1)}%</div>
                      <div>{(jSpeed / 1024 / 1024).toFixed(2)} MB/s · ETA {fmtETA(jEta)}</div>
                    </div>
                  )}
                  {j.status === "done" && (
                    <button onClick={() => setJobs((p) => p.filter((x) => x.id !== j.id))} className="p-1 text-white/40 hover:text-white">
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
                    <div className="mt-1 flex justify-between text-[11px] text-white/50 tabular-nums">
                      <span>{showStats ? `${fmtMB(jDone)} / ${fmtMB(j.file.size)} MB` : statusLabel + "…"}</span>
                      <span>{showStats ? (j.status === "saving" ? "Finalizing…" : "Live") : ""}</span>
                    </div>
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
