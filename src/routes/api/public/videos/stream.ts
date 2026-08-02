import { createFileRoute } from "@tanstack/react-router";
import { log, newRequestId, errShape } from "@/lib/server-log";

// Streaming policy: nothing is buffered in the worker (pure pass-through), so
// the only real ceilings are the platform subrequest budget per response and
// how fast the player can start decoding. So: a small first window on a seek
// (fast time-to-first-frame), then the window RAMPS UP on every sequential
// follow-up until it's effectively "the rest of the file in one connection".
const START_RESPONSE_BYTES = 32 * 1024 * 1024; // first window after a seek
const MAX_RESPONSE_BYTES = 1024 * 1024 * 1024; // steady-state ceiling
const WINDOW_RAMP = 8; // window multiplier per sequential request
const FAST_START_ZONE = 64 * 1024 * 1024; // tolerance for "still sequential"
const PARALLEL_FETCHES = 24; // upstream part reads in flight
const PREWARM_URL_PARTS = 32; // signed URLs warmed beyond the served window
const PREVIEW_RESPONSE_BYTES = 1 * 1024 * 1024; // tiny window for scrub previews
const PREWARM_CACHE_PARTS = 6; // whole parts pushed into edge cache ahead of playback
// 8K / very-high-bitrate sources burn through a window far faster than 1080p,
// so the start window scales with the file's average bitrate.
const HUGE_FILE_BYTES = 20 * 1024 * 1024 * 1024; // ~8K remux territory
const HUGE_START_RESPONSE_BYTES = 96 * 1024 * 1024;

// Download mode: the client opens many connections itself, so each response
// should honour the exact requested range (no ramping, no read-ahead) and just
// move bytes as fast as the upstream allows.
const DOWNLOAD_MAX_RESPONSE_BYTES = 192 * 1024 * 1024;



