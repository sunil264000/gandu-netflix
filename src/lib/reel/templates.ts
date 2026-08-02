// Reel Studio — template catalogue.
//
// A template is pure data: it decides the backdrop, the type treatment and how
// each caption animates in. The renderer (render.ts) knows how to draw every
// combination, so adding a look here is enough to add it to the studio.

export type Anim = "wordPop" | "karaoke" | "slideUp" | "fade" | "type";
export type Backdrop = "mesh" | "beam" | "split" | "paper" | "noir" | "grid";

/** Scene-to-scene transitions. `auto` follows the template's house style. */
export type TransitionId =
  | "auto"
  | "cut"
  | "fade"
  | "slideUp"
  | "whip"
  | "punch"
  | "flash"
  | "glitch"
  | "blinds"
  | "clock"
  | "swipe";

export const TRANSITIONS: { id: TransitionId; name: string }[] = [
  { id: "auto", name: "Auto" },
  { id: "cut", name: "Hard cut" },
  { id: "fade", name: "Cross fade" },
  { id: "slideUp", name: "Push up" },
  { id: "whip", name: "Whip pan" },
  { id: "punch", name: "Zoom punch" },
  { id: "flash", name: "Flash" },
  { id: "glitch", name: "Glitch" },
  { id: "blinds", name: "Blinds" },
  { id: "clock", name: "Clock wipe" },
  { id: "swipe", name: "Colour swipe" },
];


export type Template = {
  id: string;
  name: string;
  blurb: string;
  backdrop: Backdrop;
  palette: { a: string; b: string; accent: string; text: string; dim: string };
  font: string;
  weight: number;
  /** Base cap height in px on the 1080×1920 canvas. */
  size: number;
  uppercase: boolean;
  letter: number;
  lineGap: number;
  layout: "center" | "bottom" | "top";
  anim: Anim;
  box: "none" | "pill" | "bar";
  /** Dark scrim strength when a photo/clip is used as the background. */
  scrim: number;
};

export const TEMPLATES: Template[] = [
  {
    id: "punch",
    name: "Bold Punch",
    blurb: "Word-by-word slam. Best for hooks and hot takes.",
    backdrop: "noir",
    palette: { a: "#0a0a0c", b: "#161318", accent: "#ff3b30", text: "#ffffff", dim: "#8b8b93" },
    font: "Anton, Impact, sans-serif",
    weight: 400,
    size: 132,
    uppercase: true,
    letter: -1,
    lineGap: 1.02,
    layout: "center",
    anim: "wordPop",
    box: "none",
    scrim: 0.55,
  },
  {
    id: "caption",
    name: "Clean Caption",
    blurb: "Karaoke subtitles over your clip. The classic reel look.",
    backdrop: "grid",
    palette: { a: "#0b0d12", b: "#111826", accent: "#ffd60a", text: "#ffffff", dim: "#c9ccd6" },
    font: "Inter, system-ui, sans-serif",
    weight: 800,
    size: 84,
    uppercase: true,
    letter: 0,
    lineGap: 1.18,
    layout: "bottom",
    anim: "karaoke",
    box: "pill",
    scrim: 0.35,
  },
  {
    id: "editorial",
    name: "Editorial Quote",
    blurb: "Slow serif reveals on a soft gradient. Calm, premium.",
    backdrop: "mesh",
    palette: { a: "#11131a", b: "#2a1f2d", accent: "#e7c98b", text: "#f6f1e8", dim: "#a79c8c" },
    font: "'Playfair Display', Georgia, serif",
    weight: 700,
    size: 96,
    uppercase: false,
    letter: 0,
    lineGap: 1.24,
    layout: "center",
    anim: "fade",
    box: "none",
    scrim: 0.5,
  },
  {
    id: "neon",
    name: "Neon Split",
    blurb: "Split-colour stage with lines sliding up. High energy.",
    backdrop: "split",
    palette: { a: "#160a2b", b: "#06212b", accent: "#3ef2c2", text: "#ffffff", dim: "#9fb3c8" },
    font: "'Space Grotesk', Inter, sans-serif",
    weight: 700,
    size: 100,
    uppercase: false,
    letter: -0.5,
    lineGap: 1.14,
    layout: "center",
    anim: "slideUp",
    box: "none",
    scrim: 0.45,
  },
  {
    id: "paper",
    name: "Retro Paper",
    blurb: "Cream stock, black type, typewriter reveal. Storytime.",
    backdrop: "paper",
    palette: { a: "#efe7d8", b: "#e3d8c3", accent: "#c2410c", text: "#17150f", dim: "#6b6252" },
    font: "'Space Grotesk', Inter, sans-serif",
    weight: 700,
    size: 88,
    uppercase: false,
    letter: -0.5,
    lineGap: 1.2,
    layout: "center",
    anim: "type",
    box: "none",
    scrim: 0.15,
  },
  {
    id: "cinema",
    name: "Cinematic Bars",
    blurb: "Letterboxed, centred, slow push. Trailer energy.",
    backdrop: "beam",
    palette: { a: "#07070a", b: "#131018", accent: "#ef4444", text: "#ffffff", dim: "#9aa0a6" },
    font: "'Bebas Neue', Anton, sans-serif",
    weight: 400,
    size: 118,
    uppercase: true,
    letter: 2,
    lineGap: 1.06,
    layout: "center",
    anim: "slideUp",
    box: "bar",
    scrim: 0.6,
  },
];

export type Scene = { id: string; text: string; dur: number };

const uid = () => Math.random().toString(36).slice(2, 9);

/** Reading-speed estimate: ~2.6 words a second plus a beat to breathe. */
export function sceneDuration(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(7, Math.max(1.6, 0.8 + words / 2.6));
}

/**
 * Turns a pasted block of text into timed scenes. Blank lines and single line
 * breaks are treated as hard cuts; long paragraphs are split on sentences so a
 * caption never overflows the frame.
 */
export function textToScenes(raw: string): Scene[] {
  const blocks = raw
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: Scene[] = [];
  for (const block of blocks) {
    const chunks = block.length <= 90 ? [block] : splitLong(block);
    for (const c of chunks) out.push({ id: uid(), text: c, dur: sceneDuration(c) });
  }
  return out.length ? out : [];
}

function splitLong(block: string): string[] {
  const sentences = block.match(/[^.!?…]+[.!?…]*/g) ?? [block];
  const out: string[] = [];
  let buf = "";
  for (const s of sentences) {
    const next = (buf ? `${buf} ` : "") + s.trim();
    if (next.length > 90 && buf) {
      out.push(buf.trim());
      buf = s.trim();
    } else {
      buf = next;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  // Anything still huge (no punctuation at all) gets chopped on word count.
  return out.flatMap((c) => (c.length <= 120 ? [c] : chopWords(c)));
}

function chopWords(c: string): string[] {
  const words = c.split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 12) out.push(words.slice(i, i + 12).join(" "));
  return out;
}

export const newScene = (text = "New line"): Scene => ({ id: uid(), text, dur: sceneDuration(text) });

/** Rescales every scene so the reel lands exactly on `target` seconds. */
export function fitScenesTo(scenes: Scene[], target: number): Scene[] {
  const total = scenes.reduce((s, x) => s + x.dur, 0);
  if (!total || !target) return scenes;
  const k = target / total;
  return scenes.map((s) => ({ ...s, dur: Math.max(0.6, Math.round(s.dur * k * 100) / 100) }));
}
