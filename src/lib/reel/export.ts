// Reel Studio — recording the canvas to a shareable file.
//
// The preview canvas is already the real 1080×1920 surface, so exporting is a
// matter of capturing its stream, mixing the chosen audio in, and running the
// timeline once in real time. MP4 is preferred where the browser can encode it
// (Chrome 126+), otherwise WebM comes out and can be converted afterwards.

export type ExportProgress = { pct: number; label: string };

const MP4_TYPES = [
  'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
  'video/mp4;codecs="avc1.4D401F,mp4a.40.2"',
  "video/mp4",
];
const WEBM_TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

export function pickMime() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of [...MP4_TYPES, ...WEBM_TYPES]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

export async function recordReel(opts: {
  canvas: HTMLCanvasElement;
  duration: number;
  fps?: number;
  /** Live audio graph node to record, if the user picked a track. */
  audioStream?: MediaStream | null;
  onFrame: (t: number) => void;
  onProgress?: (p: ExportProgress) => void;
  onStart?: () => void;
}): Promise<{ blob: Blob; ext: string; mime: string }> {
  const { canvas, duration, fps = 30, audioStream, onFrame, onProgress, onStart } = opts;
  const mime = pickMime();
  if (!mime) throw new Error("This browser cannot record video. Try Chrome or Edge.");

  const stream = canvas.captureStream(fps);
  if (audioStream) for (const track of audioStream.getAudioTracks()) stream.addTrack(track);

  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const done = new Promise<Blob>((resolve, reject) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: mime }));
    rec.onerror = () => reject(new Error("Recording failed"));
  });

  rec.start(250);
  onStart?.();
  const started = performance.now();

  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = (performance.now() - started) / 1000;
      if (t >= duration) {
        onFrame(duration - 0.01);
        resolve();
        return;
      }
      onFrame(t);
      onProgress?.({ pct: (t / duration) * 100, label: "Recording" });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // Let the encoder flush the tail before closing.
  await new Promise((r) => setTimeout(r, 320));
  rec.stop();
  const blob = await done;
  for (const track of stream.getTracks()) track.stop();

  return { blob, ext: mime.startsWith("video/mp4") ? "mp4" : "webm", mime };
}

/** Last-resort conversion for browsers that can only record WebM. */
export async function webmToMp4(blob: Blob, onLog?: (line: string) => void): Promise<Blob> {
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { fetchFile, toBlobURL } = await import("@ffmpeg/util");
  const base = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";
  const ff = new FFmpeg();
  if (onLog) ff.on("log", ({ message }) => onLog(message));
  await ff.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
  });
  await ff.writeFile("in.webm", await fetchFile(blob));
  await ff.exec([
    "-i", "in.webm",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
    "out.mp4",
  ]);
  const data = (await ff.readFile("out.mp4")) as Uint8Array;
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return new Blob([copy], { type: "video/mp4" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