const SIGNED_URL_TTL = 60 * 60 * 12;
const SIGNED_URL_CACHE_MS = 60 * 60 * 1000 * 11;
const CHUNK_FETCH_RETRIES = 4;
const CHUNK_FETCH_TIMEOUT_MS = 30_000;


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
const seqCache = new Map<string, { nextByte: number; window: number; exp: number }>();
const SEQ_CACHE_MS = 120_000;


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
  const reqUrl = new URL(request.url);
  const id = reqUrl.searchParams.get("id") ?? "";
  // The scrub-preview element streams through the same endpoint but must never
  // touch the main player's sequential state or trigger read-ahead.
  const preview = reqUrl.searchParams.get("preview") === "1";
  // Download mode: exact-range pass-through, attachment disposition.
  const download = reqUrl.searchParams.get("dl") === "1";
  const dlName = (reqUrl.searchParams.get("name") ?? "").replace(/[^\w.\-() ]+/g, "_").slice(0, 180);
  // Distinct viewers/tabs track their own sequential window.
  const sid = reqUrl.searchParams.get("sid") ?? "";
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
      const target = download
        ? `${signed}${signed.includes("?") ? "&" : "?"}download=${encodeURIComponent(dlName || "video")}`
        : signed;
      return Response.redirect(target, 302);
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

    // A fresh seek gets a small window so the first frame decodes instantly.
    // Each sequential follow-up multiplies the window (16MB → 64 → 256 → 512),
    // so steady playback ends up pulling hundreds of MB per connection.
    // Scale the cold-start window with the source size so 8K/high-bitrate
    // remuxes get enough runway before the ramp kicks in.
    const startWindow = total >= HUGE_FILE_BYTES ? HUGE_START_RESPONSE_BYTES : START_RESPONSE_BYTES;
    const seqKey = preview ? `${id}:preview` : sid ? `${id}:${sid}` : id;
    const seq = download ? undefined : seqCache.get(seqKey);
    const sequential = !!seq && seq.exp > Date.now() && Math.abs(range.start - seq.nextByte) <= FAST_START_ZONE;
    const window = download
      ? DOWNLOAD_MAX_RESPONSE_BYTES
      : preview
        ? PREVIEW_RESPONSE_BYTES
        : sequential
          ? Math.min(MAX_RESPONSE_BYTES, (seq?.window ?? startWindow) * WINDOW_RAMP)
          : startWindow;
    if (range.end - range.start + 1 > window) {
      range.end = Math.min(range.start + window - 1, total - 1);
    }
    if (!download) seqCache.set(seqKey, { nextByte: range.end + 1, window, exp: Date.now() + SEQ_CACHE_MS });


    const contentLength = range.end - range.start + 1;
    const headers = new Headers({
      ...BASE_HEADERS,
      "content-type": download ? "application/octet-stream" : normalizeMime(video.mime_type, video.storage_path),
      "content-length": String(contentLength),
      "cache-control": "public, max-age=31536000, immutable",
      "content-range": `bytes ${range.start}-${range.end}/${total}`,
      "x-request-id": reqId,
      "x-stream-mode": download ? "download" : preview ? "preview" : sequential ? "sequential" : "seek",
      "server-timing": `prep;dur=${Date.now() - started}`,
    });
    if (download) headers.set("content-disposition", `attachment; filename="${dlName || "video"}"`);


    if (headOnly) return new Response(null, { status: 206, headers });

    const firstPart = Math.floor(range.start / chunkSize);
    const lastPart = Math.floor(range.end / chunkSize);
    const partIndices: number[] = [];
    for (let p = firstPart; p <= lastPart; p += 1) partIndices.push(p);

    // Pass-through streaming: every part request is opened in parallel, but
    // bodies are piped straight to the client in order as they arrive. Nothing
    // is buffered into memory, so time-to-first-byte is the latency of one
    // upstream request instead of a whole chunk download.
    const partRangeOf = (part: number) => {
      const partStartByte = part * chunkSize;
      const sliceStart = Math.max(0, range.start - partStartByte);
      const sliceEndAbs = Math.min(partStartByte + chunkSize - 1, range.end);
      return { sliceStart, sliceEnd: sliceEndAbs - partStartByte };
    };

    const edgeCache: Cache | undefined = (globalThis as any).caches?.default;

    const openPart = async (part: number): Promise<Response> => {
      const partPath = `${video.storage_path}.part-${String(part).padStart(6, "0")}`;
      const { sliceStart, sliceEnd } = partRangeOf(part);
      const cacheKey = new Request(
        `https://vault.stream.internal/${encodeURIComponent(partPath)}?s=${sliceStart}&e=${sliceEnd}`,
      );

      if (edgeCache) {
        try {
          const cached = await edgeCache.match(cacheKey);
          if (cached?.body) return cached;
        } catch {
          /* cache miss / unsupported */
        }
      }

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
          if ((res.status === 206 || res.status === 200) && res.body) {
            if (edgeCache) {
              try {
                const [toCache, toClient] = res.body.tee();
                void edgeCache.put(
                  cacheKey,
                  new Response(toCache, {
                    headers: { "cache-control": "public, max-age=604800", "content-type": "application/octet-stream" },
                  }),
                );
                return new Response(toClient);
              } catch {
                return res;
              }
            }
            return res;
          }
          if (res.status === 400 || res.status === 401 || res.status === 403) {
            urlCache.delete(partPath);
          }
          lastError = new Error(`chunk_http_${res.status}:part=${part}`);
        } catch (e) {
          lastError = e;
          urlCache.delete(partPath);
        }
        await new Promise((r) => setTimeout(r, 60 * 2 ** attempt + Math.random() * 60));
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    };

    // Read-ahead: while this response streams, warm the signing cache and push
    // the next few whole parts into the edge cache, so the player's *next*
    // range request is served from cache with near-zero latency.
    const prewarmAhead = () => {
      if (preview || download) return;
      const from = lastPart + 1;
      for (let p = from; p < Math.min(from + PREWARM_URL_PARTS, chunkCount); p += 1) {
        void getSignedUrl(`${video.storage_path}.part-${String(p).padStart(6, "0")}`).catch(() => {});
      }
      if (!edgeCache) return;
      for (let p = from; p < Math.min(from + PREWARM_CACHE_PARTS, chunkCount); p += 1) {
        const partPath = `${video.storage_path}.part-${String(p).padStart(6, "0")}`;
        const key = new Request(
          `https://vault.stream.internal/${encodeURIComponent(partPath)}?s=0&e=${chunkSize - 1}`,
        );
        void (async () => {
          try {
            if (await edgeCache.match(key)) return;
            const signed = await getSignedUrl(partPath);
            if (!signed) return;
            const res = await fetchWithTimeout(
              signed,
              { headers: { range: `bytes=0-${chunkSize - 1}` } },
              CHUNK_FETCH_TIMEOUT_MS,
            );
            if (!res.body) return;
            await edgeCache.put(
              key,
              new Response(res.body, {
                headers: { "cache-control": "public, max-age=604800", "content-type": "application/octet-stream" },
              }),
            );
          } catch {
            /* best effort */
          }
        })();
      }
    };

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const pending = new Map<number, Promise<Response>>();
        const kick = (idx: number) => {
          if (idx >= partIndices.length) return;
          const p = partIndices[idx];
          const promise = openPart(p);
          promise.catch(() => {}); // avoid unhandled rejection before we await it
          pending.set(p, promise);
        };
        for (let i = 0; i < Math.min(PARALLEL_FETCHES, partIndices.length); i += 1) kick(i);
        prewarmAhead();


        try {
          for (let i = 0; i < partIndices.length; i += 1) {
            const part = partIndices[i];
            const res = await pending.get(part)!;
            pending.delete(part);
            kick(i + PARALLEL_FETCHES);
            const reader = res.body!.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
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
