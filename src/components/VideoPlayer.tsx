import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, PictureInPicture2,
  SkipBack, SkipForward, Loader2, Settings, Gauge, Rewind, FastForward,
  AudioLines, ExternalLink,
} from "lucide-react";

type CaptionTrack = { src: string; label: string; srclang: string; default?: boolean };

type Props = {
  src: string;
  poster?: string | null;
  startAt?: number;
  onProgress?: (pos: number, dur: number) => void;
  onEnded?: () => void;
  autoPlay?: boolean;
  captions?: CaptionTrack[];
  /** Optional browser-friendly companion soundtrack (AAC) for files whose
   *  original track is DTS/TrueHD/E-AC-3 and cannot be decoded by browsers. */
  audioSrc?: string | null;
  audioLabel?: string | null;
  /** .m3u handoff for desktop players (original audio, no re-encode). */
  playlistUrl?: string | null;
};

function fmt(t: number) {
  if (!isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const s = Math.floor(t % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const DRIFT_TOLERANCE = 0.25; // seconds of allowed A/V drift before resync

export function VideoPlayer({
  src, poster, startAt = 0, onProgress, onEnded, autoPlay, captions,
  audioSrc, audioLabel, playlistUrl,
}: Props) {

  const wrapRef = useRef<HTMLDivElement>(null);
  const vidRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const sid = useMemo(() => Math.random().toString(36).slice(2, 10), []);
  const playSrc = useMemo(() => `${src}${src.includes("?") ? "&" : "?"}sid=${sid}`, [src, sid]);
  // A second, throttled element used only to render real frames while scrubbing.
  // It streams in "preview" mode so it never disturbs the main sequential read.
  const previewSrc = useMemo(() => `${src}${src.includes("?") ? "&" : "?"}preview=1`, [src]);
  const previewReq = useRef<{ target: number | null; busy: boolean; timer: ReturnType<typeof setTimeout> | null }>({ target: null, busy: false, timer: null });
  const barRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(() => {
    if (typeof window === "undefined") return 1;
    const v = parseFloat(localStorage.getItem("vault:vol") || "1");
    return isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  });
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(() => {
    if (typeof window === "undefined") return 1;
    const r = parseFloat(localStorage.getItem("vault:rate") || "1");
    return isFinite(r) ? r : 1;
  });
  const [fs, setFs] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [loading, setLoading] = useState(true);
  const [menu, setMenu] = useState<null | "rate" | "settings">(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [previewFrame, setPreviewFrame] = useState<string | null>(null);
  const [seekFlash, setSeekFlash] = useState<null | "back" | "fwd">(null);
  const [toast, setToast] = useState<string | null>(null);
  const [fit, setFit] = useState<"contain" | "cover">(() => {
    if (typeof window === "undefined") return "contain";
    return localStorage.getItem("vault:fit") === "cover" ? "cover" : "contain";
  });
  const [stats, setStats] = useState(false);
  const [noAudio, setNoAudio] = useState(false);
  const [noAudioDismissed, setNoAudioDismissed] = useState(false);
  const altRef = useRef<HTMLAudioElement>(null);
  const [useAlt, setUseAlt] = useState(!!audioSrc);
  const [altReady, setAltReady] = useState(false);
  const [drift, setDrift] = useState(0);

  const [res, setRes] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [stalled, setStalled] = useState(false);

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapCache = useRef<Map<number, string>>(new Map());
  const lastSnap = useRef(0);
  const lastReport = useRef(0);
  const lastTap = useRef<{ t: number; side: "l" | "r" | null }>({ t: 0, side: null });
  const SNAP_BUCKET = 2; // seconds per cached snapshot



  const kickHide = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (vidRef.current && !vidRef.current.paused && !menu) setShowControls(false);
    }, 2500);
  }, [menu]);

  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 900);
  }, []);

  const captureFrom = useCallback((el: HTMLVideoElement, atTime: number) => {
    if (!el.videoWidth) return null;
    try {
      const c = document.createElement("canvas");
      const W = 256;
      const H = Math.round((el.videoHeight / el.videoWidth) * W) || 144;
      c.width = W; c.height = H;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(el, 0, 0, W, H);
      const url = c.toDataURL("image/jpeg", 0.62);
      snapCache.current.set(Math.round(atTime / SNAP_BUCKET), url);
      return url;
    } catch {
      return null;
    }
  }, []);

  const nearestSnapshot = useCallback((t: number) => {
    const bucket = Math.round(t / SNAP_BUCKET);
    const exact = snapCache.current.get(bucket);
    if (exact) return exact;
    let best: string | null = null; let bestDist = Infinity;
    for (const [k, v2] of snapCache.current) {
      const d = Math.abs(k - bucket);
      if (d < bestDist) { bestDist = d; best = v2; }
    }
    // Only reuse a neighbouring frame if it's genuinely close in time.
    return bestDist <= 6 ? best : null;
  }, []);

  // Real-time scrubbing: throttled seeks on the hidden preview decoder so the
  // tooltip shows the actual frame under the cursor, not one cached still.
  const pumpPreview = useCallback(() => {
    const el = previewRef.current;
    const req = previewReq.current;
    if (!el || req.busy || req.target == null) return;
    const target = req.target;
    req.target = null;
    req.busy = true;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener("seeked", onSeeked);
      req.busy = false;
      if (req.target != null) pumpPreview();
    };
    const onSeeked = () => {
      const url = captureFrom(el, target);
      if (url) setPreviewFrame(url);
      finish();
    };
    el.addEventListener("seeked", onSeeked);
    setTimeout(finish, 2500);
    try { el.currentTime = target; } catch { finish(); }
  }, [captureFrom]);

  const requestPreviewAt = useCallback((t: number) => {
    const cached = nearestSnapshot(t);
    if (cached) setPreviewFrame(cached);
    const req = previewReq.current;
    req.target = t;
    if (req.timer) clearTimeout(req.timer);
    req.timer = setTimeout(() => pumpPreview(), 80);
  }, [nearestSnapshot, pumpPreview]);

  useEffect(() => {
    const v = vidRef.current; if (!v) return;
    v.volume = volume;
    v.playbackRate = rate;
  }, []); // eslint-disable-line

  useEffect(() => {
    snapCache.current.clear();
    setPreviewFrame(null);
    lastSnap.current = 0;
    previewReq.current = { target: null, busy: false, timer: null };
  }, [src]);

  useEffect(() => {
    const v = vidRef.current; if (!v) return;
    const onLoaded = () => {
      setDuration(v.duration); setLoading(false);
      setRes({ w: v.videoWidth, h: v.videoHeight });
      if (startAt > 0 && startAt < v.duration - 5) v.currentTime = startAt;
    };
    const onTime = () => {
      setCurrent(v.currentTime);
      if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
      // Detect an undecodable audio track (Dolby DD+/EAC3, DTS, TrueHD in MKV):
      // video decodes fine but zero audio bytes are ever decoded.
      if (!audioSrc && !v.paused && v.currentTime > 4) {
        const decoded = (v as unknown as { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount;
        if (typeof decoded === "number") setNoAudio(decoded === 0);
      }


      if (onProgress && v.currentTime - lastReport.current > 5) { lastReport.current = v.currentTime; onProgress(v.currentTime, v.duration); }
      // Capture a snapshot at most every ~1s while playing, bucket by SNAP_BUCKET
      const now = performance.now();
      if (!v.paused && !v.seeking && v.videoWidth > 0 && now - lastSnap.current > 900) {
        lastSnap.current = now;
        const bucket = Math.floor(v.currentTime / SNAP_BUCKET);
        if (!snapCache.current.has(bucket)) {
          try {
            const c = document.createElement("canvas");
            const W = 240; const H = Math.round((v.videoHeight / v.videoWidth) * W) || 135;
            c.width = W; c.height = H;
            const ctx = c.getContext("2d");
            if (ctx) {
              ctx.drawImage(v, 0, 0, W, H);
              snapCache.current.set(bucket, c.toDataURL("image/jpeg", 0.6));
            }
          } catch { /* CORS or codec issue — ignore */ }
        }
      }
    };
    const onProg = () => {
      if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
    };
    const onPlay = () => { setPlaying(true); kickHide(); };
    const onPause = () => { setPlaying(false); setShowControls(true); if (onProgress) onProgress(v.currentTime, v.duration); };
    const onEnd = () => { if (onProgress) onProgress(v.duration, v.duration); onEnded?.(); };
    const onWait = () => setLoading(true);
    const onCanPlay = () => setLoading(false);
    const onRate = () => setRate(v.playbackRate);
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("progress", onProg);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnd);
    v.addEventListener("waiting", onWait);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("playing", onCanPlay);
    v.addEventListener("ratechange", onRate);
    return () => {
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("progress", onProg);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnd);
      v.removeEventListener("waiting", onWait);
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("playing", onCanPlay);
      v.removeEventListener("ratechange", onRate);
    };
  }, [startAt, onProgress, onEnded, kickHide]);

  useEffect(() => {
    const onFs = () => setFs(!!(document.fullscreenElement || (document as any).webkitFullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs as EventListener);
    };
  }, []);

  // Stall watchdog: if the network response dies mid-range the element can hang
  // forever on "waiting". Nudge it back to the same position to reopen a range.
  useEffect(() => {
    const v = vidRef.current; if (!v) return;
    let last = -1;
    let stuck = 0;
    const iv = setInterval(() => {
      if (v.paused || v.seeking) { stuck = 0; setStalled(false); return; }
      if (Math.abs(v.currentTime - last) < 0.02) {
        stuck += 1;
        if (stuck === 3) setStalled(true);
        if (stuck >= 6) {
          stuck = 0;
          try {
            const t = v.currentTime;
            v.currentTime = Math.min((v.duration || t) - 0.1, t + 0.001);
            v.play().catch(() => {});
          } catch { /* ignore */ }
        }
      } else {
        stuck = 0;
        setStalled(false);
      }
      last = v.currentTime;
    }, 1000);
    return () => clearInterval(iv);
  }, [src]);

  // ---- Companion audio track (Netflix-style separate audio rendition) ----
  // When the original soundtrack is undecodable (DTS/TrueHD/E-AC-3), we mute
  // the video element and drive a parallel <audio> element that carries an
  // AAC rendition, keeping it locked to the video clock.
  useEffect(() => { setUseAlt(!!audioSrc); setAltReady(false); }, [audioSrc]);

  useEffect(() => {
    const v = vidRef.current;
    const a = altRef.current;
    if (!v) return;
    if (!a || !useAlt) { v.muted = muted; return; }

    v.muted = true;
    a.muted = muted;
    a.volume = volume;
    a.playbackRate = v.playbackRate;

    const sync = (force = false) => {
      if (!a.duration && !force) return;
      const d = a.currentTime - v.currentTime;
      setDrift(d);
      if (force || Math.abs(d) > DRIFT_TOLERANCE) {
        try { a.currentTime = v.currentTime; } catch { /* not seekable yet */ }
      }
    };

    const onPlay = () => { sync(true); a.play().catch(() => {}); };
    const onPause = () => a.pause();
    const onSeeked = () => { sync(true); if (!v.paused) a.play().catch(() => {}); };
    const onSeeking = () => a.pause();
    const onRate = () => { a.playbackRate = v.playbackRate; };
    const onWait = () => a.pause();
    const onPlaying = () => { sync(true); a.play().catch(() => {}); };
    const onAltReady = () => setAltReady(true);

    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("seeking", onSeeking);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("ratechange", onRate);
    v.addEventListener("waiting", onWait);
    v.addEventListener("playing", onPlaying);
    a.addEventListener("loadedmetadata", onAltReady);
    a.addEventListener("canplay", onAltReady);

    const iv = setInterval(() => { if (!v.paused && !v.seeking) sync(); }, 1000);
    if (!v.paused) onPlay();

    return () => {
      clearInterval(iv);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("seeking", onSeeking);
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("ratechange", onRate);
      v.removeEventListener("waiting", onWait);
      v.removeEventListener("playing", onPlaying);
      a.removeEventListener("loadedmetadata", onAltReady);
      a.removeEventListener("canplay", onAltReady);
      a.pause();
    };
  }, [useAlt, audioSrc, muted, volume]);

  const togglePlay = useCallback(() => { const v = vidRef.current; if (!v) return; v.paused ? v.play() : v.pause(); }, []);
  const seek = useCallback((dt: number) => {
    const v = vidRef.current; if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + dt));
    setSeekFlash(dt < 0 ? "back" : "fwd");
    setTimeout(() => setSeekFlash(null), 400);
    kickHide();
  }, [kickHide]);
  const setPos = (t: number) => { const v = vidRef.current; if (!v) return; v.currentTime = t; };
  const toggleMute = () => {
    const v = vidRef.current; if (!v) return;
    const next = !muted;
    setMuted(next);
    if (useAlt && altRef.current) { altRef.current.muted = next; v.muted = true; }
    else v.muted = next;
    flashToast(next ? "Muted" : "Unmuted");
  };
  const setVol = (val: number) => {
    const v = vidRef.current; if (!v) return;
    setVolume(val);
    const m = val === 0;
    setMuted(m);
    if (useAlt && altRef.current) { altRef.current.volume = val; altRef.current.muted = m; v.muted = true; }
    else { v.volume = val; v.muted = m; }
    try { localStorage.setItem("vault:vol", String(val)); } catch {}
  };
  const setSpeed = (r: number) => {
    const v = vidRef.current; if (!v) return;
    v.playbackRate = r; setRate(r); setMenu(null);
    if (altRef.current) altRef.current.playbackRate = r;
    try { localStorage.setItem("vault:rate", String(r)); } catch {}
    flashToast(`${r}× speed`);
  };

  const toggleFs = () => {
    const el = wrapRef.current as any;
    const doc = document as any;
    if (!(document.fullscreenElement || doc.webkitFullscreenElement)) {
      (el?.requestFullscreen?.() ?? el?.webkitRequestFullscreen?.())?.catch?.(() => {});
    } else {
      (document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())?.catch?.(() => {});
    }
  };
  const toggleFit = () => {
    setFit((f) => {
      const next = f === "contain" ? "cover" : "contain";
      try { localStorage.setItem("vault:fit", next); } catch { /* ignore */ }
      flashToast(next === "cover" ? "Fill screen" : "Fit to screen");
      return next;
    });
  };
  const pip = async () => {
    const v = vidRef.current; if (!v) return;
    try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await v.requestPictureInPicture(); } catch {}
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      switch (e.key.toLowerCase()) {
        case " ": case "k": e.preventDefault(); togglePlay(); break;
        case "arrowleft": e.preventDefault(); seek(-5); break;
        case "arrowright": e.preventDefault(); seek(5); break;
        case "j": seek(-10); break;
        case "l": seek(10); break;
        case ",": seek(-1 / 30); break;
        case ".": seek(1 / 30); break;
        case "arrowup": e.preventDefault(); setVol(Math.min(1, volume + 0.05)); break;
        case "arrowdown": e.preventDefault(); setVol(Math.max(0, volume - 0.05)); break;
        case "m": toggleMute(); break;
        case "f": toggleFs(); break;
        case "i": pip(); break;
        case "<": {
          const idx = RATES.indexOf(rate);
          setSpeed(RATES[Math.max(0, idx - 1)] ?? 1);
          break;
        }
        case ">": {
          const idx = RATES.indexOf(rate);
          setSpeed(RATES[Math.min(RATES.length - 1, idx + 1)] ?? 1);
          break;
        }
        case "0": case "1": case "2": case "3": case "4": case "5": case "6": case "7": case "8": case "9":
          { const v = vidRef.current; if (v) v.currentTime = (parseInt(e.key) / 10) * v.duration; } break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seek, volume, rate]); // eslint-disable-line

  const pct = duration > 0 ? (current / duration) * 100 : 0;
  const bufPct = duration > 0 ? (buffered / duration) * 100 : 0;
  const hoverTime = useMemo(() => (hoverPct != null ? (hoverPct / 100) * duration : 0), [hoverPct, duration]);

  const handleTap = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target !== e.currentTarget && target.tagName !== "VIDEO") return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const side: "l" | "r" = x < r.width / 2 ? "l" : "r";
    const now = Date.now();
    if (now - lastTap.current.t < 320 && lastTap.current.side === side) {
      seek(side === "l" ? -10 : 10);
      lastTap.current = { t: 0, side: null };
    } else {
      lastTap.current = { t: now, side };
      setTimeout(() => {
        if (lastTap.current.t === now) { togglePlay(); lastTap.current = { t: 0, side: null }; }
      }, 260);
    }
  };

  return (
    <div
      ref={wrapRef}
      className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden group select-none"
      onMouseMove={kickHide}
      onMouseLeave={() => { if (playing && !menu) setShowControls(false); }}
      onClick={handleTap}
      onDoubleClick={(e) => { e.preventDefault(); toggleFs(); }}
    >
      <video
        ref={vidRef}
        src={playSrc}
        poster={poster ?? undefined}
        className={`w-full h-full touch-manipulation ${fit === "cover" ? "object-cover" : "object-contain"}`}
        style={{ imageRendering: "auto" }}
        autoPlay={autoPlay}
        playsInline
        preload="auto"
        crossOrigin="anonymous"
      >
        {(captions ?? []).map((t, i) => (
          <track key={i} kind="subtitles" src={t.src} srcLang={t.srclang} label={t.label} default={t.default} />
        ))}
      </video>

      {/* Hidden scrub-preview decoder (muted, never plays) */}
      <video
        ref={previewRef}
        src={previewSrc}
        muted
        playsInline
        preload="metadata"
        crossOrigin="anonymous"
        aria-hidden
        tabIndex={-1}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none", left: -9999, top: -9999 }}
      />


      {loading && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="w-16 h-16 rounded-full bg-black/50 backdrop-blur-sm grid place-items-center">
            <Loader2 className="w-9 h-9 text-white animate-spin" />
          </div>
        </div>
      )}

      {stalled && !loading && (
        <div className="absolute top-4 left-4 bg-black/70 backdrop-blur px-3 py-1.5 rounded-full text-[11px] text-amber-300 pointer-events-none">
          Buffering… recovering stream
        </div>
      )}

      {noAudio && !noAudioDismissed && (
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 z-20 max-w-[90%] bg-black/85 backdrop-blur border border-primary/40 rounded-xl px-4 py-3 text-xs text-white/85 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="font-semibold text-white mb-1">No sound? This file's audio track can't be decoded here</p>
          <p className="text-white/60 leading-relaxed">
            It uses Dolby Digital+/DTS/TrueHD, which browsers can't play. The video is fine — open the
            original in a desktop player (VLC/MPV) for full audio.
          </p>
          <div className="flex gap-2 mt-2">
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium"
            >
              Open original
            </a>
            <button
              type="button"
              onClick={() => setNoAudioDismissed(true)}
              className="px-3 py-1.5 rounded-lg bg-white/10 text-white/80"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}


      {stats && (
        <div className="absolute top-4 right-4 bg-black/80 backdrop-blur rounded-lg px-3 py-2 text-[10px] font-mono text-white/80 leading-relaxed pointer-events-none">
          <div>res <span className="text-white">{res.w ? `${res.w}×${res.h}` : "—"}</span></div>
          <div>time <span className="text-white">{fmt(current)}</span> / {fmt(duration)}</div>
          <div>buffer ahead <span className="text-white">{Math.max(0, buffered - current).toFixed(1)}s</span></div>
          <div>rate <span className="text-white">{rate}×</span> · fit {fit}</div>
        </div>
      )}

      {seekFlash && (
        <div className={`absolute inset-y-0 ${seekFlash === "back" ? "left-0" : "right-0"} w-1/3 grid place-items-center pointer-events-none animate-in fade-in zoom-in-95 duration-200`}>
          <div className="bg-black/60 backdrop-blur rounded-full w-20 h-20 grid place-items-center text-white">
            {seekFlash === "back" ? <Rewind className="w-8 h-8 fill-white" /> : <FastForward className="w-8 h-8 fill-white" />}
          </div>
        </div>
      )}

      {toast && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur px-3 py-1.5 rounded-full text-white text-xs font-medium pointer-events-none">
          {toast}
        </div>
      )}

      {!playing && !loading && (
        <button onClick={togglePlay} className="absolute inset-0 grid place-items-center bg-gradient-to-b from-black/10 via-transparent to-black/30" aria-label="Play">
          <div className="w-24 h-24 rounded-full bg-red-500 grid place-items-center shadow-2xl shadow-red-500/60 hover:scale-110 active:scale-95 transition-transform">
            <Play className="w-12 h-12 text-white fill-white ml-1" />
          </div>
        </button>
      )}

      <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-4 pt-20 pb-3 transition-all duration-300 ${showControls || menu ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"}`}>
        {/* Progress bar with drag scrubbing + frame preview */}
        <div
          ref={barRef}
          className="relative h-6 -my-2 mb-1 group/bar cursor-pointer touch-none flex items-center"
          onPointerDown={(e) => {
            e.stopPropagation();
            const bar = barRef.current; if (!bar || !duration) return;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            setScrubbing(true);
            const wasPlaying = vidRef.current ? !vidRef.current.paused : false;
            if (wasPlaying) vidRef.current?.pause();
            (e.currentTarget as any)._wasPlaying = wasPlaying;
            const r = bar.getBoundingClientRect();
            const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
            setHoverPct(p * 100);
            setPos(p * duration);
            requestPreviewAt(p * duration);
          }}
          onPointerMove={(e) => {
            const bar = barRef.current; if (!bar || !duration) return;
            const r = bar.getBoundingClientRect();
            const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
            setHoverPct(p * 100);
            if (scrubbing) setPos(p * duration);
            requestPreviewAt(p * duration);

          }}
          onPointerUp={(e) => {
            (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
            if (scrubbing) {
              setScrubbing(false);
              if ((e.currentTarget as any)._wasPlaying) vidRef.current?.play().catch(() => {});
            }
          }}
          onPointerLeave={() => { if (!scrubbing) { setHoverPct(null); setPreviewFrame(null); } }}
        >
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 bg-white/20 rounded-full group-hover/bar:h-1.5 transition-all" />
          <div className="absolute inset-y-0 left-0 top-1/2 -translate-y-1/2 h-1 bg-white/40 rounded-full group-hover/bar:h-1.5 transition-all pointer-events-none" style={{ width: `${bufPct}%` }} />
          <div className="absolute inset-y-0 left-0 top-1/2 -translate-y-1/2 h-1 bg-red-500 rounded-full group-hover/bar:h-1.5 transition-all pointer-events-none" style={{ width: `${pct}%` }} />
          {hoverPct != null && (
            <>
              <div className="absolute top-1/2 -translate-y-1/2 h-1 bg-white/30 rounded-full pointer-events-none" style={{ left: 0, width: `${hoverPct}%` }} />
              {/* Frame preview thumbnail */}
              <div
                className="absolute -top-[124px] -translate-x-1/2 pointer-events-none flex flex-col items-center gap-1"
                style={{ left: `min(max(${hoverPct}%, 84px), calc(100% - 84px))` }}
              >
                <div className="w-44 aspect-video bg-black rounded-md overflow-hidden ring-1 ring-white/20 shadow-2xl relative">
                  {previewFrame ? (
                    <img src={previewFrame} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center bg-zinc-900 text-[10px] text-white/50 font-mono">
                      {fmt(hoverTime)}
                    </div>
                  )}

                </div>
                <div className="bg-black/90 text-white text-[11px] px-2 py-0.5 rounded font-mono">{fmt(hoverTime)}</div>
              </div>
            </>
          )}
          <div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-red-500 shadow-lg shadow-red-500/50 opacity-0 group-hover/bar:opacity-100 transition pointer-events-none" style={{ left: `calc(${pct}% - 7px)` }} />
        </div>


        <div className="flex items-center gap-1 text-white" onClick={(e) => e.stopPropagation()}>
          <button onClick={togglePlay} className="p-2 hover:bg-white/10 rounded-lg transition" aria-label="Play/Pause">
            {playing ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white" />}
          </button>
          <button onClick={() => seek(-10)} className="p-2 hover:bg-white/10 rounded-lg transition" title="Back 10s (J)"><SkipBack className="w-5 h-5" /></button>
          <button onClick={() => seek(10)} className="p-2 hover:bg-white/10 rounded-lg transition" title="Forward 10s (L)"><SkipForward className="w-5 h-5" /></button>

          <div className="flex items-center gap-1 ml-1 group/vol">
            <button onClick={toggleMute} className="p-2 hover:bg-white/10 rounded-lg transition">
              {muted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
            <input type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume}
              onChange={(e) => setVol(parseFloat(e.target.value))}
              className="w-0 group-hover/vol:w-24 transition-all accent-red-500 cursor-pointer" />
          </div>

          <span className="text-xs tabular-nums text-white/90 ml-2 font-mono">{fmt(current)} <span className="text-white/50">/ {fmt(duration)}</span></span>

          <div className="ml-auto flex items-center gap-1">
            <div className="relative">
              <button onClick={() => setMenu(menu === "rate" ? null : "rate")} className="px-2.5 py-1 hover:bg-white/10 rounded-lg text-xs font-semibold flex items-center gap-1">
                <Gauge className="w-3.5 h-3.5" /> {rate}×
              </button>
              {menu === "rate" && (
                <div className="absolute bottom-full right-0 mb-2 bg-black/95 border border-white/10 rounded-lg overflow-hidden shadow-xl min-w-[90px] max-h-64 overflow-y-auto">
                  {RATES.map((r) => (
                    <button key={r} onClick={() => setSpeed(r)} className={`block px-4 py-1.5 text-xs w-full text-left hover:bg-white/10 ${r === rate ? "text-red-400 font-semibold" : ""}`}>{r}×</button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <button onClick={() => setMenu(menu === "settings" ? null : "settings")} className="p-2 hover:bg-white/10 rounded-lg transition" title="Shortcuts">
                <Settings className="w-5 h-5" />
              </button>
              {menu === "settings" && (
                <div className="absolute bottom-full right-0 mb-2 bg-black/95 border border-white/10 rounded-lg p-3 shadow-xl w-64 text-[11px] text-white/80">
                  <div className="text-white font-semibold mb-2 text-xs">Quality &amp; display</div>
                  <div className="grid grid-cols-2 gap-y-1 mb-3">
                    <span>Source</span>
                    <span className="text-right font-mono text-white">{res.w ? `${res.w}×${res.h}` : "—"}</span>
                    <span>Mode</span>
                    <span className="text-right font-mono text-red-400">Original (no re-encode)</span>
                  </div>
                  <button
                    onClick={toggleFit}
                    className="w-full mb-1.5 px-2 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-left text-white text-[11px] font-medium transition"
                  >
                    Screen fit: <span className="font-mono">{fit === "cover" ? "Fill" : "Fit"}</span>
                  </button>
                  <button
                    onClick={() => setStats((s) => !s)}
                    className="w-full mb-3 px-2 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-left text-white text-[11px] font-medium transition"
                  >
                    Stats for nerds: <span className="font-mono">{stats ? "On" : "Off"}</span>
                  </button>
                  <div className="text-white font-semibold mb-2 text-xs">Keyboard shortcuts</div>

                  <div className="grid grid-cols-2 gap-y-1">
                    <span>Play / Pause</span><span className="text-right font-mono">Space · K</span>
                    <span>Seek ±5s</span><span className="text-right font-mono">← →</span>
                    <span>Seek ±10s</span><span className="text-right font-mono">J · L</span>
                    <span>Frame step</span><span className="text-right font-mono">, · .</span>
                    <span>Volume</span><span className="text-right font-mono">↑ ↓</span>
                    <span>Mute</span><span className="text-right font-mono">M</span>
                    <span>Fullscreen</span><span className="text-right font-mono">F · dblclick</span>
                    <span>Picture-in-picture</span><span className="text-right font-mono">I</span>
                    <span>Speed −/+</span><span className="text-right font-mono">&lt; · &gt;</span>
                    <span>Jump %</span><span className="text-right font-mono">0–9</span>
                  </div>
                </div>
              )}
            </div>
            <button onClick={pip} className="p-2 hover:bg-white/10 rounded-lg transition" aria-label="Picture in picture" title="Picture-in-picture (I)"><PictureInPicture2 className="w-5 h-5" /></button>
            <button onClick={toggleFs} className="p-2 hover:bg-white/10 rounded-lg transition" aria-label="Fullscreen" title="Fullscreen (F)">
              {fs ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
