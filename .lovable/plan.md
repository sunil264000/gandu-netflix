
# Private Video Streaming App

Replacing AI Infinity's landing/dashboard/admin/auth with a self-hosted-style video streaming app on Lovable Cloud. The `/extension` folder and its API routes stay untouched.

## Reality check — read this first

You picked "upload from RDP into the website and watch on your PC." That means the videos live in **Lovable Cloud Storage** (a private Supabase bucket), not on your VPS filesystem. A few honest limits of this path vs. the original brief:

- **File size ceiling.** Cloud Storage tops out at **50 GB per file** on the highest tier — 100 GB uploads aren't possible here. 5–50 GB will work.
- **Uploads from RDP will be slow** — bound by your VPS's upload bandwidth to Cloud Storage, not by anything we can optimize in code. A 20 GB file over a 100 Mbit RDP link ≈ 30 min.
- **Playback speed.** Cloud Storage serves files over HTTPS with **HTTP Range Requests natively**, so seeking and progressive playback work like YouTube once the file is uploaded. Playback bandwidth is the storage CDN's, not your VPS's — this is actually *better* than serving from a Windows box.
- **No FFmpeg here** (Cloudflare Worker runtime — no native binaries). Thumbnails are generated **in your browser during upload** by seeking the `<video>` element and drawing to canvas. Free, instant, works for MP4/WebM/MOV. MKV/AVI thumbnails fall back to a generated placeholder (browsers can't decode those in `<video>`).
- **MKV/AVI playback.** Chrome can play some MKV (H.264/H.265 + AAC) directly; pure AVI usually won't play in-browser without transcoding. MP4/WebM/MOV: universal.

If any of that is a dealbreaker, tell me now and we'll rethink (e.g. keep files on your VPS + you run a small Node server there — I'd generate that zip separately).

## What I'll build

### Database (Postgres)
- `videos` — title, description, storage_path, size_bytes, duration_sec, width, height, mime, thumbnail_path, category, created_at
- `watch_history` — user_id, video_id, position_sec, completed, updated_at
- `favorites` — user_id, video_id, created_at
- `categories` — name, slug

RLS scoped to owner (`auth.uid()`). Since you're the sole admin, "owner" = you.

### Storage
- Private bucket `videos` (up to 50 GB/file)
- Private bucket `thumbnails` (public-read policy)
- Signed URLs for playback (1 hr TTL, refreshed by the player)

### Frontend routes (replaces existing pages)
- `/auth` — email + password sign-in (kept; you already have an owner account)
- `/` — Home: hero row, Continue Watching, Recently Added, Favorites, Categories grid
- `/library` — full grid, infinite scroll, sort (newest / A-Z / largest / most watched), filter (extension, resolution, category)
- `/search?q=` — instant search (title + description)
- `/watch/$id` — player page (see below)
- `/admin` — upload (drag & drop, multi-file, resumable via `tus`), rename, delete, change thumbnail, manage categories, storage usage dashboard, view counts

### Video player (`/watch/$id`)
Custom HTML5 player wrapper:
- Signed streaming URL, HTTP Range native
- Adaptive buffering (browser-native)
- Fullscreen, PiP, playback speed 0.25–2×, volume, mute
- Keyboard: Space play/pause, ← → seek 10s, J/L 10s, ↑↓ volume, M mute, F fullscreen, 0-9 jump %
- Skip ±10s buttons
- Resume from last position (writes to `watch_history` every 5 s + on pause)
- Auto-next (next video in same category)
- Up-next sidebar

### Theme
- `#0B0B0B` background, `#FF3B30` accent, 16 px radius
- Glassmorphism cards (`backdrop-blur`, subtle border)
- Framer Motion page transitions, hover scale on cards, skeleton loaders
- Dark by default; light-mode toggle in header
- Responsive down to 375 px

### Access & auth
- HTTPS is automatic (Lovable domain or your custom domain)
- Single admin (you). Sign-in via existing `/auth`. No user management UI.
- The current admin-claim logic stays: first sign-in becomes owner.

## What gets removed
- `src/routes/index.tsx` (AI Infinity landing) → replaced
- `src/routes/dashboard.tsx`, `checkout.$orderId.tsx`, `success.$orderId.tsx` → deleted
- `src/routes/admin.tsx` → replaced with video admin
- Extension licensing tables (`licenses`, `plans`, `orders`, `devices`, `sessions`, `usage_events`, `anomaly_flags`, `kill_switch`, `archives`) → **kept** (extension still uses them)

## Out of scope for v1 (say the word to add)
- Multi-user + roles
- Watch parties / comments
- HLS transcoding (only needed for AVI + weird codecs)
- Mobile native app
- Multi-language i18n (structure ready, only English strings)

## Rollout
One big drop: migration → storage buckets → server functions (upload URL, list, signed stream URL, watch progress) → components (VideoCard, VideoPlayer, UploadDropzone, LibraryGrid) → routes → theming. I'll batch aggressively.

## Confirm before I start

1. **50 GB per-file cap OK?** (vs. the 100 GB in your brief)
2. **Browser thumbnail generation OK?** (vs. server-side FFmpeg — MKV/AVI get a placeholder)
3. **Delete `/dashboard`, `/checkout`, `/success` entirely?** (they're AI Infinity user-facing pages — extension backend keeps working)

Reply "go" + any changes and I'll ship it.
