// Reel Studio — the frame renderer.
//
// Everything you see in the preview and everything that ends up in the exported
// file comes from drawFrame(). It is a pure function of (time, state): the same
// second always paints the same pixels, which is what makes recording reliable.

import type { Scene, Template, TransitionId } from "./templates";

export const W = 1080;
export const H = 1920;

export type ReelMedia =
  | { kind: "none" }
  | { kind: "image"; el: HTMLImageElement }
  | { kind: "video"; el: HTMLVideoElement };

export type ReelState = {
  template: Template;
  scenes: Scene[];
  media: ReelMedia;
  handle: string;
  badge: string;
  accent: string;
  showProgress: boolean;
  /** 0..1 loudness from the audio analyser — drives the beat pulse. */
  level: number;
  /**
   * Editor preview while paused: show each line fully composed instead of
   * frozen halfway through its reveal.
   */
  settled?: boolean;
};


export type Timed = Scene & { start: number; end: number };

export function timeline(scenes: Scene[]): { items: Timed[]; total: number } {
  let t = 0;
  const items = scenes.map((s) => {
    const start = t;
    t += Math.max(0.4, s.dur);
    return { ...s, start, end: t };
  });
  return { items, total: t };
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOut = (x: number) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const easeBack = (x: number) => {
  const t = clamp01(x);
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
/** Deterministic pseudo-noise — the same frame must always paint the same pixels. */
const noise = (a: number, b = 0) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};


// ── grain ────────────────────────────────────────────────────────────────────
let grain: HTMLCanvasElement | null = null;
function grainPattern() {
  if (grain) return grain;
  const c = document.createElement("canvas");
  c.width = c.height = 220;
  const g = c.getContext("2d")!;
  const img = g.createImageData(c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 120 + Math.random() * 135;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 26;
  }
  g.putImageData(img, 0, 0);
  grain = c;
  return c;
}

// ── backdrops ────────────────────────────────────────────────────────────────
function drawBackdrop(ctx: CanvasRenderingContext2D, s: ReelState, t: number) {
  const { palette, backdrop } = s.template;
  const pulse = 1 + s.level * 0.06;

  ctx.fillStyle = palette.a;
  ctx.fillRect(0, 0, W, H);

  if (backdrop === "paper") {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, palette.a);
    g.addColorStop(1, palette.b);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else if (backdrop === "split") {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, palette.a);
    g.addColorStop(0.5, palette.b);
    g.addColorStop(1, palette.a);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-0.35 + Math.sin(t * 0.25) * 0.05);
    const bar = ctx.createLinearGradient(-W, 0, W, 0);
    bar.addColorStop(0, "transparent");
    bar.addColorStop(0.5, s.accent);
    bar.addColorStop(1, "transparent");
    ctx.fillStyle = bar;
    ctx.fillRect(-W, -60 * pulse, W * 2, 120 * pulse);
    ctx.restore();
  } else if (backdrop === "grid") {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, palette.b);
    g.addColorStop(1, palette.a);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    const step = 108;
    const off = (t * 22) % step;
    for (let x = -step; x <= W + step; x += step) {
      ctx.beginPath();
      ctx.moveTo(x + off, 0);
      ctx.lineTo(x + off, H);
      ctx.stroke();
    }
    for (let y = -step; y <= H + step; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y + off);
      ctx.lineTo(W, y + off);
      ctx.stroke();
    }
    ctx.restore();
  } else if (backdrop === "beam") {
    ctx.save();
    ctx.translate(W / 2, H * 0.34);
    ctx.rotate(Math.sin(t * 0.16) * 0.25);
    for (let i = 0; i < 5; i++) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, s.accent);
      g.addColorStop(1, "transparent");
      ctx.globalAlpha = 0.07 + i * 0.012 * pulse;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -200);
      ctx.lineTo(-420 + i * 190, H);
      ctx.lineTo(-220 + i * 190, H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  } else {
    // mesh / noir — two drifting colour clouds
    const blobs: [number, number, string, number][] = [
      [W * (0.28 + Math.sin(t * 0.19) * 0.12), H * (0.24 + Math.cos(t * 0.15) * 0.08), s.accent, 0.34],
      [W * (0.74 + Math.cos(t * 0.13) * 0.1), H * (0.72 + Math.sin(t * 0.17) * 0.09), palette.b, 0.5],
    ];
    for (const [x, y, color, alpha] of blobs) {
      const r = W * 0.85 * pulse;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, color);
      g.addColorStop(1, "transparent");
      ctx.globalAlpha = alpha;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;
  }

  // Photo / clip layer, cover-fitted with a slow Ken Burns push.
  if (s.media.kind !== "none") {
    const el = s.media.el as HTMLImageElement | HTMLVideoElement;
    const mw = s.media.kind === "video" ? (el as HTMLVideoElement).videoWidth : (el as HTMLImageElement).naturalWidth;
    const mh = s.media.kind === "video" ? (el as HTMLVideoElement).videoHeight : (el as HTMLImageElement).naturalHeight;
    if (mw && mh) {
      const zoom = 1.06 + Math.sin(t * 0.12) * 0.04;
      const scale = Math.max(W / mw, H / mh) * zoom;
      const dw = mw * scale;
      const dh = mh * scale;
      ctx.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.fillStyle = `rgba(6,6,9,${s.template.scrim})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // Vignette + grain unify every backdrop.
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.78);
  vig.addColorStop(0, "transparent");
  vig.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalAlpha = s.template.backdrop === "paper" ? 0.5 : 0.28;
  const p = ctx.createPattern(grainPattern(), "repeat")!;
  ctx.translate(-((t * 90) % 220), -((t * 140) % 220));
  ctx.fillStyle = p;
  ctx.fillRect(0, 0, W + 240, H + 240);
  ctx.restore();
}

// ── text layout ──────────────────────────────────────────────────────────────
type Word = { text: string; x: number; w: number; i: number };
type Line = { words: Word[]; w: number };

function layoutText(ctx: CanvasRenderingContext2D, text: string, maxW: number): Line[] {
  const words = text.split(/\s+/).filter(Boolean);
  const space = ctx.measureText(" ").width;
  const lines: Line[] = [];
  let cur: Word[] = [];
  let x = 0;
  let i = 0;
  for (const raw of words) {
    const w = ctx.measureText(raw).width;
    if (cur.length && x + w > maxW) {
      lines.push({ words: cur, w: x - space });
      cur = [];
      x = 0;
    }
    cur.push({ text: raw, x, w, i: i++ });
    x += w + space;
  }
  if (cur.length) lines.push({ words: cur, w: x - space });
  return lines;
}

function fontString(tpl: Template, size: number) {
  return `${tpl.weight} ${size}px ${tpl.font}`;
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  s: ReelState,
  item: Timed,
  t: number,
  opts: {
    // `plain` skips the built-in fade in/out because a scene transition is
    // already handling the blend for this frame.
    plain?: boolean;
    // Length of the incoming transition. The word-by-word reveal is warped to
    // finish exactly when the cut lands, so the transition always carries a
    // fully composed line instead of an empty layer.
    transIn?: number;
    // The next scene cuts with a real transition, so don't fade this one out —
    // the transition owns the blend.
    holdOut?: boolean;
  } = {},
) {
  const tpl = s.template;
  // Small head start so the very first frame of a scene is already legible
  // rather than a blank fade-in — matters for the paused preview and thumbnails.
  let local = t - item.start + 0.07;

  const dur = item.end - item.start;
  const text = tpl.uppercase ? item.text.toUpperCase() : item.text;

  const maxW = W - 180;
  let size = tpl.size;
  let lines: Line[] = [];
  // Shrink until the block fits comfortably in the safe area.
  for (let guard = 0; guard < 14; guard++) {
    ctx.font = fontString(tpl, size);
    ctx.letterSpacing = `${tpl.letter}px`;
    lines = layoutText(ctx, text, maxW);
    const height = lines.length * size * tpl.lineGap;
    if (height <= H * 0.52 && lines.length <= 6) break;
    size *= 0.9;
  }

  const lineH = size * tpl.lineGap;
  const blockH = lines.length * lineH;
  const cy = tpl.layout === "center" ? H / 2 : tpl.layout === "top" ? H * 0.26 + blockH / 2 : H * 0.76 - blockH / 2;
  const top = cy - blockH / 2;

  const total = lines.reduce((n, l) => n + l.words.length, 0);
  const perWord = Math.min(0.13, (dur * 0.55) / Math.max(1, total));

  // Warp the reveal clock into the transition window (monotonic, so nothing
  // ever pops back out once it has appeared).
  const tIn = opts.transIn ?? 0;
  if (tIn > 0.01) {
    const span = perWord * Math.max(0, total - 1) + 0.34;
    const raw = t - item.start;
    local = raw < tIn ? (raw / tIn) * span + 0.07 : span + (raw - tIn) + 0.07;
  }

  const settled = !!s.settled;
  const inFade = clamp01(local / 0.22);
  const outFade = opts.holdOut ? 1 : clamp01((item.end - t) / 0.28);
  const groupAlpha = settled || opts.plain ? 1 : Math.min(inFade, outFade);



  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  // Caption plate behind the text for the subtitle-style templates.
  if (tpl.box !== "none") {
    ctx.save();
    ctx.globalAlpha = groupAlpha * (tpl.box === "pill" ? 0.62 : 0.5);
    ctx.fillStyle = "rgba(6,7,10,0.92)";
    for (let li = 0; li < lines.length; li++) {
      const l = lines[li]!;
      const y = top + li * lineH;
      const padX = tpl.box === "pill" ? 34 : 0;
      const bw = tpl.box === "pill" ? l.w + padX * 2 : W;
      const bx = tpl.box === "pill" ? (W - bw) / 2 : 0;
      const r = tpl.box === "pill" ? 26 : 0;
      ctx.beginPath();
      ctx.roundRect(bx, y + lineH * 0.1, bw, lineH * 0.86, r);
      ctx.fill();
    }
    ctx.restore();
  }

  const activeWord = Math.floor(clamp01(local / (dur * 0.82)) * total);

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    const y = top + li * lineH + lineH / 2;
    const startX = (W - line.w) / 2;

    for (const word of line.words) {
      const appear = word.i * perWord;
      const p = clamp01((local - appear) / 0.34);
      if (p <= 0 && tpl.anim !== "karaoke" && tpl.anim !== "type") continue;

      let alpha = groupAlpha;
      let dx = 0;
      let dy = 0;
      let scale = 1;
      let color = tpl.palette.text;

      if (tpl.anim === "wordPop") {
        scale = 0.72 + easeBack(p) * 0.28;
        alpha *= easeOut(p * 1.6);
        if (word.i === activeWord) color = s.accent;
      } else if (tpl.anim === "karaoke") {
        const done = word.i <= activeWord;
        alpha *= done ? 1 : 0.42;
        color = done && word.i === activeWord ? s.accent : tpl.palette.text;
        scale = word.i === activeWord ? 1.06 + s.level * 0.05 : 1;
      } else if (tpl.anim === "slideUp") {
        dy = (1 - easeOut(p)) * lineH * 0.55;
        alpha *= easeOut(p);
      } else if (tpl.anim === "fade") {
        alpha *= easeOut(p);
        dx = (1 - easeOut(p)) * 26;
      } else if (tpl.anim === "type") {
        color = tpl.palette.text;
      }

      const wx = startX + word.x + word.w / 2 + dx;
      const wy = y + dy;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(wx, wy);
      ctx.scale(scale, scale);
      ctx.font = fontString(tpl, size);
      ctx.letterSpacing = `${tpl.letter}px`;
      ctx.textAlign = "center";

      if (tpl.anim === "type") {
        // Reveal character by character across the whole block.
        const chars = Math.floor(clamp01(local / (dur * 0.7)) * countChars(lines));
        const before = charsBefore(lines, word.i);
        const visible = Math.max(0, Math.min(word.text.length, chars - before));
        if (visible <= 0) {
          ctx.restore();
          continue;
        }
        const shown = word.text.slice(0, visible);
        const wFull = ctx.measureText(word.text).width;
        ctx.textAlign = "left";
        ctx.fillStyle = color;
        ctx.fillText(shown, -wFull / 2, 0);
        if (visible < word.text.length) {
          ctx.fillStyle = s.accent;
          ctx.fillRect(-wFull / 2 + ctx.measureText(shown).width + 6, -size * 0.42, 6, size * 0.84);
        }
        ctx.restore();
        continue;
      }

      if (tpl.backdrop !== "paper") {
        ctx.shadowColor = "rgba(0,0,0,0.55)";
        ctx.shadowBlur = 26;
        ctx.shadowOffsetY = 6;
      }
      ctx.fillStyle = color;
      ctx.fillText(word.text, 0, 0);
      ctx.restore();
    }
  }
}

const countChars = (lines: Line[]) => lines.reduce((n, l) => n + l.words.reduce((m, w) => m + w.text.length, 0), 0);
function charsBefore(lines: Line[], index: number) {
  let n = 0;
  for (const l of lines) for (const w of l.words) if (w.i < index) n += w.text.length;
  return n;
}

// ── chrome ───────────────────────────────────────────────────────────────────
function drawChrome(ctx: CanvasRenderingContext2D, s: ReelState, t: number, total: number) {
  const tpl = s.template;

  if (tpl.box === "bar") {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, 230);
    ctx.fillRect(0, H - 230, W, 230);
  }

  if (s.badge.trim()) {
    ctx.save();
    ctx.font = `800 40px Inter, system-ui, sans-serif`;
    ctx.letterSpacing = "2px";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = s.badge.toUpperCase();
    const w = ctx.measureText(label).width + 64;
    const y = tpl.box === "bar" ? 300 : 200;
    ctx.globalAlpha = clamp01(t / 0.5);
    ctx.fillStyle = s.accent;
    ctx.beginPath();
    ctx.roundRect((W - w) / 2, y - 34, w, 68, 34);
    ctx.fill();
    ctx.fillStyle = "#0a0a0c";
    ctx.fillText(label, W / 2, y + 2);
    ctx.restore();
  }

  if (s.handle.trim()) {
    ctx.save();
    ctx.font = `600 36px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = tpl.palette.text;
    ctx.fillText(s.handle.startsWith("@") ? s.handle : `@${s.handle}`, W / 2, H - (tpl.box === "bar" ? 300 : 150));
    ctx.restore();
  }

  if (s.showProgress && total > 0) {
    const y = H - 54;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.roundRect(70, y, W - 140, 10, 5);
    ctx.fill();
    ctx.fillStyle = s.accent;
    ctx.beginPath();
    ctx.roundRect(70, y, (W - 140) * clamp01(t / total), 10, 5);
    ctx.fill();
  }
}

