import { createFileRoute } from "@tanstack/react-router";
import { log, newRequestId, errShape } from "@/lib/server-log";

// Large response window + parallel chunk prefetch so 4K/HEVC files stream
// continuously instead of restarting a new request every few MB. Browsers
// naturally throttle their own read speed via TCP backpressure, so a big
// window doesn't waste bandwidth — it just avoids per-request overhead.
// Adaptive response window: small first response so playback starts almost
// instantly, then large windows for sustained sequential playback so 4K/HEVC
// files stream continuously instead of reopening a request every few MB.
const START_RESPONSE_BYTES = 8 * 1024 * 1024; // fast-start window near a seek point
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024; // steady-state window
const FAST_START_ZONE = 6 * 1024 * 1024; // bytes after a seek that use the small window
const PARALLEL_FETCHES = 8;
const SIGNED_URL_TTL = 60 * 60 * 6;
const SIGNED_URL_CACHE_MS = 60 * 60 * 1000 * 5;
const CHUNK_FETCH_RETRIES = 3;
const CHUNK_FETCH_TIMEOUT_MS = 25_000;

// Browsers demux by Content-Type. Uploads recorded some files as the invalid
// "video/matroska" (and some as octet-stream), which makes Chrome fall back to
// byte sniffing — linear playback limps along but seeks land on black frames
// with no audio. Map to the real container types instead.
const EXT_MIME: Record<string, string> = {
  mkv: "video/x-matroska",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  avi: "video/x-msvideo",
  ts: "video/mp2t",
};

function normalizeMime(mime: string | null, path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const byExt = EXT_MIME[ext];
  if (byExt) return byExt;
  if (!mime || mime === "application/octet-stream") return "video/mp4";
  if (mime === "video/matroska" || mime === "video/mkv") return "video/x-matroska";
  return mime;
}


type StreamVideo = {
  id: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number;
  upload_mode: string;
  chunk_size_bytes: number | null;
  chunk_count: number | null;
};

// In-memory caches (per worker isolate)
const videoCache = new Map<string, { v: StreamVideo; exp: number }>();
const urlCache = new Map<string, { url: string; exp: number }>();
const VIDEO_CACHE_MS = 60_000;
const seqCache = new Map<string, { nextByte: number; exp: number }>();
const SEQ_CACHE_MS = 30_000;

const BASE_HEADERS = {
  "accept-ranges": "bytes",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "range",
  "access-control-expose-headers": "content-range, content-length, accept-ranges, x-request-id, x-stream-mode",
  "x-content-type-options": "nosniff",
};

export const Route = createFileRoute("/api/public/videos/stream")({
  server: {
    handlers: {
      GET: async ({ request }) => handleStream(request),
      HEAD: async ({ request }) => handleStream(request, true),
      OPTIONS: async () => new Response(null, { status: 204, headers: BASE_HEADERS }),
    },
  },
});

function errorResponse(status: number, message: string, reqId: string) {
  return new Response(message, {
    status,
    headers: { ...BASE_HEADERS, "content-type": "text/plain; charset=utf-8", "x-request-id": reqId },
  });
}

async function getVideo(id: string): Promise<StreamVideo | null> {
  const now = Date.now();
  const hit = videoCache.get(id);
  if (hit && hit.exp > now) return hit.v;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("videos")
    .select("id,storage_path,mime_type,size_bytes,upload_mode,chunk_size_bytes,chunk_count")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`db_lookup_failed: ${error.message}`);
  if (!data) return null;
  videoCache.set(id, { v: data as StreamVideo, exp: now + VIDEO_CACHE_MS });
  return data as StreamVideo;
}

