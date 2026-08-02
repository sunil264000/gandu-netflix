/**
 * Series detection.
 *
 * Titles come from filenames, so episodes of one show arrive as a flat list of
 * unrelated-looking rows ("Made in India A Titan Story S01E04"). We parse the
 * season/episode marker out of the title so the UI can group a folder of
 * episodes into one series card and play them in order.
 */

export type EpisodeInfo = {
  /** Show name with the episode marker stripped. */
  series: string;
  /** Stable grouping key (lowercased, punctuation-free series name). */
  key: string;
  season: number;
  episode: number;
  /** "S01E04" style label for the UI. */
  label: string;
};

const PATTERNS: { re: RegExp; season: number; episode: number }[] = [
  // S01E04 / s1 e4 / S01.E04
  { re: /\bs(?:eason)?\s*(\d{1,2})[\s._-]*(?:e|ep|episode)\s*(\d{1,3})\b/i, season: 1, episode: 2 },
  // 1x04
  { re: /\b(\d{1,2})\s*x\s*(\d{1,3})\b/i, season: 1, episode: 2 },
  // Season 1 Episode 4
  { re: /\bseason\s*(\d{1,2})\b.*?\bepisode\s*(\d{1,3})\b/i, season: 1, episode: 2 },
];

// Episode-only markers (no season) — "Episode 4", "EP04", "Part 3", "Chapter 2"
const EP_ONLY = /\b(?:ep|episode|part|chapter|pt)[\s._-]*(\d{1,3})\b/i;

export function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function cleanName(raw: string): string {
  return raw
    .replace(/[\s._-]+$/g, "")
    .replace(/[-–—:|]+$/g, "")
    .replace(/[\s._]+/g, " ")
    .trim();
}

export function parseEpisode(title: string): EpisodeInfo | null {
  for (const p of PATTERNS) {
    const m = title.match(p.re);
    if (m && m.index !== undefined) {
      const season = Number(m[p.season]);
      const episode = Number(m[p.episode]);
      const series = cleanName(title.slice(0, m.index));
      if (!series || !Number.isFinite(season) || !Number.isFinite(episode)) continue;
      return {
        series,
        key: normalizeKey(series),
        season,
        episode,
        label: `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`,
      };
    }
  }

  const m = title.match(EP_ONLY);
  if (m && m.index !== undefined && m.index > 2) {
    const episode = Number(m[1]);
    const series = cleanName(title.slice(0, m.index));
    if (series && Number.isFinite(episode)) {
      return {
        series,
        key: normalizeKey(series),
        season: 1,
        episode,
        label: `E${String(episode).padStart(2, "0")}`,
      };
    }
  }
  return null;
}

export function compareEpisodes(a: EpisodeInfo, b: EpisodeInfo): number {
  return a.season - b.season || a.episode - b.episode;
}

export type Titled = { id: string; title: string };

export type SeriesGroup<T extends Titled> = {
  kind: "series";
  key: string;
  name: string;
  /** Sorted by season then episode. */
  episodes: (T & { ep: EpisodeInfo })[];
};

export type GroupedItem<T extends Titled> = { kind: "single"; video: T } | SeriesGroup<T>;

/**
 * Collapses episodes of the same show into one entry, preserving the order in
 * which the list arrived (a series takes the slot of its first episode).
 * A show with a single episode stays a normal card.
 */
export function groupBySeries<T extends Titled>(videos: T[]): GroupedItem<T>[] {
  const out: GroupedItem<T>[] = [];
  const index = new Map<string, SeriesGroup<T>>();

  for (const v of videos) {
    const ep = parseEpisode(v.title);
    if (!ep) {
      out.push({ kind: "single", video: v });
      continue;
    }
    let group = index.get(ep.key);
    if (!group) {
      group = { kind: "series", key: ep.key, name: ep.series, episodes: [] };
      index.set(ep.key, group);
      out.push(group);
    }
    group.episodes.push({ ...v, ep });
  }

  for (const g of index.values()) g.episodes.sort((a, b) => compareEpisodes(a.ep, b.ep));

  // Lone episodes read better as plain cards.
  return out.map((item) =>
    item.kind === "series" && item.episodes.length === 1
      ? ({ kind: "single", video: item.episodes[0] } as GroupedItem<T>)
      : item,
  );
}
