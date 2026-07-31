import { useCallback, useRef, useState } from "react";
import { Download, X, Zap, CheckCircle2 } from "lucide-react";

/**
 * Multi-connection downloader.
 *
 * A normal browser download uses ONE connection, so it inherits the latency of
 * a single upstream read. This opens `CONNECTIONS` parallel range requests
 * against the stream endpoint (`dl=1`, which serves exact ranges with no
 * player windowing) and streams the pieces to disk in order via the File
 * System Access API — no full-file buffering, so a 40GB file works fine.
 *
 * Browsers without showSaveFilePicker (Firefox/Safari/iOS) fall back to a
 * plain single-connection download link.
 */

const SEGMENT_BYTES = 8 * 1024 * 1024;
const CONNECTIONS = 8;

type Phase = "idle" | "running" | "done" | "error";

function fmtBytes(n: number) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function fmtEta(sec: number) {
  if (!Number.isFinite(sec) || sec <= 0) return "--";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

export function TurboDownload({
  videoId,
  fileName,
  sizeBytes,
  className = "",
}: {
  videoId: string;
  fileName: string;
  sizeBytes: number;
  className?: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [done, setDone] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const safeName = fileName.replace(/[\\/:*?"<>|]+/g, "_") || "video";
  const url = (start: number, end: number) =>
    `/api/public/videos/stream?id=${encodeURIComponent(videoId)}&dl=1&name=${encodeURIComponent(safeName)}#${start}-${end}`;

  const supportsFS =
    typeof window !== "undefined" && typeof (window as any).showSaveFilePicker === "function";

  const start = useCallback(async () => {
    setErr(null);
    cancelRef.current = false;

    let handle: any;
    try {
      handle = await (window as any).showSaveFilePicker({
        suggestedName: safeName,
        types: [{ description: "Video", accept: { "video/*": [`.${safeName.split(".").pop() || "mp4"}`] } }],
      });
    } catch {
      return; // user cancelled the save dialog
    }

    const writable = await handle.createWritable();
    setPhase("running");
    setDone(0);

    const total = sizeBytes;
    const segments: Array<{ start: number; end: number }> = [];
    for (let s = 0; s < total; s += SEGMENT_BYTES) {
      segments.push({ start: s, end: Math.min(s + SEGMENT_BYTES - 1, total - 1) });
    }

    const buffers = new Map<number, ArrayBuffer>();
    const inflight = new Map<number, Promise<void>>();
    let received = 0;
    const t0 = performance.now();

    const fetchSeg = async (i: number) => {
      const seg = segments[i];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (cancelRef.current) return;
        try {
          const res = await fetch(url(seg.start, seg.end), {
            headers: { range: `bytes=${seg.start}-${seg.end}` },
          });
          if (res.status !== 206 && res.status !== 200) throw new Error(`http_${res.status}`);
          const buf = await res.arrayBuffer();
          buffers.set(i, buf);
          received += buf.byteLength;
          setDone(received);
          setSpeed(received / Math.max(0.001, (performance.now() - t0) / 1000));
          return;
        } catch (e) {
          if (attempt === 3) throw e;
          await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
        }
      }
    };

    const kick = (i: number) => {
      if (i >= segments.length) return;
      const p = fetchSeg(i);
      p.catch(() => {});
      inflight.set(i, p);
    };

    try {
      for (let i = 0; i < Math.min(CONNECTIONS, segments.length); i += 1) kick(i);
      for (let i = 0; i < segments.length; i += 1) {
        if (cancelRef.current) throw new Error("cancelled");
        await inflight.get(i);
        inflight.delete(i);
        kick(i + CONNECTIONS);
        const buf = buffers.get(i);
        buffers.delete(i);
        if (!buf) throw new Error("segment_missing");
        await writable.write(buf);
      }
      await writable.close();
      setPhase("done");
    } catch (e) {
      try {
        await writable.abort();
      } catch {
        /* ignore */
      }
      if (cancelRef.current) {
        setPhase("idle");
      } else {
        setErr(e instanceof Error ? e.message : "Download failed");
        setPhase("error");
      }
    }
  }, [safeName, sizeBytes, videoId]);

  if (!supportsFS) {
    return (
      <a
        href={`/api/public/videos/stream?id=${encodeURIComponent(videoId)}&dl=1&name=${encodeURIComponent(safeName)}`}
        download={safeName}
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800/70 hover:bg-zinc-700 border border-zinc-700/60 text-zinc-200 text-[11px] font-bold uppercase tracking-wider transition ${className}`}
      >
        <Download className="w-3.5 h-3.5" /> Download ({fmtBytes(sizeBytes)})
      </a>
    );
  }

  if (phase === "running") {
    const pct = sizeBytes ? Math.min(100, (done / sizeBytes) * 100) : 0;
    const eta = speed > 0 ? (sizeBytes - done) / speed : Infinity;
    return (
      <div className={`w-full rounded-xl bg-zinc-900/70 border border-zinc-700/60 px-3 py-2.5 ${className}`}>
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-zinc-200">
          <Zap className="w-3.5 h-3.5 text-red-400 animate-pulse" />
          Turbo download · {CONNECTIONS} streams
          <button
            type="button"
            onClick={() => {
              cancelRef.current = true;
            }}
            className="ml-auto text-zinc-400 hover:text-white"
            aria-label="Cancel download"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-red-600 to-red-400 transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 text-[10px] font-medium text-zinc-400">
          <span className="text-white">{pct.toFixed(1)}%</span>
          <span>{fmtBytes(done)} / {fmtBytes(sizeBytes)}</span>
          <span className="text-red-300">{fmtBytes(speed)}/s</span>
          <span>ETA {fmtEta(eta)}</span>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold uppercase tracking-wider ${className}`}>
        <CheckCircle2 className="w-3.5 h-3.5" /> Saved to disk
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      title={`Downloads with ${CONNECTIONS} parallel connections straight to disk`}
      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800/70 hover:bg-zinc-700 border border-zinc-700/60 text-zinc-200 text-[11px] font-bold uppercase tracking-wider transition ${className}`}
    >
      <Zap className="w-3.5 h-3.5 text-red-400" />
      {phase === "error" ? `Retry download` : `Turbo download (${fmtBytes(sizeBytes)})`}
      {err ? <span className="normal-case font-medium text-red-400">· {err}</span> : null}
    </button>
  );
}