async function getSignedUrl(path: string): Promise<string | null> {
  const now = Date.now();
  const hit = urlCache.get(path);
  if (hit && hit.exp > now) return hit.url;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.storage.from("videos").createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) return null;
  urlCache.set(path, { url: data.signedUrl, exp: now + SIGNED_URL_CACHE_MS });
  return data.signedUrl;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function handleStream(request: Request, headOnly = false): Promise<Response> {
  const reqId = newRequestId();
  const started = Date.now();
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!isUuid(id)) return errorResponse(400, "Bad video id", reqId);

  try {
    const video = await getVideo(id);
    if (!video) return errorResponse(404, "Video not found", reqId);

    if (video.upload_mode !== "chunked") {
      const signed = await getSignedUrl(video.storage_path);
      if (!signed) {
        log("error", "stream.sign_failed", { reqId, id });
        return errorResponse(502, "Stream URL unavailable", reqId);
      }
      return Response.redirect(signed, 302);
    }

    const total = Number(video.size_bytes);
    const chunkSize = Number(video.chunk_size_bytes ?? 0);
    const chunkCount = Number(video.chunk_count ?? 0);
    if (!total || !chunkSize || !chunkCount) {
      log("error", "stream.metadata_missing", { reqId, id, total, chunkSize, chunkCount });
      return errorResponse(500, "Chunk metadata missing", reqId);
    }

    const range = parseRange(request.headers.get("range"), total);
    if (!range) {
      return new Response("Invalid range", {
        status: 416,
        headers: { ...BASE_HEADERS, "content-range": `bytes */${total}`, "x-request-id": reqId },
      });
    }

    // Sequential playback gets the big window; a fresh seek gets a small one
    // so the first bytes land immediately and the player can start decoding.
    const seq = seqCache.get(id);
    const sequential = !!seq && seq.exp > Date.now() && Math.abs(range.start - seq.nextByte) <= FAST_START_ZONE;
    const window = sequential ? MAX_RESPONSE_BYTES : START_RESPONSE_BYTES;
    if (range.end - range.start + 1 > window) {
      range.end = Math.min(range.start + window - 1, total - 1);
    }
    seqCache.set(id, { nextByte: range.end + 1, exp: Date.now() + SEQ_CACHE_MS });

    const contentLength = range.end - range.start + 1;
    const headers = new Headers({
      ...BASE_HEADERS,
      "content-type": normalizeMime(video.mime_type, video.storage_path),
      "content-length": String(contentLength),
      "cache-control": "public, max-age=31536000, immutable",
      "content-range": `bytes ${range.start}-${range.end}/${total}`,
      "x-request-id": reqId,
      "x-stream-mode": sequential ? "sequential" : "seek",
      "server-timing": `prep;dur=${Date.now() - started}`,
    });

    if (headOnly) return new Response(null, { status: 206, headers });

    const firstPart = Math.floor(range.start / chunkSize);
    const lastPart = Math.floor(range.end / chunkSize);
    const partIndices: number[] = [];
    for (let p = firstPart; p <= lastPart; p += 1) partIndices.push(p);

    const fetchPartRange = async (part: number): Promise<Uint8Array> => {
      const partPath = `${video.storage_path}.part-${String(part).padStart(6, "0")}`;
      const partStartByte = part * chunkSize;
      const sliceStart = Math.max(0, range.start - partStartByte);
      const partEndByte = partStartByte + chunkSize - 1;
      const sliceEndAbs = Math.min(partEndByte, range.end);
      const sliceEnd = sliceEndAbs - partStartByte;

      let lastError: unknown;
      for (let attempt = 0; attempt < CHUNK_FETCH_RETRIES; attempt += 1) {
        try {
          const signed = await getSignedUrl(partPath);
          if (!signed) throw new Error(`sign_failed:part=${part}`);
          const res = await fetchWithTimeout(
            signed,
            { headers: { range: `bytes=${sliceStart}-${sliceEnd}` } },
            CHUNK_FETCH_TIMEOUT_MS,
          );
          if (res.status === 206 || res.status === 200) {
            const buf = await res.arrayBuffer();
            return new Uint8Array(buf);
          }
          // Invalidate cache on 4xx (signed URL may have expired mid-flight)
          if (res.status === 400 || res.status === 401 || res.status === 403) {
            urlCache.delete(partPath);
          }
          lastError = new Error(`chunk_http_${res.status}:part=${part}`);
        } catch (e) {
          lastError = e;
          urlCache.delete(partPath);
        }
        // Exponential backoff with jitter
        await new Promise((r) => setTimeout(r, 100 * 2 ** attempt + Math.random() * 100));
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    };

    const body = new ReadableStream({
      async start(controller) {
        try {
          const pending = new Map<number, Promise<Uint8Array>>();
          const kick = (idx: number) => {
            if (idx >= partIndices.length) return;
            pending.set(partIndices[idx], fetchPartRange(partIndices[idx]));
          };
          for (let i = 0; i < Math.min(PARALLEL_FETCHES, partIndices.length); i += 1) kick(i);

          for (let i = 0; i < partIndices.length; i += 1) {
            const part = partIndices[i];
            const bytes = await pending.get(part)!;
            pending.delete(part);
            kick(i + PARALLEL_FETCHES);
            controller.enqueue(bytes);
          }
          controller.close();
        } catch (streamError) {
          log("error", "stream.chunk_failed", { reqId, id, err: errShape(streamError) });
          controller.error(streamError);
        }
      },
    });

    return new Response(body, { status: 206, headers });
  } catch (err) {
    log("error", "stream.unhandled", { reqId, id, err: errShape(err) });
    return errorResponse(500, "Stream error", reqId);
  }
}

function parseRange(header: string | null, total: number) {
  if (!header) return { start: 0, end: total - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  let start: number;
  let end: number;
  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (!suffixLength) return null;
    start = Math.max(total - suffixLength, 0);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : total - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) return null;
  return { start, end: Math.min(end, total - 1) };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
