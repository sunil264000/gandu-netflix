// Automatic poster lookup: derives a clean movie/show title from a release
// filename, searches public artwork providers, and stores the best match in
// the thumbnails bucket. Server-only.

const NOISE = new Set([
  "1080p", "2160p", "720p", "480p", "4k", "uhd", "hd", "sd", "fhd",
  "web", "webdl", "web-dl", "webrip", "hdrip", "dvdrip", "bdrip", "brrip",
  "bluray", "blu-ray", "remux", "hdtv", "hdcam", "camrip", "predvd",
  "x264", "x265", "h264", "h265", "avc", "hevc", "10bit", "8bit", "hdr", "sdr", "dv",
  "aac", "aac2", "ac3", "eac3", "ddp5", "ddp", "dd5", "dts", "truehd", "atmos", "5", "1", "2",
  "esub", "esubs", "msub", "msubs", "subs", "sub", "dual", "audio", "org",
  "hindi", "english", "tamil", "telugu", "kannada", "malayalam", "punjabi", "urdu",
  "multi", "untouched", "proper", "repack", "extended", "uncut", "unrated",
  "netflix", "nf", "amzn", "zee5", "hotstar", "sonyliv", "jio", "mx", "ds4k",
  "complete", "season", "s01", "s02", "www", "com", "in", "me", "gb", "mb",
]);

export type ParsedTitle = { title: string; year: number | null; episode: string | null };

export function parseTitleFromName(raw: string): ParsedTitle {
  let s = raw.replace(/\.[a-z0-9]{2,4}$/i, "");
  // Tracker/site stamps: "www.Site.party - ", "[1TamilMV.com]", "Site.io_"
  // Only strip a leading site stamp when it is unmistakable: bracketed, or
  // www-prefixed, or using a tracker TLD. Bare ".in"/".me" would eat real
  // titles like "Made.In.India".
  const TLD = "com|net|org|io|to|tv|cc|ws|party|site|link|life|pro|xyz|club|online|day|unblockit|ag";
  s = s.replace(new RegExp(`^\\s*[[({]\\s*(?:www\\.)?[a-z0-9-]+\\.[a-z]{2,10}\\s*[\\])}]\\s*[-_.:|]*\\s*`, "i"), "");
  s = s.replace(new RegExp(`^\\s*(?:www\\.[a-z0-9-]+\\.[a-z]{2,10}|[a-z0-9-]+\\.(?:${TLD}))\\b\\s*[-_.:|]*\\s*`, "i"), "");


  s = s.replace(/[[\]{}()]/g, " ").replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();

  const ep = s.match(/\bS(\d{1,2})\s?E(\d{1,3})\b/i);
  const episode = ep ? `S${ep[1]!.padStart(2, "0")}E${ep[2]!.padStart(2, "0")}` : null;

  const yearMatch = s.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;

  const words = s.split(" ");
  const kept: string[] = [];
  // Words that are noise inside a release tag but also perfectly normal words
  // in a real title ("Made In India", "The Devil's Advocate 2"). They only end
  // the title once some real words have been collected AND a hard tag follows,
  // so they are simply skipped from the "stop" test here.
  const AMBIGUOUS = new Set(["in", "me", "org", "com", "www", "1", "2", "5", "dual", "audio", "multi", "complete", "season", "dv", "mx", "hd", "sd"]);
  for (const w of words) {
    const clean = w.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!clean) continue;
    if (/^(19\d{2}|20\d{2})$/.test(clean)) break;
    if (/^s\d{1,2}(e\d{1,3})?$/.test(clean)) break;
    if (NOISE.has(clean) && !AMBIGUOUS.has(clean)) break;
    if (/^\d+(\.\d+)?(gb|mb)$/.test(clean)) break;

    kept.push(w);
    if (kept.length >= 10) break;
  }

  // Drop trailing junk that survived because it can be a real word ("... Dual",
  // "... V2", "... Multi").
  while (kept.length > 1) {
    const last = kept[kept.length - 1]!.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (AMBIGUOUS.has(last) || /^v\d$/.test(last) || !last) kept.pop();
    else break;
  }

  const title = (kept.join(" ") || s).replace(/[-–—:]+$/g, "").trim();

  return { title, year, episode };
}

