import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, PictureInPicture2,
  SkipBack, SkipForward, Loader2, Settings, Gauge, Rewind, FastForward,
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
};

function fmt(t: number) {
  if (!isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const s = Math.floor(t % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export function VideoPlayer({ src, poster, startAt = 0, onProgress, onEnded, autoPlay, captions }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const vidRef = useRef<HTMLVideoElement>(null);
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
  const [seekFlash, setSeekFlash] = useState<null | "back" | "fwd">(null);
  const [toast, setToast] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReport = useRef(0);
  const lastTap = useRef<{ t: number; side: "l" | "r" | null }>({ t: 0, side: null });

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

  useEffect(() => {
    const v = vidRef.current; if (!v) return;
    v.volume = volume;
    v.playbackRate = rate;
  }, []); // eslint-disable-line

  useEffect(() => {
    const v = vidRef.current; if (!v) return;
    const onLoaded = () => {
      setDuration(v.duration); setLoading(false);
      if (startAt > 0 && startAt < v.duration - 5) v.currentTime = startAt;
    };
    const onTime = () => {
      setCurrent(v.currentTime);
      if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
      if (onProgress && v.currentTime - lastReport.current > 5) { lastReport.current = v.currentTime; onProgress(v.currentTime, v.duration); }
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
    const onFs = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const togglePlay = useCallback(() => { const v = vidRef.current; if (!v) return; v.paused ? v.play() : v.pause(); }, []);
  const seek = useCallback((dt: number) => {
    const v = vidRef.current; if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + dt));
    setSeekFlash(dt < 0 ? "back" : "fwd");
    setTimeout(() => setSeekFlash(null), 400);
    kickHide();
  }, [kickHide]);
  const setPos = (t: number) => { const v = vidRef.current; if (!v) return; v.currentTime = t; };
  const toggleMute = () => { const v = vidRef.current; if (!v) return; v.muted = !v.muted; setMuted(v.muted); flashToast(v.muted ? "Muted" : "Unmuted"); };
  const setVol = (val: number) => {
    const v = vidRef.current; if (!v) return;
    v.volume = val; setVolume(val); v.muted = val === 0; setMuted(v.muted);
    try { localStorage.setItem("vault:vol", String(val)); } catch {}
  };
  const setSpeed = (r: number) => {
    const v = vidRef.current; if (!v) return;
    v.playbackRate = r; setRate(r); setMenu(null);
    try { localStorage.setItem("vault:rate", String(r)); } catch {}
    flashToast(`${r}× speed`);
  };
  const toggleFs = () => { if (!document.fullscreenElement) wrapRef.current?.requestFullscreen(); else document.exitFullscreen(); };
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
        src={src}
        poster={poster ?? undefined}
        className="w-full h-full object-contain"
        style={{ imageRendering: "auto" }}
        autoPlay={autoPlay}
        playsInline
        preload="auto"
        crossOrigin="anonymous"
      />

      {loading && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="w-16 h-16 rounded-full bg-black/50 backdrop-blur-sm grid place-items-center">
            <Loader2 className="w-9 h-9 text-white animate-spin" />
          </div>
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
        {/* Progress bar */}
        <div
          className="relative h-1.5 mb-3 group/bar cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            setPos(((e.clientX - r.left) / r.width) * duration);
          }}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setHoverPct(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)));
          }}
          onMouseLeave={() => setHoverPct(null)}
        >
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 bg-white/20 rounded-full group-hover/bar:h-1.5 transition-all" />
          <div className="absolute inset-y-0 left-0 top-1/2 -translate-y-1/2 h-1 bg-white/40 rounded-full group-hover/bar:h-1.5 transition-all" style={{ width: `${bufPct}%` }} />
          <div className="absolute inset-y-0 left-0 top-1/2 -translate-y-1/2 h-1 bg-red-500 rounded-full group-hover/bar:h-1.5 transition-all" style={{ width: `${pct}%` }} />
          {hoverPct != null && (
            <>
              <div className="absolute inset-y-0 top-1/2 -translate-y-1/2 h-1 bg-white/30 rounded-full pointer-events-none" style={{ width: `${hoverPct}%` }} />
              <div className="absolute -top-8 -translate-x-1/2 bg-black/90 text-white text-[11px] px-2 py-1 rounded font-mono pointer-events-none" style={{ left: `${hoverPct}%` }}>
                {fmt(hoverTime)}
              </div>
            </>
          )}
          <div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-red-500 shadow-lg shadow-red-500/50 opacity-0 group-hover/bar:opacity-100 transition" style={{ left: `calc(${pct}% - 7px)` }} />
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
