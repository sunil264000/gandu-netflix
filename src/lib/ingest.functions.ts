// Server-side URL ingest: the server downloads a direct video link and stores
// it as chunked objects, so the browser/home connection never carries the file.
//
// A job is processed in short "pumps" (a few chunks per call) so each request
// stays well inside the platform's execution budget. Any device can drive the
// pump loop — progress lives in the database.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { resolveGDriveUrl } from "@/lib/gdrive.functions";

const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB parts
const PARALLEL_PARTS = 24; // Extreme concurrency for max throughput
const FETCH_RETRIES = 4;
const ANON_USER = "00000000-0000-0000-0000-000000000000";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function partPath(base: string, index: number) {
  return `${base}.part-${String(index).padStart(6, "0")}`;
}

function nameFromUrl(url: string, headerName?: string | null) {
  if (headerName) {
    const m = headerName.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    if (m?.[1]) return decodeURIComponent(m[1]);
  }
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
    if (last) return last;
  } catch {
    /* ignore */
  }
  return `download-${Date.now()}.mp4`;
}

function safeName(n: string) {
  return n.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 180);
}

// Storage object keys reject spaces and most punctuation ("Invalid key" errors),
// so the on-disk name is strictly ASCII-safe while the display name stays pretty.
function storageSafe(n: string) {
  return (
    n
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^[_.]+/, "")
      .slice(0, 120) || "video.mkv"
  );
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

async function probe(url: string) {
  // HEAD first; many hosts only answer correctly to a 1-byte ranged GET.
  let ref = "";
  try {
    ref = new URL(url).origin + "/";
  } catch {
    /* ignore */
  }
  const baseHeaders: Record<string, string> = { "user-agent": BROWSER_UA, accept: "*/*", ...(ref ? { referer: ref } : {}) };
  const head = await fetch(url, { method: "HEAD", headers: baseHeaders, redirect: "follow" }).catch(() => null);
  let size = Number(head?.headers.get("content-length") ?? 0);
  let type = head?.headers.get("content-type") ?? null;
  let disp = head?.headers.get("content-disposition") ?? null;
  let ranges = (head?.headers.get("accept-ranges") ?? "").includes("bytes");

  if (!size || !ranges) {
    const probeRes = await fetch(url, {
      headers: { ...baseHeaders, range: "bytes=0-0" },
      redirect: "follow",
    });
    const cr = probeRes.headers.get("content-range");
    if (probeRes.status === 206 && cr) {
      ranges = true;
      const total = Number(cr.split("/")[1]);
      if (Number.isFinite(total) && total > 0) size = total;
    } else if (!size) {
      size = Number(probeRes.headers.get("content-length") ?? 0);
    }
    type = type ?? probeRes.headers.get("content-type");
    disp = disp ?? probeRes.headers.get("content-disposition");
    try {
      await probeRes.arrayBuffer();
    } catch {
      /* ignore */
    }
  }
  return { size, type, disp, ranges };
}