const SMALL_WORDS = new Set([
  "and", "or", "of", "in", "on", "at", "to", "for", "from", "with", "vs", "de", "ka", "ki", "ke",
]);

/** Title-cases a cleaned title, keeping ALL-CAPS acronyms and roman numerals. */
function titleCase(s: string) {
  const words = s.split(/\s+/).filter(Boolean);
  return words
    .map((w, i) => {
      const bare = w.replace(/[^A-Za-z0-9']/g, "");
      if (/^(?:[IVXLC]+)$/.test(bare) && bare.length > 1) return w.toUpperCase();
      if (/^[A-Z0-9]{2,4}$/.test(bare) && !/[a-z]/.test(bare)) return w;
      const lower = w.toLowerCase();
      if (i > 0 && i < words.length - 1 && SMALL_WORDS.has(lower.replace(/[^a-z]/g, ""))) return lower;
      return lower.replace(/^[a-z]/, (c) => c.toUpperCase()).replace(/(['-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
    })
    .join(" ");
}

/**
 * Human-friendly display title from a release filename:
 * "www.Site.com - Movie.Name.2024.1080p.WEB-DL.DDP5.1.x264-Grp.mkv"
 *   -> "Movie Name (2024)"
 * Series keep their episode marker: "Show Name (2023) S01E04".
 */
export function prettyTitle(raw: string): string {
  const parsed = parseTitleFromName(raw);
  let base = titleCase(parsed.title.replace(/\s{2,}/g, " ").trim());
  if (!base || base.length < 2) base = raw.replace(/\.[a-z0-9]{2,4}$/i, "").trim();
  const year = parsed.year ? ` (${parsed.year})` : "";
  const ep = parsed.episode ? ` ${parsed.episode}` : "";
  return `${base}${year}${ep}`.trim().slice(0, 200);
}

/** True when a title still looks like a raw release name worth rewriting. */
export function looksLikeReleaseName(title: string): boolean {
  const t = title.toLowerCase();
  if (/\.(mkv|mp4|avi|m4v|mov|ts|webm)$/i.test(title)) return true;
  if (/[._]{1,}/.test(title) && /\s/.test(title) === false) return true;
  return /\b(web[- ]?dl|webrip|bluray|blu-ray|bdrip|hdrip|hdtv|remux|x264|x265|h\.?264|h\.?265|hevc|avc|ddp?5[\s.]?1|dd5[\s.]?1|aac2?[\s.]?0|ac3|eac3|dts(-hd)?|truehd|atmos|10bit|hdr10?|amzn|nf|netflix|hotstar|zee5|sonyliv|esubs?|msubs?|2160p|1080p|720p|480p|ds4k|dual audio|multi audio|proper|repack)\b/i.test(t);
}


type Candidate = { url: string; source: string; score: number };

/**
 * Reads the real pixel size straight out of the image header (first 64 KB) so
 * we can reject anything that isn't a wide still. Providers lie about crops,
 * measuring is the only reliable filter.
 */
async function imageSize(url: string): Promise<{ w: number; h: number } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { range: "bytes=0-65535", accept: "image/*" } });
    if (!res.ok) return null;
    const b = new Uint8Array(await res.arrayBuffer());

    // PNG: IHDR is always the first chunk.
    if (b[0] === 0x89 && b[1] === 0x50) {
      const dv = new DataView(b.buffer, b.byteOffset);
      return { w: dv.getUint32(16), h: dv.getUint32(20) };
    }
    // JPEG: walk the marker chain to the frame header.
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1]!;
        const len = (b[i + 2]! << 8) | b[i + 3]!;
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: (b[i + 5]! << 8) | b[i + 6]!, w: (b[i + 7]! << 8) | b[i + 8]! };
        }
        i += 2 + len;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** A card image must be a genuine wide still — never a portrait poster. */
const WIDE_MIN = 1.55;
const MIN_WIDTH = 780;

