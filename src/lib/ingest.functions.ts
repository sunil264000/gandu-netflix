// Server-side URL ingest: the server downloads a direct video link and stores
// it as chunked objects, so the browser/home connection never carries the file.
//
// A job is processed in short "pumps" (a few chunks per call) so each request
// stays well inside the platform's execution budget. Any device can drive the
// pump loop — progress lives in the database.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { resolveGDriveUrl } from "@/lib/gdrive.functions";

const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB parts for maximum concurrent throughput without OOM
const FETCH_RETRIES = 6;
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

export async function executeStartUrlIngest(url: string, title?: string, categoryId?: string | null) {
    if (!/^https?:$/.test(new URL(url).protocol)) throw new Error("Only http(s) links are supported");
    const sb = await admin();

    const info = await probe(url);
    if (!info.size || info.size < 1024)
      throw new Error(
        "Could not read the file size from that link — it may need a login, be an HTML page, or be a temporary link that has expired.",
      );
    const fileName = safeName(nameFromUrl(url, info.disp));
    if (!info.ranges) {
      url = url.includes("#") ? url.replace(/#.*$/, "#norange") : url + "#norange";
    }
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "mp4";
    const { prettyTitle } = await import("@/lib/poster.server");
    // Imported links are release names; show a clean title in the library.
    const finalTitle = title?.trim() || prettyTitle(fileName);

    const chunkCount = Math.ceil(info.size / CHUNK_SIZE);
    const storagePath = `ingest/${crypto.randomUUID()}/${storageSafe(fileName)}`;

    const { data: video, error: vErr } = await sb
      .from("videos")
      .insert({
        title: finalTitle,
        storage_path: storagePath,
        size_bytes: info.size,
        mime_type: info.type ?? null,
        extension: ext,
        category_id: categoryId ?? null,
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
        source_url: url,
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
    return executeStartUrlIngest(data.url, data.title, data.categoryId);
  });

async function fetchPart(url: string, start: number, end: number, isGDrive = false): Promise<ArrayBuffer> {
  const want = end - start + 1;
  let lastErr: unknown = null;
  const maxRetries = isGDrive ? 8 : FETCH_RETRIES;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      let origin = "";
      try { origin = new URL(url).origin + "/"; } catch { /* ignore */ }

      let res: Response;

      if (isGDrive) {
        // GDrive API: let fetch handle redirects normally (Google CDN redirects are fine)
        res = await fetch(url, {
          headers: {
            range: `bytes=${start}-${end}`,
            "user-agent": BROWSER_UA,
            accept: "*/*",
          },
          redirect: "follow",
        });
      } else {
        // Non-GDrive: manually follow redirects to preserve the Range header
        let redirectUrl = url;
        let redirectCount = 0;
        while (true) {
          if (redirectCount > 5) throw new Error("too many redirects");
          res = await fetch(redirectUrl, {
            headers: {
              range: `bytes=${start}-${end}`,
              "user-agent": BROWSER_UA,
              accept: "*/*",
              ...(origin ? { referer: origin } : {}),
            },
            redirect: "manual",
          });
          if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
            const loc = res.headers.get("location")!;
            redirectUrl = new URL(loc, redirectUrl).toString();
            redirectCount++;
            if (res.body) await res.body.cancel().catch(() => {});
            continue;
          }
          break;
        }
      }

      if (!res.ok && res.status !== 206) {
        if (res.body) await res.body.cancel().catch(() => {});
        if (isGDrive && (res.status === 403 || res.status === 429)) {
          throw new Error(`GDrive ${res.status} — will retry`);
        }
        if (!isGDrive && (res.status === 401 || res.status === 403 || res.status === 410)) {
          throw Object.assign(
            new Error(`Source returned ${res.status} — the download link has expired.`),
            { noRetry: true },
          );
        }
        throw new Error(`source responded ${res.status}`);
      }

      // 200 OK when we asked for a range = server ignored Range header
      if (res.status === 200 && start > 0) {
        if (res.body) await res.body.cancel().catch(() => {});
        throw new Error("host ignored range request");
      }

      if (!res.body) throw new Error("empty body");
      const reader = res.body.getReader();
      const chunk = new Uint8Array(want);
      let offset = 0;
      
      while (offset < want) {
        const { done, value } = await reader.read();
        if (done) break;
        const take = Math.min(value.byteLength, want - offset);
        chunk.set(value.subarray(0, take), offset);
        offset += take;
        if (offset >= want) {
          await reader.cancel().catch(() => {});
          break;
        }
      }
      
      if (offset === 0) throw new Error("empty part");
      return chunk.buffer.slice(0, offset);
      
    } catch (e: any) {
      if (e?.noRetry) throw e;
      lastErr = e;
      // GDrive: 2s, 4s, 6s... (max 16s). Others: 0.8s, 1.6s, 2.4s...
      const delay = isGDrive ? 2000 * (attempt + 1) : 800 * (attempt + 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(`part ${start}-${end} failed: ${String(lastErr)}`);
}

export async function executePump(jobId: string) {
    const sb = await admin();
    const { data: job, error } = await sb.from("ingest_jobs").select("*").eq("id", jobId).maybeSingle();
    if (error) throw error;
    if (!job) return { status: "cancelled", chunksDone: 0, chunkCount: 0 };
    if (job.status === "done" || job.status === "cancelled") {
      return { status: job.status as string, chunksDone: job.chunks_done, chunkCount: job.chunk_count };
    }

    let finalStatus = "running";
    try {
      await sb.from("ingest_jobs").update({ status: "running", error: null }).eq("id", job.id);

      const cs = Number(job.chunk_size_bytes);
      const total = Number(job.total_bytes);
      let done = Number(job.chunks_done);
      const t0 = Date.now();
      let bytesThisPump = 0;

      // GDrive rate-limits aggressively, so cap at 2 parallel downloads.
      // Old 24MB jobs also cap at 2 for memory safety. Everything else gets 8 for max speed.
      const isNoRange = job.source_url.endsWith("#norange");
      const cleanUrl = job.source_url.replace(/#norange$/, "");
      const isGDrive = cleanUrl.startsWith("gdrive:");
      const sourceUrl = resolveGDriveUrl(cleanUrl) ?? cleanUrl;
      const parallelLimit = isGDrive ? 2 : cs >= 20 * 1024 * 1024 ? 2 : 8;
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
              
              if (activeUploads.length >= parallelLimit) {
                await Promise.race(activeUploads);
              }
              
              nextIndex++;
              currentChunkLen = 0;
            }
          }
        }
        
        await Promise.all(activeUploads);
        if (bgError) throw bgError;
        finalStatus = done >= job.chunk_count ? "done" : "running";
      } else {
        // Run multiple back-to-back using a sliding window for maximum throughput!
        // This eliminates the "tail latency" of strict batches, ensuring we ALWAYS have
        // `parallelLimit` active connections saturating the gigabit pipe.
        const activeUploads: Promise<void>[] = [];
        let nextIndex = done;
        let bgError: any = null;

        while ((nextIndex < job.chunk_count || activeUploads.length > 0) && Date.now() - t0 < 15_000) {
          if (bgError) throw bgError;

          // Fill the sliding window up to parallelLimit
          while (activeUploads.length < parallelLimit && nextIndex < job.chunk_count) {
            const index = nextIndex++;
            const start = index * cs;
            const end = Math.min(total - 1, start + cs - 1);

            const p = (async () => {
              const buf = await fetchPart(sourceUrl, start, end, isGDrive);
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
            })().catch((e) => {
              bgError = e;
            });

            activeUploads.push(p);
            p.finally(() => {
              activeUploads.splice(activeUploads.indexOf(p), 1);
            });
          }

          if (activeUploads.length > 0) {
            await Promise.race(activeUploads);
          }
        }

        await Promise.all(activeUploads);
        if (bgError) throw bgError;

        // If Promise.all succeeds without bgError, then all chunks from `done` to `nextIndex - 1` have completed!
        done = nextIndex;
        const elapsed = (Date.now() - t0) / 1000;
        await sb
          .from("ingest_jobs")
          .update({
            chunks_done: done,
            bytes_done: Math.min(total, done * cs),
            last_speed_bps: elapsed > 0 ? bytesThisPump / elapsed : null,
          })
          .eq("id", job.id);

        finalStatus = done >= job.chunk_count ? "done" : "running";
      }

      if (finalStatus === "done") {
        await sb
          .from("ingest_jobs")
          .update({ status: "done", chunks_done: done, bytes_done: total })
          .eq("id", job.id);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await sb.from("ingest_jobs").update({ status: "error", error: message.slice(0, 500) }).eq("id", job.id);
      finalStatus = "error";
    }

    return { status: finalStatus, chunksDone: job.chunks_done, chunkCount: job.chunk_count };
}

export const pumpIngest = createServerFn({ method: "POST" })
  .inputValidator((i: { jobId: string }) => z.object({ jobId: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    return executePump(data.jobId);
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
    updated_at: string;
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
        const { error: favErr } = await sb.from("favorites").delete().eq("video_id", job.video_id);
        if (favErr) throw new Error("Favorites delete error: " + favErr.message);

        const { error: histErr } = await sb.from("watch_history").delete().eq("video_id", job.video_id);
        if (histErr) throw new Error("History delete error: " + histErr.message);
      }
      
      // Delete ingest_job FIRST to satisfy the foreign key constraint
      const { error: ingErr } = await sb.from("ingest_jobs").delete().eq("id", job.id);
      if (ingErr) throw new Error("Ingest delete error: " + ingErr.message);

      if (job.video_id) {
        // Now it's safe to delete the video
        const { error: vidErr } = await sb.from("videos").delete().eq("id", job.video_id);
        if (vidErr) throw new Error("Video delete error: " + vidErr.message);
      }
    }
    return { ok: true };
  });
