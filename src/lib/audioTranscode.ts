// Browser-side audio transcoding.
//
// Browsers cannot decode DTS / DTS-HD / TrueHD / E-AC3 / FLAC-in-MKV soundtracks.
// Netflix & co. solve this by shipping a separate AAC rendition of every title.
// We do exactly the same, except the rendition is produced right here in the
// browser with ffmpeg compiled to WebAssembly — no server, no CLI, no re-encode
// of the video.
//
// Huge files (20-40 GB) are handled by mounting the local File through
// Emscripten's WORKERFS, which reads lazily from disk instead of loading the
// whole thing into memory.

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";

// Codecs the browser can play natively. Anything else needs a companion track.
const BROWSER_SAFE_AUDIO = /aac|mp4a|mp3|opus|vorbis|flac(?!.*matroska)/i;
const BROWSER_HOSTILE_AUDIO = /dts|truehd|eac3|ac-?3|atmos|pcm_|mlp/i;

let ffmpegPromise: Promise<FFmpeg> | null = null;

export function transcodeSupported() {
  return typeof window !== "undefined" && typeof WebAssembly !== "undefined";
}

/** Heuristic: does this filename look like it carries an undecodable soundtrack? */
export function likelyNeedsCompatibleAudio(name: string) {
  const n = name.toLowerCase();
  if (BROWSER_HOSTILE_AUDIO.test(n)) return true;
  // Matroska containers almost always carry DTS/TrueHD/E-AC3 in release rips.
  if (/\.(mkv|m2ts|ts|avi|mpg|mpeg|vob|wmv)$/.test(n)) return true;
  return false;
}

export function looksBrowserSafe(name: string) {
  return BROWSER_SAFE_AUDIO.test(name);
}

async function getFFmpeg(onLog?: (line: string) => void) {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ff = new FFmpeg();
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
        toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
      ]);
      await ff.load({ coreURL, wasmURL });
      return ff;
    })().catch((e) => {
      ffmpegPromise = null;
      throw e;
    });
  }
  const ff = await ffmpegPromise;
  if (onLog) {
    ff.on("log", ({ message }) => onLog(message));
  }
  return ff;
}

export type TranscodeProgress = {
  /** 0-100, best effort */
  pct: number;
  phase: "loading" | "scanning" | "converting" | "packaging";
  detail?: string;
};

export type TranscodeResult = {
  blob: Blob;
  ext: "m4a";
  label: string;
  durationSec?: number;
};

/**
 * Extract every playable second of audio from a local video file and re-encode
 * it to stereo AAC (256 kbps) in an .m4a container.
 *
 * The video is never touched — we only read the audio track.
 */
export async function extractCompatibleAudio(
  file: File,
  opts: {
    onProgress?: (p: TranscodeProgress) => void;
    bitrateKbps?: number;
    /** Downmix to stereo (default) or keep the original channel layout. */
    stereo?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<TranscodeResult> {
  const { onProgress, bitrateKbps = 256, stereo = true, signal } = opts;
  if (!transcodeSupported()) throw new Error("WebAssembly is unavailable in this browser");

  onProgress?.({ pct: 0, phase: "loading", detail: "Loading audio engine" });

  let lastLine = "";
  const ff = await getFFmpeg((line) => {
    lastLine = line;
  });

  if (signal?.aborted) throw new Error("Cancelled");

  const mountPoint = "/mnt";
  const outName = `out-${Date.now()}.m4a`;
  let mounted = false;
  let inputPath: string;

  try {
    try {
      await ff.createDir(mountPoint);
    } catch {
      /* already exists */
    }
    // WORKERFS streams from the on-disk File — this is what makes 30 GB inputs possible.
    await ff.mount("WORKERFS" as never, { files: [file] }, mountPoint);
    mounted = true;
    inputPath = `${mountPoint}/${file.name}`;
  } catch {
    // Fallback for browsers without WORKERFS: only viable for smaller files.
    if (file.size > 1.5 * 1024 * 1024 * 1024) {
      throw new Error("This browser can't stream large files into the converter. Try Chrome or Edge.");
    }
    inputPath = `in-${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    await ff.writeFile(inputPath, new Uint8Array(await file.arrayBuffer()));
  }

  const abortHandler = () => {
    try {
      ff.terminate();
    } catch {
      /* ignore */
    }
    ffmpegPromise = null;
  };
  signal?.addEventListener("abort", abortHandler);

  const progressHandler = ({ progress }: { progress: number }) => {
    const pct = Math.max(0, Math.min(100, progress * 100));
    onProgress?.({
      pct,
      phase: "converting",
      detail: lastLine.includes("time=") ? lastLine.slice(lastLine.indexOf("time=")).slice(0, 40) : undefined,
    });
  };
  ff.on("progress", progressHandler);

  try {
    onProgress?.({ pct: 0, phase: "scanning", detail: "Reading audio track" });

    const args = [
      "-hide_banner",
      "-i", inputPath,
      "-vn", "-sn", "-dn",              // audio only — video is never decoded
      "-map", "0:a:0?",                  // first audio track
      "-c:a", "aac",
      "-b:a", `${bitrateKbps}k`,
      ...(stereo ? ["-ac", "2"] : []),
      "-ar", "48000",
      "-movflags", "+faststart",
      "-y", outName,
    ];

    const code = await ff.exec(args);
    if (signal?.aborted) throw new Error("Cancelled");
    if (code !== 0) throw new Error(`Conversion failed (${code}). ${lastLine}`.trim());

    onProgress?.({ pct: 99, phase: "packaging", detail: "Finalising track" });
    const data = (await ff.readFile(outName)) as Uint8Array;
    if (!data || data.byteLength < 1024) throw new Error("No audio track was found in this file");

    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    const blob = new Blob([copy.buffer as ArrayBuffer], { type: "audio/mp4" });
    onProgress?.({ pct: 100, phase: "packaging" });

    return {
      blob,
      ext: "m4a",
      label: `AAC ${bitrateKbps}k ${stereo ? "stereo" : "multi-channel"}`,
    };
  } finally {
    ff.off("progress", progressHandler);
    signal?.removeEventListener("abort", abortHandler);
    try {
      await ff.deleteFile(outName);
    } catch {
      /* ignore */
    }
    if (mounted) {
      try {
        await ff.unmount(mountPoint);
      } catch {
        /* ignore */
      }
    }
  }
}
