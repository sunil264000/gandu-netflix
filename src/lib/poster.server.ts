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
  s = s.replace(/^\s*(www\.[^\s._-]+)\s*[-_.]*/i, "");
  s = s.replace(/[[\]{}()]/g, " ").replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();

  const ep = s.match(/\bS(\d{1,2})\s?E(\d{1,3})\b/i);
  const episode = ep ? `S${ep[1]!.padStart(2, "0")}E${ep[2]!.padStart(2, "0")}` : null;

  const yearMatch = s.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;

  const words = s.split(" ");
  const kept: string[] = [];
  for (const w of words) {
    const clean = w.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!clean) continue;
    if (/^(19\d{2}|20\d{2})$/.test(clean)) break;
    if (/^s\d{1,2}(e\d{1,3})?$/.test(clean)) break;
    if (NOISE.has(clean)) break;
    if (/^\d+(gb|mb)$/.test(clean)) break;
    kept.push(w);
    if (kept.length >= 10) break;
  }

  const title = (kept.join(" ") || s).replace(/[-–—:]+$/g, "").trim();
  return { title, year, episode };
}

type Candidate = { url: string; source: string; score: number };

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

/** TMDB (used when a TMDB_API_KEY secret exists) — best quality metadata. */
async function tmdbLookup(p: ParsedTitle): Promise<Candidate | null> {
  const key = process.env["TMDB_API_KEY"];
  if (!key) return null;
  const q = encodeURIComponent(p.title);
  const yr = p.year ? `&year=${p.year}` : "";
  const data = await j(`https://api.themoviedb.org/3/search/multi?api_key=${key}&query=${q}${yr}&include_adult=false`);
  const hit = (data?.results ?? []).find((r: any) => r.poster_path || r.backdrop_path);
  if (!hit) return null;
  const path = hit.backdrop_path ?? hit.poster_path;
  return { url: `https://image.tmdb.org/t/p/w1280${path}`, source: "tmdb", score: 3 };
}

/**
 * TMDB public search page — keyless. We only read the poster path that the
 * page already exposes on its CDN and re-request it at a high resolution.
 */
async function tmdbScrapeLookup(p: ParsedTitle): Promise<Candidate | null> {
  const queries = [p.year ? `${p.title} y:${p.year}` : p.title, p.title];
  for (const query of queries) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`https://www.themoviedb.org/search?query=${encodeURIComponent(query)}`, {
        signal: ctrl.signal,
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36",
          "accept-language": "en-US,en;q=0.9",
          accept: "text/html",
        },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const match = html.match(/\/t\/p\/w\d+_and_h\d+_face\/([A-Za-z0-9]+\.(?:jpg|png))/);
      if (!match) continue;
      return { url: `https://image.tmdb.org/t/p/w780/${match[1]}`, source: "tmdb", score: 3 };
    } catch {
      /* try next query */
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** iTunes Search — keyless, global catalogue incl. Indian cinema. */
async function itunesLookup(p: ParsedTitle): Promise<Candidate | null> {
  const q = encodeURIComponent(p.title);
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
    return { url: art.replace(/\/\d+x\d+bb\.(jpg|png)$/, "/1200x1200bb.jpg"), source: `itunes:${country}`, score: 2 };
  }
  return null;
}

/** Wikipedia page image — decent last-resort for titles iTunes misses. */
async function wikipediaLookup(p: ParsedTitle): Promise<Candidate | null> {
  const q = encodeURIComponent(p.year ? `${p.title} ${p.year} film` : `${p.title} film`);
  const search = await j(
    `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=1&gsrsearch=${q}&prop=pageimages&piprop=original&pithumbsize=1200`,
  );
  const pages = search?.query?.pages;
  if (!pages) return null;
  for (const key of Object.keys(pages)) {
    const url = pages[key]?.original?.source ?? pages[key]?.thumbnail?.source;
    if (typeof url === "string" && /\.(jpe?g|png)$/i.test(url)) {
      return { url, source: "wikipedia", score: 1 };
    }
  }
  return null;
}

export async function findPosterUrl(filenameOrTitle: string): Promise<{ url: string; source: string; query: string } | null> {
  const parsed = parseTitleFromName(filenameOrTitle);
  if (!parsed.title || parsed.title.length < 2) return null;

  const providers = [tmdbLookup, tmdbScrapeLookup, itunesLookup, wikipediaLookup];
  for (const provider of providers) {
    try {
      const hit = await provider(parsed);
      if (hit) return { url: hit.url, source: hit.source, query: parsed.title };
    } catch {
      /* try next provider */
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
