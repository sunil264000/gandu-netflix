import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Loader2, Trash2, Download } from "lucide-react";
import { startUrlIngest, pumpIngest, listIngestJobs, cancelIngest } from "@/lib/ingest.functions";
import { autoPosterForVideo } from "@/lib/posters.functions";
import { attachAudioTrack } from "@/lib/videos.functions";
import { extractCompatibleAudioFromServer, serverRescueSupported, likelyNeedsCompatibleAudio } from "@/lib/audioTranscode";
import { uploadAny } from "@/lib/storageUpload";

function fmtBytes(b: number) {
  if (b >= 1e12) return (b / 1e12).toFixed(2) + " TB";
  if (b >= 1e9) return (b / 1e9).toFixed(2) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  return (b / 1e3).toFixed(0) + " KB";
}

/**
 * Server-side importer: paste a direct download link and the server pulls the
 * file straight into storage. The browser only sends tiny "pump" requests, so
 * none of the payload travels over the home connection.
 */
export function UrlIngest({ categoryId, onDone }: { categoryId: string | null; onDone: () => void }) {
  const qc = useQueryClient();
  const _start = useServerFn(startUrlIngest);
  const _pump = useServerFn(pumpIngest);
  const _list = useServerFn(listIngestJobs);
  const _cancel = useServerFn(cancelIngest);
  const _poster = useServerFn(autoPosterForVideo);
  const _attach = useServerFn(attachAudioTrack);
  const [post, setPost] = useState<Record<string, string>>({});

  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const pumping = useRef<Set<string>>(new Set());

  const jobs = useQuery({
    queryKey: ["admin:ingest"],
    queryFn: () => _list(),
    refetchInterval: 3000,
  });

  // Once the bytes are in storage the import isn't really finished: the title
  // still needs real artwork, and release rips need an AAC companion track
  // before any browser can play their Dolby/DTS soundtrack. Both run here,
  // automatically, so an imported file is watchable without any manual step.
  const finishImport = useCallback(
    async (job: { id: string; video_id: string | null; file_name: string; total_bytes: number }) => {
      if (!job.video_id) return;
      const videoId = job.video_id;
      try {
        setPost((m) => ({ ...m, [job.id]: "Fetching artworkâ€¦" }));
        await _poster({ data: { videoId } });
        qc.invalidateQueries({ queryKey: ["admin:videos"] });
      } catch { /* artwork is best-effort */ }

      const needsAac =
        likelyNeedsCompatibleAudio(job.file_name) || !/\.(mp4|m4v|webm)$/i.test(job.file_name);
      if (needsAac && serverRescueSupported()) {
        try {
          const res = await extractCompatibleAudioFromServer({
            streamUrl: `/api/public/videos/stream?id=${encodeURIComponent(videoId)}`,
            fileName: job.file_name,
            sizeBytes: Number(job.total_bytes),
            onProgress: (p) =>
              setPost((m) => ({
                ...m,
                [job.id]: `${p.phase === "converting" ? "Converting audio" : "Reading audio"} ${p.pct.toFixed(0)}%`,
              })),
          });
          setPost((m) => ({ ...m, [job.id]: "Saving audioâ€¦" }));
          const path = `audio/${videoId}.${res.ext}`;
          await uploadAny("videos", path, new File([res.blob], `${videoId}.${res.ext}`, { type: "audio/mp4" }));
          await _attach({ data: { videoId, path, label: res.label } });
        } catch { /* the admin "Fix audio" button remains as a manual fallback */ }
      }
      setPost((m) => { const n = { ...m }; delete n[job.id]; return n; });
      qc.invalidateQueries({ queryKey: ["admin:videos"] });
      onDone();
    },
    [_poster, _attach, qc, onDone],
  );

  // Keep every unfinished job moving: one in-flight pump per job at a time.
  useEffect(() => {
    const active = (jobs.data ?? []).filter((j) => j.status === "queued" || j.status === "running");
    for (const job of active) {
      if (pumping.current.has(job.id)) continue;
      pumping.current.add(job.id);
      void (async () => {
        try {
          for (;;) {
            const r = await _pump({ data: { jobId: job.id } });
            qc.invalidateQueries({ queryKey: ["admin:ingest"] });
            if (r.status !== "running") break;
          }
          qc.invalidateQueries({ queryKey: ["admin:videos"] });
          onDone();
          await finishImport(job);
        } catch {
          /* surfaced through the job row */
        } finally {
          pumping.current.delete(job.id);
        }
      })();
    }
  }, [jobs.data, _pump, qc, onDone, finishImport]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setStarting(true);
    setErr(null);
    setNote(null);
    try {
      const result = await _start({ data: { url: url.trim(), title: title.trim() || undefined, categoryId } });
      if ("folder" in result && result.folder) {
        setNote(`Queued ${result.count} video${result.count === 1 ? "" : "s"} from that Drive folder.`);
      } else {
        setNote("Import queued. The server will download it into your library.");
      }
      setUrl("");
      setTitle("");
      qc.invalidateQueries({ queryKey: ["admin:ingest"] });
      qc.invalidateQueries({ queryKey: ["admin:videos"] });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not start the import");
    } finally {
      setStarting(false);
    }
  };

  const list = jobs.data ?? [];

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Link2 className="h-5 w-5 text-red-400" />
        <h2 className="text-xl font-bold">Import from link or Google Drive</h2>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/50">
          server-side
        </span>
      </div>

      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[1fr_14rem_auto]">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Direct video link, Google Drive file link, or Google Drive folder link"
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-red-500/60"
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)"
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-red-500/60"
        />
        <button
          disabled={starting}
          className="flex items-center justify-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Import
        </button>
      </form>
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
      {note && <p className="mt-2 text-xs text-emerald-400">{note}</p>}

      {list.length > 0 && (
        <div className="mt-4 space-y-2">
          {list.map((j) => {
            const pct = j.total_bytes ? Math.min(100, (Number(j.bytes_done) / Number(j.total_bytes)) * 100) : 0;
            const speed = j.last_speed_bps ? `${(j.last_speed_bps / 1e6).toFixed(1)} MB/s` : "";
            return (
              <div key={j.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{j.file_name}</p>
                    <p className="text-[11px] text-white/45">
                      {fmtBytes(Number(j.bytes_done))} / {fmtBytes(Number(j.total_bytes))}
                      {speed ? ` Â· ${speed}` : ""} Â· {post[j.id] ?? j.status}
                    </p>
                  </div>
                  <span className="text-xs tabular-nums text-white/70">{pct.toFixed(1)}%</span>
                  {(j.status === "error" || j.status === "cancelled") && (
                    <button
                      onClick={async () => {
                        try {
                          for (;;) {
                            const r = await _pump({ data: { jobId: j.id } });
                            qc.invalidateQueries({ queryKey: ["admin:ingest"] });
                            if (r.status !== "running") break;
                          }
                          qc.invalidateQueries({ queryKey: ["admin:videos"] });
                          onDone();
                        } catch {
                          qc.invalidateQueries({ queryKey: ["admin:ingest"] });
                        }
                      }}
                      className="rounded-md border border-white/10 px-2 py-1 text-[11px] font-medium text-white/70 hover:bg-white/10"
                    >
                      Resume
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      const wipe = j.status !== "done";
                      if (wipe && !confirm("Cancel this import and delete what was fetched?")) return;
                      await _cancel({ data: { jobId: j.id, deleteVideo: wipe } });
                      qc.invalidateQueries({ queryKey: ["admin:ingest"] });
                      onDone();
                    }}
                    className="rounded p-1.5 text-white/40 hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full ${j.status === "error" ? "bg-red-500" : "bg-gradient-to-r from-red-500 to-orange-400"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {j.error && <p className="mt-1 truncate text-[11px] text-red-400">{j.error}</p>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