async function isWideEnough(url: string): Promise<boolean> {
  const size = await imageSize(url);
  if (!size || !size.w || !size.h) return false;
  return size.w / size.h >= WIDE_MIN && size.w >= MIN_WIDTH;
}


async function j(url: string, timeoutMs = 7000): Promise<any | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * TMDB API (used when a TMDB_API_KEY secret exists) — best quality metadata.
 * Pulls the full backdrop gallery and picks the highest-rated true 16:9 still
 * at original resolution, so cards never get a cropped portrait poster.
 */
async function tmdbLookup(p: ParsedTitle): Promise<Candidate[]> {
  const key = process.env["TMDB_API_KEY"];
  if (!key) return [];
  const q = encodeURIComponent(p.title);
  const yr = p.year ? `&year=${p.year}` : "";
  const data = await j(`https://api.themoviedb.org/3/search/multi?api_key=${key}&query=${q}${yr}&include_adult=false`);
  const hit = (data?.results ?? []).find((r: any) => r.poster_path || r.backdrop_path);
  if (!hit) return [];

  const kind = hit.media_type === "tv" || hit.first_air_date ? "tv" : "movie";
  const images = await j(
    `https://api.themoviedb.org/3/${kind}/${hit.id}/images?api_key=${key}&include_image_language=en,null`,
  );
  const wide: any[] = (images?.backdrops ?? [])
    .filter((b: any) => typeof b.aspect_ratio === "number" && b.aspect_ratio >= 1.7 && b.width >= 1280)
    .sort((a: any, b: any) => b.width - a.width || b.vote_average - a.vote_average);

  const out: Candidate[] = wide
    .slice(0, 5)
    .map((b) => ({ url: `https://image.tmdb.org/t/p/original${b.file_path}`, source: "tmdb:backdrop", score: 5 }));
  if (hit.backdrop_path) {
    out.push({ url: `https://image.tmdb.org/t/p/original${hit.backdrop_path}`, source: "tmdb:backdrop", score: 4 });
  }
  // Portrait posters are deliberately not offered — cards are 16:9 only.
  return out;
}



const SCRAPE_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
  accept: "text/html",
};

async function html(url: string, timeoutMs = 8000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: SCRAPE_HEADERS });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TMDB public pages — keyless. The backdrops gallery is the goldmine: every
 * still there is a true wide frame, uploaded at source resolution.
 */
