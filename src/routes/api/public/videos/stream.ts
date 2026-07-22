import { createFileRoute } from "@tanstack/react-router";

const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const PARALLEL_FETCHES = 8;
const SIGNED_URL_TTL = 60 * 60 * 6;
const SIGNED_URL_CACHE_MS = 60 * 60 * 1000 * 5;

type StreamVideo = {
  id: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number;
  upload_mode: string;
  chunk_size_bytes: number | null;
  chunk_count: number | null;
};

// In-memory caches (per worker isolate) — dramatically cuts DB + signing round-trips
const videoCache = new Map<string, { v: StreamVideo; exp: number }>();
const urlCache = new Map<string, { url: string; exp: number }>();
const VIDEO_CACHE_MS = 60_000;

export const Route = createFileRoute("/api/public/videos/stream")({
  server: {
    handlers: {
      GET: async ({ request }) => handleStream(request),
      HEAD: async ({ request }) => handleStream(request, true),
    },
  },
});

async function getVideo(id: string): Promise<StreamVideo | null> {
  const now = Date.now();
  const hit = videoCache.get(id);
  if (hit && hit.exp > now) return hit.v;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("videos")
    .select("id,storage_path,mime_type,size_bytes,upload_mode,chunk_size_bytes,chunk_count")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  videoCache.set(id, { v: data as StreamVideo, exp: now + VIDEO_CACHE_MS });
  return data as StreamVideo;
}

async function getSignedUrl(path: string): Promise<string | null> {
  const now = Date.now();
  const hit = urlCache.get(path);
  if (hit && hit.exp > now) return hit.url;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.storage.from("videos").createSignedUrl(path, SIGNED_URL_TTL);
  if (!data?.signedUrl) return null;
  urlCache.set(path, { url: data.signedUrl, exp: now + SIGNED_URL_CACHE_MS });
  return data.signedUrl;
}

async function handleStream(request: Request, headOnly = false) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!isUuid(id)) return new Response("Bad video id", { status: 400 });

  const video = await getVideo(id);
  if (!video) return new Response("Video not found", { status: 404 });

  if (video.upload_mode !== "chunked") {
    const signed = await getSignedUrl(video.storage_path);
    return signed ? Response.redirect(signed, 302) : new Response("Stream URL failed", { status: 500 });
  }

  const total = Number(video.size_bytes);
  const chunkSize = Number(video.chunk_size_bytes ?? 0);
  const chunkCount = Number(video.chunk_count ?? 0);
  if (!total || !chunkSize || !chunkCount) return new Response("Chunk metadata missing", { status: 500 });

  const range = parseRange(request.headers.get("range"), total);
  if (!range) {
    return new Response("Invalid range", {
      status: 416,
      headers: { "content-range": `bytes */${total}`, "accept-ranges": "bytes" },
    });
  }

  if (range.end - range.start + 1 > MAX_RESPONSE_BYTES) {
    range.end = Math.min(range.start + MAX_RESPONSE_BYTES - 1, total - 1);
  }

  const contentLength = range.end - range.start + 1;
  const headers = new Headers({
    "accept-ranges": "bytes",
    "content-type": video.mime_type || "application/octet-stream",
    "content-length": String(contentLength),
    "cache-control": "public, max-age=31536000, immutable",
    "content-range": `bytes ${range.start}-${range.end}/${total}`,
  });
  if (headOnly) return new Response(null, { status: 206, headers });

  const firstPart = Math.floor(range.start / chunkSize);
  const lastPart = Math.floor(range.end / chunkSize);
  const partIndices: number[] = [];
  for (let p = firstPart; p <= lastPart; p += 1) partIndices.push(p);

  // Fetch only the exact bytes needed from each chunk using HTTP Range against signed URLs.
  // This avoids downloading whole 40MB chunks just to slice a few KB out.
  const fetchPartRange = async (part: number): Promise<Uint8Array> => {
    const partPath = `${video.storage_path}.part-${String(part).padStart(6, "0")}`;
    const signed = await getSignedUrl(partPath);
    if (!signed) throw new Error(`sign failed for part ${part}`);

    const partStartByte = part * chunkSize;
    const sliceStart = Math.max(0, range.start - partStartByte);
    // For inner parts we always take the whole chunk; only first/last are trimmed
    const partEndByte = partStartByte + chunkSize - 1;
    const sliceEndAbs = Math.min(partEndByte, range.end);
    const sliceEnd = sliceEndAbs - partStartByte;

    const res = await fetch(signed, {
      headers: { range: `bytes=${sliceStart}-${sliceEnd}` },
    });
    if (!res.ok && res.status !== 206 && res.status !== 200) {
      throw new Error(`chunk ${part} fetch ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
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
        controller.error(streamError);
      }
    },
  });

  return new Response(body, { status: 206, headers });
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
