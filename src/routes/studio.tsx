import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles, Play, Pause, Download, Plus, Trash2, Music, Image as ImageIcon,
  Loader2, Wand2, GripVertical, RotateCcw, Film, Shuffle,
} from "lucide-react";
import { Page, PageHeading } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import {
  TEMPLATES, TRANSITIONS, textToScenes, newScene, fitScenesTo, sceneDuration,
  type Scene, type Template, type TransitionId,
} from "@/lib/reel/templates";
import { drawFrame, timeline, W, H, type ReelMedia, type ReelState } from "@/lib/reel/render";
import { recordReel, downloadBlob, pickMime, webmToMp4 } from "@/lib/reel/export";

export const Route = createFileRoute("/studio")({
  head: () => ({
    meta: [
      { title: "Reel Studio — Make Shorts & Instagram Reels" },
      { name: "description", content: "Paste your text, pick a template, drop a track and export a ready-to-post 1080x1920 reel in seconds." },
      { property: "og:title", content: "Reel Studio — Make Shorts & Instagram Reels" },
      { property: "og:description", content: "Templates, animated captions, beat-reactive visuals and one-click export." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StudioPage,
});

const STARTER = `You are not behind.
You are just early in a story that takes time.
Keep showing up.
Everything compounds.`;

const ACCENTS = ["#ff3b30", "#ffd60a", "#3ef2c2", "#8b5cf6", "#f97316", "#38bdf8", "#e7c98b", "#ffffff"];

function StudioPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [template, setTemplate] = useState<Template>(TEMPLATES[0]!);
  const [accent, setAccent] = useState(TEMPLATES[0]!.palette.accent);
  const [raw, setRaw] = useState(STARTER);
  const [scenes, setScenes] = useState<Scene[]>(() => textToScenes(STARTER));
  const [handle, setHandle] = useState("");
  const [badge, setBadge] = useState("");
  const [showProgress, setShowProgress] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [bulkTrans, setBulkTrans] = useState<TransitionId>("auto");

  const [media, setMedia] = useState<ReelMedia>({ kind: "none" });
  const [mediaName, setMediaName] = useState("");

  const [playing, setPlaying] = useState(false);
  // Start mid-way through the first caption so the idle preview shows a full line.
  const [time, setTime] = useState(1.2);

  const [exporting, setExporting] = useState(false);
  const [exportPct, setExportPct] = useState(0);
  const [exportNote, setExportNote] = useState("");

  // ── audio graph ────────────────────────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const levelRef = useRef(0);
  const [audioName, setAudioName] = useState("");
  const [audioDur, setAudioDur] = useState(0);

  const scaled = useMemo(
    () => scenes.map((s) => ({ ...s, dur: Math.max(0.5, s.dur / speed) })),
    [scenes, speed],
  );
  const total = useMemo(() => timeline(scaled).total, [scaled]);

  const state = useCallback(
    (opts: { settled?: boolean } = {}): ReelState => ({
      template,
      scenes: scaled,
      media,
      handle,
      badge,
      accent,
      showProgress,
      level: levelRef.current,
      settled: opts.settled,
    }),
    [template, scaled, media, handle, badge, accent, showProgress],
  );


  const paint = useCallback(
    // `settled` paints the line fully composed — used while paused/scrubbing so
    // the editor never shows a half-revealed caption.
    (t: number, settled = false) => {

      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const a = analyserRef.current;
      if (a) {
        const buf = new Uint8Array(a.frequencyBinCount);
        a.getByteFrequencyData(buf);
        let sum = 0;
        const bass = Math.max(8, Math.floor(buf.length * 0.12));
        for (let i = 0; i < bass; i++) sum += buf[i]!;
        levelRef.current = Math.min(1, sum / bass / 190);
      } else {
        levelRef.current *= 0.9;
      }
      drawFrame(ctx, state({ settled }), t);
    },
    [state],
  );

  // Display fonts must be resident before the canvas measures text, otherwise
  // the first paint falls back to a system face and the layout shifts later.
  useEffect(() => {
    void document.fonts?.ready.then(() => paint(time, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Repaint whenever the design changes while paused.
  useEffect(() => {
    if (!playing) paint(time, true);
  }, [paint, playing, time]);



  // Playback loop.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const startedAt = performance.now() - time * 1000;
    const loop = () => {
      const t = (performance.now() - startedAt) / 1000;
      if (t >= total) {
        setTime(0);
        setPlaying(false);
        if (audioRef.current) audioRef.current.pause();
        return;
      }
      setTime(t);
      paint(t);
      const vid = media.kind === "video" ? media.el : null;
      if (vid && vid.paused) void vid.play().catch(() => {});
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, total, paint]);

  const togglePlay = () => {
    const next = !playing;
    setPlaying(next);
    const a = audioRef.current;
    if (a) {
      if (next) {
        void ctxRef.current?.resume();
        a.currentTime = Math.min(time, a.duration || 0);
        void a.play().catch(() => {});
      } else a.pause();
    }
    if (media.kind === "video") {
      if (next) void media.el.play().catch(() => {});
      else media.el.pause();
    }
  };

  const restart = () => {
    setTime(0);
    if (audioRef.current) audioRef.current.currentTime = 0;
    if (media.kind === "video") media.el.currentTime = 0;
    paint(0);
  };

  // ── inputs ─────────────────────────────────────────────────────────────────
  const applyText = () => {
    const next = textToScenes(raw);
    if (!next.length) return toast.error("Add some text first");
    setScenes(next);
    setTime(0);
    toast.success(`${next.length} caption${next.length > 1 ? "s" : ""} generated`);
  };

  const pickTemplate = (t: Template) => {
    setTemplate(t);
    setAccent(t.palette.accent);
  };

  const onMedia = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (file.type.startsWith("video/")) {
      const el = document.createElement("video");
      el.src = url;
      el.muted = true;
      el.loop = true;
      el.playsInline = true;
      el.onloadeddata = () => {
        setMedia({ kind: "video", el });
        setMediaName(file.name);
        void el.play().catch(() => {});
      };
    } else {
      const el = new Image();
      el.src = url;
      el.onload = () => {
        setMedia({ kind: "image", el });
        setMediaName(file.name);
      };
    }
  };

  const onAudio = (file: File | undefined) => {
    if (!file) return;
    const a = audioRef.current ?? new Audio();
    a.src = URL.createObjectURL(file);
    a.crossOrigin = "anonymous";
    a.loop = false;
    audioRef.current = a;
    setAudioName(file.name);
    a.onloadedmetadata = () => setAudioDur(a.duration || 0);

    if (!ctxRef.current) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const src = ctx.createMediaElementSource(a);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const dest = ctx.createMediaStreamDestination();
      src.connect(analyser);
      analyser.connect(ctx.destination);
      analyser.connect(dest);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      destRef.current = dest;
    }
  };

  const fitAudio = () => {
    if (!audioDur) return toast.error("Load a track first");
    setScenes((s) => fitScenesTo(s, audioDur * speed));
    toast.success("Captions stretched to the track");
  };

  // ── export ─────────────────────────────────────────────────────────────────
  const doExport = async (wantMp4: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas || !scenes.length) return;
    if (!pickMime()) return toast.error("This browser can't record video — use Chrome or Edge.");

    setExporting(true);
    setExportPct(0);
    setExportNote("Warming up");
    setPlaying(false);
    try {
      const a = audioRef.current;
      if (a) {
        await ctxRef.current?.resume();
        a.currentTime = 0;
      }
      if (media.kind === "video") {
        media.el.currentTime = 0;
        await media.el.play().catch(() => {});
      }
      const { blob, ext } = await recordReel({
        canvas,
        duration: total,
        fps: 30,
        audioStream: destRef.current?.stream ?? null,
        onStart: () => void a?.play().catch(() => {}),
        onFrame: (t) => {
          setTime(t);
          paint(t);
        },
        onProgress: (p) => {
          setExportPct(p.pct);
          setExportNote(p.label);
        },
      });
      a?.pause();

      let out = blob;
      let finalExt = ext;
      if (wantMp4 && ext !== "mp4") {
        setExportNote("Converting to MP4 (one-time engine download)");
        setExportPct(100);
        out = await webmToMp4(blob);
        finalExt = "mp4";
      }
      downloadBlob(out, `reel-${template.id}-${Date.now()}.${finalExt}`);
      toast.success(`Reel exported (.${finalExt})`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
      setExportPct(0);
      setExportNote("");
      setTime(0);
      paint(0);
    }
  };

  // ── scene editing ──────────────────────────────────────────────────────────
  const updateScene = (id: string, patch: Partial<Scene>) =>
    setScenes((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const removeScene = (id: string) => setScenes((s) => s.filter((x) => x.id !== id));

  const applyTransitionToAll = () => {
    setScenes((s) => s.map((x) => ({ ...x, trans: bulkTrans })));
    toast.success("Transition applied to every line");
  };

  // A tasteful random walk: never repeats the same cut twice in a row so the
  // reel keeps moving without looking like a template demo.
  const surpriseTransitions = () => {
    const pool = TRANSITIONS.filter((t) => t.id !== "auto" && t.id !== "cut").map((t) => t.id);
    let last = "";
    setScenes((s) =>
      s.map((x, i) => {
        if (i === 0) return { ...x, trans: "auto" as TransitionId };
        let pick = last;
        while (pick === last) pick = pool[Math.floor(Math.random() * pool.length)]!;
        last = pick;
        return { ...x, trans: pick as TransitionId };
      }),
    );
    toast.success("Transitions shuffled");
  };

  const move = (i: number, dir: -1 | 1) =>
    setScenes((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.length) return s;
      const copy = [...s];
      const [it] = copy.splice(i, 1);
      copy.splice(j, 0, it!);
      return copy;
    });

  const mm = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;

  return (
    <Page wide>
      <PageHeading
        title="Reel Studio"
        subtitle="Paste your script, pick a look, drop a track — export a post-ready 1080×1920 short."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* Preview */}
        <div className="order-2 lg:order-1 space-y-4">
          <div className="rounded-3xl border border-white/10 bg-black/40 p-4 backdrop-blur">
            <div className="mx-auto w-full max-w-[340px]">
              <canvas
                ref={canvasRef}
                width={W}
                height={H}
                className="w-full rounded-2xl border border-white/10 shadow-2xl"
                style={{ aspectRatio: "9 / 16" }}
              />
            </div>

            <div className="mx-auto mt-4 flex w-full max-w-[340px] items-center gap-3">
              <Button size="icon" variant="secondary" onClick={togglePlay} disabled={exporting}>
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </Button>
              <Button size="icon" variant="ghost" onClick={restart} disabled={exporting}>
                <RotateCcw className="size-4" />
              </Button>
              <Slider
                value={[Math.min(time, total)]}
                max={Math.max(total, 0.1)}
                step={0.05}
                onValueChange={([v]) => {
                  setPlaying(false);
                  setTime(v ?? 0);
                  paint(v ?? 0);
                  if (audioRef.current) audioRef.current.currentTime = Math.min(v ?? 0, audioRef.current.duration || 0);
                }}
                className="flex-1"
              />
              <span className="w-20 text-right font-mono text-xs text-muted-foreground">
                {mm(time)} / {mm(total)}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={() => doExport(true)} disabled={exporting || !scenes.length} className="gap-2">
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {exporting ? `${exportNote} ${Math.round(exportPct)}%` : "Export MP4"}
            </Button>
            <Button variant="secondary" onClick={() => doExport(false)} disabled={exporting || !scenes.length}>
              Export fast (native format)
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Export records the reel in real time, so a {mm(total)} reel takes about {mm(total)} to render. Keep this tab
            in the foreground while it runs.
          </p>
        </div>

        {/* Controls */}
        <div className="order-1 lg:order-2 space-y-5">
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-primary" /> Template
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => pickTemplate(t)}
                  className={`rounded-xl border p-3 text-left transition ${
                    template.id === t.id
                      ? "border-primary bg-primary/10"
                      : "border-white/10 bg-black/20 hover:border-white/25"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="size-3 rounded-full"
                      style={{ background: t.palette.accent }}
                      aria-hidden
                    />
                    <span className="text-sm font-semibold">{t.name}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{t.blurb}</p>
                </button>
              ))}
            </div>

            <div className="mt-4">
              <Label className="text-xs text-muted-foreground">Accent</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    aria-label={`Accent ${c}`}
                    onClick={() => setAccent(c)}
                    className={`size-7 rounded-full border-2 transition ${
                      accent === c ? "border-foreground scale-110" : "border-white/20"
                    }`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Wand2 className="size-4 text-primary" /> Script
            </h2>
            <Textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              rows={6}
              placeholder="Paste your script. Each line becomes a caption; long paragraphs split automatically."
              className="resize-y"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={applyText} className="gap-2">
                <Wand2 className="size-4" /> Generate captions
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setScenes((s) => [...s, newScene()])} className="gap-2">
                <Plus className="size-4" /> Add line
              </Button>
            </div>

            <div className="mt-4">
              <Label className="text-xs text-muted-foreground">Pace ({speed.toFixed(2)}×)</Label>
              <Slider
                value={[speed]}
                min={0.6}
                max={2}
                step={0.05}
                onValueChange={([v]) => setSpeed(v ?? 1)}
                className="mt-2"
              />
            </div>

            <div className="mt-4">
              <Label className="text-xs text-muted-foreground">Transition style</Label>
              <div className="mt-2 flex gap-2">
                <select
                  aria-label="Transition for every line"
                  value={bulkTrans}
                  onChange={(e) => setBulkTrans(e.target.value as TransitionId)}
                  className="h-9 flex-1 rounded-md border border-white/10 bg-black/40 px-2 text-sm outline-none focus:border-primary"
                >
                  {TRANSITIONS.map((tr) => (
                    <option key={tr.id} value={tr.id}>
                      {tr.id === "auto" ? `Auto (${template.transition})` : tr.name}
                    </option>
                  ))}
                </select>
                <Button size="sm" variant="secondary" className="h-9 gap-2" onClick={applyTransitionToAll}>
                  <Shuffle className="size-4" /> Apply to all
                </Button>
                <Button size="sm" variant="ghost" className="h-9" onClick={surpriseTransitions}>
                  Mix it up
                </Button>
              </div>
            </div>


            <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
              {scenes.map((s, i) => (
                <div key={s.id} className="rounded-xl border border-white/10 bg-black/30 p-2">
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col pt-1 text-muted-foreground">
                      <button aria-label="Move up" onClick={() => move(i, -1)} className="text-[10px] hover:text-foreground">▲</button>
                      <GripVertical className="size-3 opacity-40" />
                      <button aria-label="Move down" onClick={() => move(i, 1)} className="text-[10px] hover:text-foreground">▼</button>
                    </div>
                    <Textarea
                      value={s.text}
                      rows={2}
                      onChange={(e) => updateScene(s.id, { text: e.target.value })}
                      className="min-h-0 flex-1 resize-none bg-transparent text-sm"
                    />
                    <Button size="icon" variant="ghost" aria-label="Delete line" onClick={() => removeScene(s.id)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <div className="mt-1 flex items-center gap-2 pl-6">
                    <span className="text-[11px] text-muted-foreground">{s.dur.toFixed(1)}s</span>
                    <Slider
                      value={[s.dur]}
                      min={0.6}
                      max={8}
                      step={0.1}
                      onValueChange={([v]) => updateScene(s.id, { dur: v ?? 1 })}
                      className="flex-1"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => updateScene(s.id, { dur: sceneDuration(s.text) })}
                    >
                      auto
                    </Button>
                  </div>
                  <div className="mt-1 flex items-center gap-2 pl-6">
                    <Shuffle className="size-3 text-muted-foreground" />
                    <select
                      aria-label="Transition into this line"
                      value={s.trans ?? "auto"}
                      onChange={(e) => updateScene(s.id, { trans: e.target.value as TransitionId })}
                      className="h-7 flex-1 rounded-md border border-white/10 bg-black/40 px-2 text-[11px] outline-none focus:border-primary"
                    >
                      {TRANSITIONS.map((tr) => (
                        <option key={tr.id} value={tr.id}>
                          {tr.id === "auto" ? `Auto (${template.transition})` : tr.name}
                        </option>
                      ))}
                    </select>
                  </div>

                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Music className="size-4 text-primary" /> Audio
            </h2>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-white/15 p-3 text-sm hover:border-white/30">
              <Music className="size-4 text-muted-foreground" />
              <span className="truncate">{audioName || "Drop a trending track (mp3 / m4a / wav)"}</span>
              <input type="file" accept="audio/*" className="hidden" onChange={(e) => onAudio(e.target.files?.[0])} />
            </label>
            {audioDur > 0 && (
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>Track length {mm(audioDur)}</span>
                <Button size="sm" variant="ghost" className="h-7" onClick={fitAudio}>
                  Fit captions to track
                </Button>
              </div>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              The waveform drives a beat pulse on the backdrop, and the track is mixed straight into the exported file.
            </p>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <ImageIcon className="size-4 text-primary" /> Background & branding
            </h2>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-white/15 p-3 text-sm hover:border-white/30">
              <Film className="size-4 text-muted-foreground" />
              <span className="truncate">{mediaName || "Add a photo or clip (optional)"}</span>
              <input
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={(e) => onMedia(e.target.files?.[0])}
              />
            </label>
            {media.kind !== "none" && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2 h-7"
                onClick={() => {
                  setMedia({ kind: "none" });
                  setMediaName("");
                }}
              >
                Remove background
              </Button>
            )}

            <div className="mt-4 grid gap-3">
              <div>
                <Label htmlFor="badge" className="text-xs text-muted-foreground">Top badge</Label>
                <Input id="badge" value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="Part 1" />
              </div>
              <div>
                <Label htmlFor="handle" className="text-xs text-muted-foreground">Handle</Label>
                <Input id="handle" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@yourname" />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="prog" className="text-xs text-muted-foreground">Progress bar</Label>
                <Switch id="prog" checked={showProgress} onCheckedChange={setShowProgress} />
              </div>
            </div>
          </section>
        </div>
      </div>
    </Page>
  );
}