export const startUrlIngest = createServerFn({ method: "POST" })
  .inputValidator((i: { url: string; title?: string; categoryId?: string | null }) =>
    z
      .object({
        url: z.string().url().max(4000),
        title: z.string().max(300).optional(),
        categoryId: z.string().uuid().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    if (!/^https?:$/.test(new URL(data.url).protocol)) throw new Error("Only http(s) links are supported");
    const sb = await admin();

    const info = await probe(data.url);
    if (!info.size || info.size < 1024)
      throw new Error(
        "Could not read the file size from that link — it may need a login, be an HTML page, or be a temporary link that has expired.",
      );
    const fileName = safeName(nameFromUrl(data.url, info.disp));
    if (!info.ranges) {
      data.url = data.url.includes("#") ? data.url.replace(/#.*$/, "#norange") : data.url + "#norange";
    }
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "mp4";
    const { prettyTitle } = await import("@/lib/poster.server");
    // Imported links are release names; show a clean title in the library.
    const title = data.title?.trim() || prettyTitle(fileName);

    const chunkCount = Math.ceil(info.size / CHUNK_SIZE);
    const storagePath = `ingest/${crypto.randomUUID()}/${storageSafe(fileName)}`;

    const { data: video, error: vErr } = await sb
      .from("videos")
      .insert({
        title,
        storage_path: storagePath,
        size_bytes: info.size,
        mime_type: info.type ?? null,
        extension: ext,
        category_id: data.categoryId ?? null,
        uploaded_by: ANON_USER,
        upload_mode: "chunked",
        chunk_size_bytes: CHUNK_SIZE,
        chunk_count: chunkCount,
      })
      .select("id")
      .single();
    if (vErr) throw vErr;

    const { data: job, error: jErr } = await sb
      .from("ingest_jobs")
      .insert({
        video_id: video.id,
        source_url: data.url,
        file_name: fileName,
        storage_path: storagePath,
        total_bytes: info.size,
        chunk_size_bytes: CHUNK_SIZE,
        chunk_count: chunkCount,
        status: "queued",
      })
      .select("*")
      .single();
    if (jErr) throw jErr;

    // Artwork lookup runs immediately so the card looks right while it downloads.
    try {
      const { autoPoster } = await import("@/lib/poster.server");
      await autoPoster(sb, video.id, fileName);
    } catch {
      /* best effort */
    }

    return { jobId: job.id as string, videoId: video.id as string, totalBytes: info.size, chunkCount };
  });

async function fetchPart(url: string, start: number, end: number): Promise<ArrayBuffer> {
  const want = end - start + 1;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < FETCH_RETRIES; attempt += 1) {
    try {
      let origin = "";
      try {
        origin = new URL(url).origin + "/";
      } catch {
        /* ignore */
      }
      const res = await fetch(url, {
        headers: {
          range: `bytes=${start}-${end}`,
          "user-agent": BROWSER_UA,
          accept: "*/*",
          ...(origin ? { referer: origin } : {}),
        },
        redirect: "follow",
      });
      if (res.status === 200 && want < Number(res.headers.get("content-length") ?? 0)) {
        throw new Error("host ignored the range request");
      }
      if (res.status !== 206 && res.status !== 200) throw new Error(`source responded ${res.status}`);
      const buf = await res.arrayBuffer();
      if (buf.byteLength === 0) throw new Error("empty part");
      if (buf.byteLength > want) throw new Error("host returned more data than requested");
      return buf;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw new Error(`part ${start}-${end} failed: ${String(lastErr)}`);
}


export const activeIngests = new Map<string, AbortController>();

export const pumpIngest = createServerFn({ method: "POST" })
  .inputValidator((i: { jobId: string }) => z.object({ jobId: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: job, error } = await sb.from("ingest_jobs").select("*").eq("id", data.jobId).maybeSingle();
    if (error) throw error;
    if (!job) throw new Error("job_not_found");
    if (job.status === "done") {
      return { status: job.status as string, chunksDone: job.chunks_done, chunkCount: job.chunk_count };
    }

    if (activeIngests.has(job.id)) {
      return { status: "running", chunksDone: job.chunks_done, chunkCount: job.chunk_count };
    }

    const abortCtrl = new AbortController();
    activeIngests.set(job.id, abortCtrl);

    await sb.from("ingest_jobs").update({ status: "running", error: null }).eq("id", job.id);

    // Run the actual ingest in the background
    void (async () => {
      try {
        const cs = Number(job.chunk_size_bytes);
        const total = Number(job.total_bytes);
        let done = Number(job.chunks_done);
        const t0 = Date.now();
        let bytesThisPump = 0;

        const isNoRange = job.source_url.endsWith("#norange");
        const cleanUrl = job.source_url.replace(/#norange$/, "");
        const sourceUrl = resolveGDriveUrl(cleanUrl) ?? cleanUrl;
      if (isNoRange) {
        // For non-range hosts, we MUST fetch the stream linearly and upload parts on the fly.
        // We will run until the stream completes, ignoring PUMP_BUDGET_MS.
        let origin = "";
        try { origin = new URL(sourceUrl).origin + "/"; } catch {}
        const res = await fetch(sourceUrl, {
          headers: { "user-agent": BROWSER_UA, accept: "*/*", ...(origin ? { referer: origin } : {}) },
          redirect: "follow",
        });
        if (!res.ok || !res.body) throw new Error(`source responded ${res.status}`);
        
        const reader = res.body.getReader();
        let bytesToSkip = done * cs;
        
        let currentChunk = new Uint8Array(cs);
        let currentChunkLen = 0;
        
        let highestCompleted = done;
        const finishedIndexes = new Set<number>();
        const activeUploads: Promise<void>[] = [];
        let bgError: any = null;
        let uploadStartTime = Date.now();
        let finishedSkipping = bytesToSkip === 0;
        
        const uploadChunk = async (buf: Uint8Array, index: number) => {
          if (abortCtrl.signal.aborted) throw new Error("cancelled");
          const uploadCtrl = new AbortController();
          const uploadTimer = setTimeout(() => uploadCtrl.abort(), 60_000);
          try {
            const { error: upErr } = await sb.storage.from("videos").upload(partPath(job.storage_path, index), new Blob([buf]), { upsert: true, contentType: "application/octet-stream", cacheControl: "31536000" });
            if (upErr) throw new Error(`store part ${index}: ${upErr.message}`);
            
            finishedIndexes.add(index);
            while (finishedIndexes.has(highestCompleted)) {
              highestCompleted++;
            }
            
            const elapsed = (Date.now() - uploadStartTime) / 1000;
            sb.from("ingest_jobs").update({
              chunks_done: highestCompleted,
              bytes_done: Math.min(total, highestCompleted * cs),
              last_speed_bps: elapsed > 0 ? ((highestCompleted - done) * cs) / elapsed : null,
            }).eq("id", job.id).then();
          } finally { clearTimeout(uploadTimer); }
        };
        
        let nextIndex = done;
        
        while (nextIndex < job.chunk_count) {
          if (abortCtrl.signal.aborted) throw new Error("cancelled");
          if (bgError) throw bgError;
          
          const { done: streamDone, value } = await reader.read();
          if (streamDone) {
            if (currentChunkLen > 0) {
              const buf = currentChunk.slice(0, currentChunkLen);
              const p = uploadChunk(buf, nextIndex).catch(e => { bgError = e; });
              activeUploads.push(p);
              nextIndex++;
            }
            break;
          }
          
          let chunk = value;
          if (bytesToSkip > 0) {
            if (chunk.byteLength <= bytesToSkip) {
              bytesToSkip -= chunk.byteLength;
              if (bytesToSkip === 0 && !finishedSkipping) {
                finishedSkipping = true;
                uploadStartTime = Date.now();
              }
              continue;
            } else {
              chunk = chunk.slice(bytesToSkip);
              bytesToSkip = 0;
              if (!finishedSkipping) {
                finishedSkipping = true;
                uploadStartTime = Date.now();
              }
            }
          }
          
          let offset = 0;
          while (offset < chunk.byteLength) {
            const take = Math.min(chunk.byteLength - offset, cs - currentChunkLen);
            currentChunk.set(chunk.subarray(offset, offset + take), currentChunkLen);
            currentChunkLen += take;
            offset += take;
            
            if (currentChunkLen === cs) {
              const buf = currentChunk.slice(0, cs);
              const p = uploadChunk(buf, nextIndex).catch(e => { bgError = e; });
              activeUploads.push(p);
              p.finally(() => {
                activeUploads.splice(activeUploads.indexOf(p), 1);
              });
              
              if (activeUploads.length >= PARALLEL_PARTS) {
                await Promise.race(activeUploads);
              }
              
              nextIndex++;
              currentChunkLen = 0;
            }
          }
        }
        
        await Promise.all(activeUploads);
        if (bgError) throw bgError;
        done = highestCompleted;
      } else {
        while (done < job.chunk_count) {
          if (abortCtrl.signal.aborted) throw new Error("cancelled");
          
          const batch: number[] = [];
          for (let k = 0; k < PARALLEL_PARTS && done + k < job.chunk_count; k += 1) batch.push(done + k);

          await Promise.all(
            batch.map(async (index) => {
              if (abortCtrl.signal.aborted) throw new Error("cancelled");
              const start = index * cs;
              const end = Math.min(total - 1, start + cs - 1);
              const buf = await fetchPart(sourceUrl, start, end);
              bytesThisPump += buf.byteLength;
              const uploadCtrl = new AbortController();
              const uploadTimer = setTimeout(() => uploadCtrl.abort(), 60_000);
              try {
                const { error: upErr } = await sb.storage
                  .from("videos")
                  .upload(partPath(job.storage_path, index), new Blob([buf]), {
                    upsert: true,
                    contentType: "application/octet-stream",
                    cacheControl: "31536000",
                  });
                if (upErr) throw new Error(`store part ${index}: ${upErr.message}`);
              } finally {
                clearTimeout(uploadTimer);
              }
            }),
          );

          done += batch.length;
          const elapsed = (Date.now() - t0) / 1000;
          await sb
            .from("ingest_jobs")
            .update({
              chunks_done: done,
              bytes_done: Math.min(total, done * cs),
              last_speed_bps: elapsed > 0 ? bytesThisPump / elapsed : null,
            })
            .eq("id", job.id);
        }
      }

      const finished = done >= job.chunk_count;
      if (finished) {
        await sb
          .from("ingest_jobs")
          .update({ status: "done", chunks_done: done, bytes_done: total })
          .eq("id", job.id);
      }
    } catch (e) {
      if (abortCtrl.signal.aborted) return;
      const message = e instanceof Error ? e.message : String(e);
      await sb.from("ingest_jobs").update({ status: "error", error: message.slice(0, 500) }).eq("id", job.id);
    } finally {
      activeIngests.delete(job.id);
    }
  })();

  return { status: "running", chunksDone: job.chunks_done, chunkCount: job.chunk_count };
});

export const listIngestJobs = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("ingest_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) throw error;
  return (data ?? []) as {
    id: string;
    video_id: string | null;
    source_url: string;
    file_name: string;
    total_bytes: number;
    chunk_count: number;
    chunks_done: number;
    bytes_done: number;
    status: string;
    error: string | null;
    last_speed_bps: number | null;
    created_at: string;
  }[];
});

export const cancelIngest = createServerFn({ method: "POST" })
  .inputValidator((i: { jobId: string; deleteVideo?: boolean }) =>
    z.object({ jobId: z.string().uuid(), deleteVideo: z.boolean().default(true) }).parse(i),
  )
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: job } = await sb.from("ingest_jobs").select("*").eq("id", data.jobId).maybeSingle();
    if (!job) return { ok: true };
    await sb.from("ingest_jobs").update({ status: "cancelled" }).eq("id", job.id);
    
    const abortCtrl = activeIngests.get(job.id);
    if (abortCtrl) abortCtrl.abort();

    if (data.deleteVideo) {
      const paths: string[] = [];
      for (let i = 0; i < job.chunk_count; i += 1) paths.push(partPath(job.storage_path, i));
      if (paths.length) {
        try {
          await sb.storage.from("videos").remove(paths);
        } catch {
          /* ignore */
        }
      }
      if (job.video_id) {
        await sb.from("favorites").delete().eq("video_id", job.video_id);
        await sb.from("watch_history").delete().eq("video_id", job.video_id);
        await sb.from("videos").delete().eq("id", job.video_id);
      }
      await sb.from("ingest_jobs").delete().eq("id", job.id);
    }
    return { ok: true };
  });
