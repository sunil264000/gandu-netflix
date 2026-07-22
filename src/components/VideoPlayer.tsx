import { useEffect, useRef, useState, useCallback } from "react";
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, PictureInPicture2,
  SkipBack, SkipForward, Loader2,
} from "lucide-react";

type Props = {
  src: string;
  poster?: string | null;
  startAt?: number;
  onProgress?: (pos: number, dur: number) => void;
  onEnded?: () => void;
  autoPlay?: boolean;
};

function fmt(t: number) {
  if (!isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const s = Math.floor(t % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function VideoPlayer({ src, poster, startAt = 0, onProgress, onEnded, autoPlay }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const vidRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fs, setFs] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [loading, setLoading] = useState(true);
  const [showRate, setShowRate] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReport = useRef(0);

  const kickHide = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { if (vidRef.current && !vidRef.current.paused) setShowControls(false); }, 2500);
  }, []);

  useEffect(() => {
    const v = vidRef.current; if (!v) return;
    const onLoaded = () => { setDuration(v.duration); setLoading(false); if (startAt > 0 && startAt < v.duration - 5) v.currentTime = startAt; };
    const onTime = () => {
      setCurrent(v.currentTime);
      if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
      if (onProgress && v.currentTime - lastReport.current > 5) { lastReport.current = v.currentTime; onProgress(v.currentTime, v.duration); }
    };
    const onPlay = () => { setPlaying(true); kickHide(); };
    const onPause = () => { setPlaying(false); setShowControls(true); if (onProgress) onProgress(v.currentTime, v.duration); };
    const onEnd = () => { if (onProgress) onProgress(v.duration, v.duration); onEnded?.(); };
    const onWait = () => setLoading(true);
    const onCanPlay = () => setLoading(false);
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnd);
    v.addEventListener("waiting", onWait);
    v.addEventListener("canplay", onCanPlay);
    return () => {
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnd);
      v.removeEventListener("waiting", onWait);
      v.removeEventListener("canplay", onCanPlay);
    };
  }, [startAt, onProgress, onEnded, kickHide]);

  useEffect(() => {
    const onFs = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const togglePlay = useCallback(() => { const v = vidRef.current; if (!v) return; v.paused ? v.play() : v.pause(); }, []);
  const seek = (dt: number) => { const v = vidRef.current; if (!v) return; v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + dt)); kickHide(); };
  const setPos = (t: number) => { const v = vidRef.current; if (!v) return; v.currentTime = t; };
  const toggleMute = () => { const v = vidRef.current; if (!v) return; v.muted = !v.muted; setMuted(v.muted); };
  const setVol = (val: number) => { const v = vidRef.current; if (!v) return; v.volume = val; setVolume(val); v.muted = val === 0; setMuted(v.muted); };
  const setSpeed = (r: number) => { const v = vidRef.current; if (!v) return; v.playbackRate = r; setRate(r); setShowRate(false); };
  const toggleFs = () => { if (!document.fullscreenElement) wrapRef.current?.requestFullscreen(); else document.exitFullscreen(); };
  const pip = async () => { const v = vidRef.current; if (!v) return; try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await v.requestPictureInPicture(); } catch {} };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      switch (e.key.toLowerCase()) {
        case " ": e.preventDefault(); togglePlay(); break;
        case "arrowleft": case "j": seek(-10); break;
        case "arrowright": case "l": seek(10); break;
        case "arrowup": e.preventDefault(); setVol(Math.min(1, volume + 0.05)); break;
        case "arrowdown": e.preventDefault(); setVol(Math.max(0, volume - 0.05)); break;
        case "m": toggleMute(); break;
        case "f": toggleFs(); break;
        case "0": case "1": case "2": case "3": case "4": case "5": case "6": case "7": case "8": case "9":
          { const v = vidRef.current; if (v) v.currentTime = (parseInt(e.key) / 10) * v.duration; } break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, volume]);

  const pct = duration > 0 ? (current / duration) * 100 : 0;
  const bufPct = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={wrapRef}
      className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden group"
      onMouseMove={kickHide}
      onMouseLeave={() => { if (playing) setShowControls(false); }}
      onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "VIDEO") togglePlay(); }}
    >
      <video ref={vidRef} src={src} poster={poster ?? undefined} className="w-full h-full" autoPlay={autoPlay} playsInline preload="metadata" />

      {loading && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <Loader2 className="w-12 h-12 text-white animate-spin" />
        </div>
      )}

      {!playing && !loading && (
        <button onClick={togglePlay} className="absolute inset-0 grid place-items-center bg-black/30" aria-label="Play">
          <div className="w-20 h-20 rounded-full bg-red-500 grid place-items-center shadow-2xl shadow-red-500/50 hover:scale-110 transition">
            <Play className="w-10 h-10 text-white fill-white ml-1" />
          </div>
        </button>
      )}

      <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pt-16 pb-3 transition-opacity ${showControls ? "opacity-100" : "opacity-0"}`}>
        {/* Progress bar */}
        <div className="relative h-1 mb-3 group/bar cursor-pointer" onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos(((e.clientX - r.left) / r.width) * duration);
        }}>
          <div className="absolute inset-0 bg-white/20 rounded-full" />
          <div className="absolute inset-y-0 left-0 bg-white/30 rounded-full" style={{ width: `${bufPct}%` }} />
          <div className="absolute inset-y-0 left-0 bg-red-500 rounded-full" style={{ width: `${pct}%` }} />
          <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-red-500 shadow opacity-0 group-hover/bar:opacity-100 transition" style={{ left: `calc(${pct}% - 6px)` }} />
        </div>

        <div className="flex items-center gap-2 text-white">
          <button onClick={togglePlay} className="p-2 hover:bg-white/10 rounded-lg transition" aria-label="Play/Pause">
            {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </button>
          <button onClick={() => seek(-10)} className="p-2 hover:bg-white/10 rounded-lg transition"><SkipBack className="w-5 h-5" /></button>
          <button onClick={() => seek(10)} className="p-2 hover:bg-white/10 rounded-lg transition"><SkipForward className="w-5 h-5" /></button>

          <div className="flex items-center gap-2 ml-1 group/vol">
            <button onClick={toggleMute} className="p-2 hover:bg-white/10 rounded-lg transition">
              {muted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
            <input type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume}
              onChange={(e) => setVol(parseFloat(e.target.value))}
              className="w-0 group-hover/vol:w-20 transition-all accent-red-500" />
          </div>

          <span className="text-xs tabular-nums text-white/80 ml-2">{fmt(current)} / {fmt(duration)}</span>

          <div className="ml-auto flex items-center gap-1">
            <div className="relative">
              <button onClick={() => setShowRate((s) => !s)} className="px-2 py-1 hover:bg-white/10 rounded-lg text-xs font-medium">{rate}×</button>
              {showRate && (
                <div className="absolute bottom-full right-0 mb-2 bg-black/90 border border-white/10 rounded-lg overflow-hidden">
                  {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => (
                    <button key={r} onClick={() => setSpeed(r)} className={`block px-4 py-1.5 text-xs w-full text-left hover:bg-white/10 ${r === rate ? "text-red-400" : ""}`}>{r}×</button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={pip} className="p-2 hover:bg-white/10 rounded-lg transition" aria-label="Picture in picture"><PictureInPicture2 className="w-5 h-5" /></button>
            <button onClick={toggleFs} className="p-2 hover:bg-white/10 rounded-lg transition" aria-label="Fullscreen">
              {fs ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