// ── transitions ──────────────────────────────────────────────────────────────
// Captions are painted onto an offscreen 1080×1920 layer so an outgoing and an
// incoming line can be composited against each other with a real transition
// instead of a plain fade. The backdrop stays continuous underneath, which is
// what keeps the reel feeling like one shot rather than a slideshow.

let layers: [HTMLCanvasElement, HTMLCanvasElement] | null = null;
function layer(i: 0 | 1) {
  if (!layers) {
    const mk = () => {
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      return c;
    };
    layers = [mk(), mk()];
  }
  const c = layers[i];
  const ctx = c.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, W, H);
  return { c, ctx };
}

/** How long the cut between two scenes lasts, capped by the shorter scene. */
function transDur(kind: TransitionId, a: Timed, b: Timed) {
  if (kind === "cut") return 0;
  const base = kind === "flash" || kind === "glitch" ? 0.26 : kind === "whip" || kind === "punch" ? 0.34 : 0.42;
  return Math.min(base, (a.end - a.start) * 0.5, (b.end - b.start) * 0.5);
}

function resolve(scene: Scene | undefined, tpl: Template): Exclude<TransitionId, "auto"> {
  const t = scene?.trans ?? "auto";
  return t === "auto" ? tpl.transition : t;
}

type Slot = { canvas: HTMLCanvasElement; p: number; dir: "out" | "in" };

