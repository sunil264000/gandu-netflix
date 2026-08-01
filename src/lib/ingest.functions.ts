// Server-side URL ingest: the server downloads a direct video link and stores
// it as chunked objects, so the browser/home connection never carries the file.
//
// A job is processed in short "pumps" (a few chunks per call) so each request
// stays well inside the platform's execution budget. Any device can drive the
// pump loop — progress lives in the database.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const CHUNK_SIZE = 24 * 1024 * 1024; // 24 MB parts (matches the streaming reader)
const PUMP_BUDGET_MS = 18_000;
const PARALLEL_PARTS = 2;
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
  const head = await fetch(url, { method: "HEAD", headers: { "user-agent": BROWSER_UA } }).catch(() => null);
  let size = Number(head?.headers.get("content-length") ?? 0);
  let type = head?.headers.get("content-type") ?? null;
  let disp = head?.headers.get("content-disposition") ?? null;
  let ranges = (head?.headers.get("accept-ranges") ?? "").includes("bytes");

  if (!size || !ranges) {
    const probeRes = await fetch(url, {
      headers: { range: "bytes=0-0", "user-agent": BROWSER_UA },
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
    if (!info.ranges)
      throw new Error(
        "That host does not allow resumable (range) downloads, so the import cannot be chunked. Try a direct-download mirror link.",
      );

    const fileName = safeName(nameFromUrl(data.url, info.disp));
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "mp4";
    const title = data.title?.trim() || fileName.replace(/\.[^.]+$/, "");
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


export const pumpIngest = createServerFn({ method: "POST" })
  .inputValidator((i: { jobId: string }) => z.object({ jobId: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: job, error } = await sb.from("ingest_jobs").select("*").eq("id", data.jobId).maybeSingle();
    if (error) throw error;
    if (!job) throw new Error("job_not_found");
    if (job.status === "done" || job.status === "cancelled") {
      return { status: job.status as string, chunksDone: job.chunks_done, chunkCount: job.chunk_count };
    }

    await sb.from("ingest_jobs").update({ status: "running", error: null }).eq("id", job.id);

    const cs = Number(job.chunk_size_bytes);
    const total = Number(job.total_bytes);
    let done = Number(job.chunks_done);
    const t0 = Date.now();
    let bytesThisPump = 0;

    try {
      while (done < job.chunk_count && Date.now() - t0 < PUMP_BUDGET_MS) {
        const batch: number[] = [];
        for (let k = 0; k < PARALLEL_PARTS && done + k < job.chunk_count; k += 1) batch.push(done + k);

        await Promise.all(
          batch.map(async (index) => {
            const start = index * cs;
            const end = Math.min(total - 1, start + cs - 1);
            const buf = await fetchPart(job.source_url, start, end);
            bytesThisPump += buf.byteLength;
            const { error: upErr } = await sb.storage
              .from("videos")
              .upload(partPath(job.storage_path, index), new Blob([buf]), {
                upsert: true,
                contentType: "application/octet-stream",
                cacheControl: "31536000",
              });
            if (upErr) throw new Error(`store part ${index}: ${upErr.message}`);
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
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await sb.from("ingest_jobs").update({ status: "error", error: message.slice(0, 500) }).eq("id", job.id);
      return { status: "error" as const, chunksDone: done, chunkCount: job.chunk_count, error: message };
    }

    const finished = done >= job.chunk_count;
    if (finished) {
      await sb
        .from("ingest_jobs")
        .update({ status: "done", chunks_done: done, bytes_done: total })
        .eq("id", job.id);
    }

    const elapsed = (Date.now() - t0) / 1000;
    return {
      status: finished ? ("done" as const) : ("running" as const),
      chunksDone: done,
      chunkCount: job.chunk_count as number,
      speedBps: elapsed > 0 ? bytesThisPump / elapsed : 0,
    };
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

    if (data.deleteVideo && job.video_id) {
      const paths: string[] = [];
      for (let i = 0; i < job.chunk_count; i += 1) paths.push(partPath(job.storage_path, i));
      if (paths.length) {
        try {
          await sb.storage.from("videos").remove(paths);
        } catch {
          /* ignore */
        }
      }
      await sb.from("favorites").delete().eq("video_id", job.video_id);
      await sb.from("watch_history").delete().eq("video_id", job.video_id);
      await sb.from("videos").delete().eq("id", job.video_id);
    }
    return { ok: true };
  });
