import { createFileRoute } from "@tanstack/react-router";

const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
const PARALLEL_FETCHES = 4;

type StreamVideo = {
  id: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number;
  upload_mode: string;
  chunk_size_bytes: number | null;
  chunk_count: number | null;
};

export const Route = createFileRoute("/api/public/videos/stream")({
  server: {
    handlers: {
      GET: async ({ request }) => handleStream(request),
      HEAD: async ({ request }) => handleStream(request, true),
    },
  },
});

async function handleStream(request: Request, headOnly = false) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!isUuid(id)) return new Response("Bad video id", { status: 400 });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("videos")
    .select("id,storage_path,mime_type,size_bytes,upload_mode,chunk_size_bytes,chunk_count")
    .eq("id", id)
    .maybeSingle();

  if (error) return new Response("Video lookup failed", { status: 500 });
  if (!data) return new Response("Video not found", { status: 404 });

  const video = data as StreamVideo;
  if (video.upload_mode !== "chunked") {
    const { data: signed } = await supabaseAdmin.storage.from("videos").createSignedUrl(video.storage_path, 60 * 60 * 6);
    return signed?.signedUrl
      ? Response.redirect(signed.signedUrl, 302)
      : new Response("Stream URL failed", { status: 500 });
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

  const status = 206;
  const contentLength = range.end - range.start + 1;
  const headers = new Headers({
    "accept-ranges": "bytes",
    "content-type": video.mime_type || "application/octet-stream",
    "content-length": String(contentLength),
    "cache-control": "private, max-age=300",
  });
  if (status === 206) headers.set("content-range", `bytes ${range.start}-${range.end}/${total}`);
  if (headOnly) return new Response(null, { status, headers });

  const body = new ReadableStream({
    async start(controller) {
      try {
        const firstPart = Math.floor(range.start / chunkSize);
        const lastPart = Math.floor(range.end / chunkSize);

        for (let part = firstPart; part <= lastPart; part += 1) {
          const partPath = `${video.storage_path}.part-${String(part).padStart(6, "0")}`;
          const { data: blob, error: downloadError } = await supabaseAdmin.storage.from("videos").download(partPath);
          if (downloadError || !blob) throw downloadError ?? new Error("missing chunk");

          const partStartByte = part * chunkSize;
          const sliceStart = Math.max(0, range.start - partStartByte);
          const sliceEnd = Math.min(blob.size, range.end - partStartByte + 1);
          const bytes = await blob.slice(sliceStart, sliceEnd).arrayBuffer();
          controller.enqueue(new Uint8Array(bytes));
        }
        controller.close();
      } catch (streamError) {
        controller.error(streamError);
      }
    },
  });

  return new Response(body, { status, headers });
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