function place(ctx: CanvasRenderingContext2D, kind: TransitionId, slot: Slot, accent: string) {
  const { canvas, p, dir } = slot;
  const e = easeInOut(p);
  ctx.save();
  switch (kind) {
    case "fade":
      ctx.globalAlpha = dir === "in" ? e : 1 - e;
      ctx.drawImage(canvas, 0, 0);
      break;
    case "slideUp": {
      const off = dir === "in" ? (1 - e) * H * 0.42 : -e * H * 0.42;
      ctx.globalAlpha = dir === "in" ? Math.min(1, e * 1.6) : 1 - e;
      ctx.drawImage(canvas, 0, off);
      break;
    }
    case "whip": {
      const off = dir === "in" ? (1 - e) * W * 0.9 : -e * W * 0.9;
      // Smear a few ghosts along the travel path for a motion-blur feel. The
      // smear thins out as the move settles so the final frame stays crisp.
      const travel = dir === "in" ? 1 - e : e;
      const ghosts = 6;
      for (let i = 1; i <= ghosts; i++) {
        ctx.globalAlpha = 0.16 * travel;
        ctx.drawImage(canvas, off + (dir === "in" ? 1 : -1) * i * 30 * travel, 0);
      }
      ctx.globalAlpha = dir === "in" ? Math.min(1, e * 1.5) : 1 - e;
      ctx.drawImage(canvas, off, 0);
      break;
    }
    case "punch": {
      const s = dir === "in" ? 0.82 + easeBack(p) * 0.18 : 1 + e * 0.35;
      ctx.globalAlpha = dir === "in" ? Math.min(1, p * 2.2) : 1 - e;
      ctx.translate(W / 2, H / 2);
      ctx.scale(s, s);
      ctx.drawImage(canvas, -W / 2, -H / 2);
      break;
    }
    case "flash": {
      ctx.globalAlpha = dir === "in" ? clamp01((p - 0.45) / 0.55) : 1 - clamp01(p / 0.5);
      ctx.drawImage(canvas, 0, 0);
      break;
    }
    case "glitch": {
      const jitter = (1 - e) * 26;
      ctx.globalAlpha = (dir === "in" ? Math.min(1, p * 2) : 1 - e) * 0.55;
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(canvas, -jitter, Math.sin(p * 40) * 6);
      ctx.drawImage(canvas, jitter, -Math.sin(p * 33) * 6);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = dir === "in" ? e : 1 - e;
      ctx.drawImage(canvas, (noise(p, dir === "in" ? 1 : 2) - 0.5) * jitter, 0);
      break;
    }
    case "blinds": {
      const rows = 9;
      const rh = H / rows;
      for (let i = 0; i < rows; i++) {
        // Outgoing rows leave in the opposite order so the two never sit in
        // exactly the same band at the same time.
        const stagger = dir === "in" ? i / rows : (rows - 1 - i) / rows;
        const local = clamp01((p - stagger * 0.35) / 0.65);
        const k = dir === "in" ? easeOut(local) : 1 - easeOut(local);
        if (k <= 0.001) continue;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, i * rh + (rh * (1 - k)) / 2, W, rh * k);
        ctx.clip();
        ctx.drawImage(canvas, 0, 0);
        ctx.restore();
      }
      break;
    }
    case "clock": {
      const a0 = -Math.PI / 2;
      const sweep = e * Math.PI * 2;
      const R = Math.hypot(W, H);
      // The incoming layer owns the swept wedge; the outgoing keeps the rest.
      const from = dir === "in" ? a0 : a0 + sweep;
      const to = dir === "in" ? a0 + sweep : a0 + Math.PI * 2;
      if (to - from <= 0.001) break;
      ctx.beginPath();
      ctx.moveTo(W / 2, H / 2);
      ctx.arc(W / 2, H / 2, R, from, to);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(canvas, 0, 0);
      break;
    }
    case "swipe": {
      const edge = e * H;
      // Incoming fills from the bottom edge up, outgoing keeps what's left.
      if (dir === "in") {
        ctx.beginPath();
        ctx.rect(0, H - edge, W, edge);
      } else {
        ctx.beginPath();
        ctx.rect(0, 0, W, H - edge);
      }
      ctx.clip();
      ctx.drawImage(canvas, 0, 0);
      if (dir === "in" && p < 0.98) {
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(0, H - edge, W, 14);
      }
      break;
    }
    default:
      ctx.drawImage(canvas, 0, 0);
  }
  ctx.restore();
}