async function tmdbScrapeLookup(p: ParsedTitle): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const queries = [p.year ? `${p.title} y:${p.year}` : p.title, p.title];
  for (const query of queries) {
    const page = await html(`https://www.themoviedb.org/search?query=${encodeURIComponent(query)}`);
    if (!page) continue;

    const link = page.match(/href="(\/(?:movie|tv)\/\d+[^"?#]*)"/);
    if (!link?.[1]) continue;
    const base = link[1].split("?")[0];

    const gallery = await html(`https://www.themoviedb.org${base}/images/backdrops`);
    if (gallery) {
      const files = [...gallery.matchAll(/image\.tmdb\.org\/t\/p\/(?:original|w\d+(?:_and_h\d+)?[a-z_0-9]*)\/([A-Za-z0-9]+\.(?:jpg|png))/g)]
        .map((m) => m[1]!)
        .filter((f, i, a) => a.indexOf(f) === i)
        .slice(0, 6);
      for (const f of files) {
        out.push({ url: `https://image.tmdb.org/t/p/original/${f}`, source: "tmdb:backdrop", score: 5 });
      }
    }

    const detail = await html(`https://www.themoviedb.org${base}`);
    if (detail) {
      const wide =
        detail.match(/\/t\/p\/w\d+_and_h\d+(?:_multi_faces|_face|_bestv2)?\/([A-Za-z0-9]+\.(?:jpg|png))"?[^>]*class="[^"]*backdrop/)?.[1] ??
        detail.match(/image\.tmdb\.org\/t\/p\/w1920_and_h800_multi_faces\/([A-Za-z0-9]+\.(?:jpg|png))/)?.[1];
      if (wide) out.push({ url: `https://image.tmdb.org/t/p/original/${wide}`, source: "tmdb:backdrop", score: 4 });
    }
    if (out.length) break;
  }
  return out;
}

/**
 * iTunes ships square cover art — only usable when Apple actually stores a
 * wide still, which the measurement pass decides.
 */
async function itunesLookup(p: ParsedTitle): Promise<Candidate[]> {
  const q = encodeURIComponent(p.title);
  const out: Candidate[] = [];
  for (const country of ["IN", "US"]) {
    const data = await j(
      `https://itunes.apple.com/search?term=${q}&media=movie&entity=movie&limit=8&country=${country}`,
    );
    const results: any[] = data?.results ?? [];
    if (!results.length) continue;
    let best = results[0];
    if (p.year) {
      const sameYear = results.find((r) => String(r.releaseDate ?? "").startsWith(String(p.year)));
      if (sameYear) best = sameYear;
    }
    const art: string | undefined = best?.artworkUrl100;
    if (!art) continue;
    out.push({
      url: art.replace(/\/\d+x\d+bb\.(jpg|png)$/, "/2000x1125bb.jpg"),
      source: `itunes:${country}`,
      score: 2,
    });
  }
  return out;
}

/** Wikipedia page image — last resort, usually portrait so rarely survives. */
async function wikipediaLookup(p: ParsedTitle): Promise<Candidate[]> {
  const q = encodeURIComponent(p.year ? `${p.title} ${p.year} film` : `${p.title} film`);
  const search = await j(
    `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=1&gsrsearch=${q}&prop=pageimages&piprop=original&pithumbsize=1600`,
  );
  const pages = search?.query?.pages;
  if (!pages) return [];
  const out: Candidate[] = [];
  for (const key of Object.keys(pages)) {
    const url = pages[key]?.original?.source ?? pages[key]?.thumbnail?.source;
    if (typeof url === "string" && /\.(jpe?g|png)$/i.test(url)) out.push({ url, source: "wikipedia", score: 1 });
  }
  return out;
}

export async function findPosterUrl(filenameOrTitle: string): Promise<{ url: string; source: string; query: string } | null> {
  const parsed = parseTitleFromName(filenameOrTitle);
  if (!parsed.title || parsed.title.length < 2) return null;

  const providers = [tmdbLookup, tmdbScrapeLookup, itunesLookup, wikipediaLookup];
  for (const provider of providers) {
    let hits: Candidate[] = [];
    try {
      hits = await provider(parsed);
    } catch {
      continue;
    }
    hits.sort((a, b) => b.score - a.score);
    for (const hit of hits) {
      // Measure before accepting: only a genuine wide, high-resolution still
      // may become a card image. Anything portrait/square is discarded, and
      // the video's own 16:9 frame-grab stays instead.
      if (await isWideEnough(hit.url)) {
        return { url: hit.url, source: hit.source, query: parsed.title };
      }
    }
  }
  return null;
}


/** Downloads the artwork and stores it in the thumbnails bucket. */
export async function saveRemotePoster(
  sb: any,
  videoId: string,
  imageUrl: string,
): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(imageUrl, { signal: ctrl.signal });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/jpeg";
    if (!type.startsWith("image/")) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 2000) return null;
    const ext = type.includes("png") ? "png" : "jpg";
    const path = `auto/${videoId}.${ext}`;
    const { error } = await sb.storage.from("thumbnails").upload(path, new Blob([buf], { type }), {
      upsert: true,
      contentType: type,
      cacheControl: "31536000",
    });
    if (error) return null;
    const { error: updErr } = await sb.from("videos").update({ thumbnail_path: path }).eq("id", videoId);
    if (updErr) return null;
    return path;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function autoPoster(sb: any, videoId: string, filenameOrTitle: string) {
  const found = await findPosterUrl(filenameOrTitle);
  if (!found) return { ok: false as const, reason: "no_match" };
  const path = await saveRemotePoster(sb, videoId, found.url);
  if (!path) return { ok: false as const, reason: "download_failed" };
  return { ok: true as const, path, source: found.source, query: found.query };
}
