import { useCallback, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import * as tus from "tus-js-client";
import { Upload, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { createVideoRecord } from "@/lib/videos.functions";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

function tusUpload(bucket: string, path: string, file: File | Blob, onProgress?: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${SUPABASE_KEY}`, "x-upsert": "true", apikey: SUPABASE_KEY },
      uploadDataDuringCreation: true,
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

type Job = {
  id: string;
  file: File;
  progress: number;
  status: "queued" | "thumb" | "uploading" | "saving" | "done" | "error";
  message?: string;
};

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
        const scale = Math.min(1, 640 / w);
        canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d"); if (!ctx) { done(null); return; }
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => done(b), "image/jpeg", 0.82);
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
  const _create = useServerFn(createVideoRecord);

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

      await tusUpload("videos", storagePath, file, (pct) => updateJob(job.id, { progress: pct }));

      updateJob(job.id, { status: "saving", message: "Finalizing...", progress: 100 });

      const title = file.name.replace(/\.[^.]+$/, "");
      await _create({ data: {
        title, storagePath, thumbnailPath, sizeBytes: file.size, mimeType: file.type || undefined,
        extension: ext || undefined, durationSec: meta.duration || undefined,
        width: meta.width || undefined, height: meta.height || undefined,
        categoryId: categoryId,
      }});

      updateJob(job.id, { status: "done", message: "Uploaded" });
      onDone();
    } catch (e: unknown) {
      updateJob(job.id, { status: "error", message: (e as Error).message || "Upload failed" });
    }
  }, [_create, categoryId, onDone]);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const newJobs: Job[] = Array.from(files).map((file) => ({
      id: crypto.randomUUID(), file, progress: 0, status: "queued",
    }));
    setJobs((prev) => [...prev, ...newJobs]);
    newJobs.forEach(processFile);
  };

  return (
    <div>
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
        <p className="mt-1 text-xs text-white/50">MP4, WebM, MOV, MKV — up to 50 GB each</p>
        <input ref={inputRef} type="file" multiple accept="video/*,.mkv,.avi" hidden onChange={(e) => addFiles(e.target.files)} />
      </div>

      {jobs.length > 0 && (
        <div className="mt-4 space-y-2">
          {jobs.map((j) => (
            <div key={j.id} className="p-3 rounded-xl bg-white/5 border border-white/10">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0">
                  {j.status === "done" ? <CheckCircle2 className="w-5 h-5 text-green-400" /> :
                   j.status === "error" ? <AlertCircle className="w-5 h-5 text-red-400" /> :
                   <Loader2 className="w-5 h-5 text-red-400 animate-spin" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{j.file.name}</p>
                  <p className="text-xs text-white/50">{j.message ?? j.status} — {(j.file.size / 1024 / 1024).toFixed(1)} MB</p>
                </div>
                {j.status === "done" && (
                  <button onClick={() => setJobs((p) => p.filter((x) => x.id !== j.id))} className="p-1 text-white/40 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {(j.status === "uploading" || j.status === "saving") && (
                <div className="mt-2 h-1 bg-white/10 rounded overflow-hidden">
                  <div className="h-full bg-red-500 transition-all" style={{ width: `${j.progress}%` }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