/** Full-frame accents that sell the cut (light burst, tape tear, shake). */
function transitionOverlay(ctx: CanvasRenderingContext2D, kind: TransitionId, p: number, accent: string) {
  if (kind === "flash") {
    ctx.save();
    ctx.globalAlpha = Math.sin(clamp01(p) * Math.PI) * 0.85;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  } else if (kind === "glitch") {
    ctx.save();
    const q = Math.round(clamp01(p) * 24); // quantised so tears hold for a frame or two
    for (let i = 0; i < 7; i++) {
      const y = noise(q, i) * H;
      const h = 6 + noise(q, i + 40) * 26;
      ctx.globalAlpha = (0.18 + noise(q, i + 80) * 0.25) * Math.sin(clamp01(p) * Math.PI);
      ctx.fillStyle = i % 2 ? accent : "#00e5ff";
      ctx.fillRect(0, y, W, h);
    }
    ctx.restore();

  } else if (kind === "whip") {
    ctx.save();
    ctx.globalAlpha = Math.sin(clamp01(p) * Math.PI) * 0.35;
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, "transparent");
    g.addColorStop(0.5, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

/** Paints one full frame at time `t` (seconds). */
export function drawFrame(ctx: CanvasRenderingContext2D, s: ReelState, t: number) {
  const { items, total } = timeline(s.scenes);
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  drawBackdrop(ctx, s, t);

  const idx = items.findIndex((x) => t >= x.start && t < x.end);
  const i = idx >= 0 ? idx : t >= total ? items.length - 1 : 0;
  const item = items[i];

  if (item) {
    const prev = i > 0 ? items[i - 1] : undefined;
    const kind = resolve(item, s.template);
    const dur = prev ? transDur(kind, prev, item) : 0;
    const p = dur > 0 ? clamp01((t - item.start) / dur) : 1;

    // If the following scene cuts with a real transition, this caption must not
    // fade itself out first — otherwise the cut blends two ghosts.
    const next = items[i + 1];
    const nextDur = next ? transDur(resolve(next, s.template), item, next) : 0;

    const inTrans = Boolean(prev) && p < 1;
    const cur = layer(0);
    drawCaption(cur.ctx, s, item, Math.min(t, item.end - 0.001), {
      plain: inTrans,
      transIn: dur,
      holdOut: nextDur > 0.01,
    });

    if (prev && p < 1) {
      const old = layer(1);
      const prevPrev = i > 1 ? items[i - 2] : undefined;
      const prevDur = prevPrev ? transDur(resolve(prev, s.template), prevPrev, prev) : 0;
      drawCaption(old.ctx, s, prev, prev.end - 0.001, { plain: true, transIn: prevDur, holdOut: true });

      // A short kick on the punchier cuts, applied to both layers so they move
      // together as one camera rather than two sliding cards.
      const kick = (kind === "punch" || kind === "whip" || kind === "glitch") ? Math.sin(p * Math.PI) : 0;
      ctx.save();
      if (kick > 0) {
        ctx.translate((noise(Math.round(p * 30), 3) - 0.5) * 18 * kick, (noise(Math.round(p * 30), 7) - 0.5) * 14 * kick);
      }
      place(ctx, kind, { canvas: old.c, p, dir: "out" }, s.accent);
      place(ctx, kind, { canvas: cur.c, p, dir: "in" }, s.accent);
      ctx.restore();
      transitionOverlay(ctx, kind, p, s.accent);
    } else {
      ctx.drawImage(cur.c, 0, 0);

    }
  }

  drawChrome(ctx, s, t, total);
  ctx.restore();
}
