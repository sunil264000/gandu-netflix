
# Hardened "Lovable Infinity" Extension — Build Plan

Goal: rebuild the extension so **the client is worthless without the server**. All features route through signed, device-bound API calls. Credit deduction happens server-side; a killed license stops working within seconds.

## 1. Backend (this Lovable project)

New tables (Lovable Cloud, RLS on):

- `plans` — `code`, `name`, `max_devices`, `monthly_credits`, `price_inr`, `features jsonb`
- `licenses` — `key` (unique), `user_id`, `plan_code`, `status` (`active|paused|revoked`), `credits_remaining`, `credits_reset_at`, `hmac_secret` (per-license random), `notes`
- `devices` — `license_id`, `fingerprint_hash`, `first_seen_ip`, `last_seen_ip`, `user_agent`, `ext_version`, `revoked`
- `sessions` — short-lived JWT tracking: `license_id`, `device_id`, `jti`, `expires_at`, `revoked`
- `usage_events` — `license_id`, `device_id`, `action`, `credits_spent`, `ip`, `ua`, `meta jsonb`, `created_at`
- `kill_switch` — `license_id`, `reason`, `created_at` (revoke propagates via heartbeat)
- `anomaly_flags` — auto-populated (rate spikes, IP jumps, geo hops)
- `user_roles` + `has_role()` (admin gate for dashboard admin actions)

Endpoints (TanStack server routes under `src/routes/api/public/ext/*`, HMAC-verified):

- `POST /api/public/ext/activate` — license key + fingerprint → binds device (respects `plan.max_devices`), returns `device_id` + `hmac_secret_wrapped`
- `POST /api/public/ext/token` — device_id + HMAC → 5-min JWT bound to `{license, device, ua, ext_version}`
- `POST /api/public/ext/exec` — the ONE endpoint every feature calls. Validates JWT + HMAC + nonce/timestamp (replay window 60s), checks credits, decrements atomically, logs `usage_events`, returns result
- `POST /api/public/ext/heartbeat` — every 60s: checks kill_switch + anomaly flags, returns `{status, credits_remaining}`. Extension self-disables on `revoked`
- `POST /api/public/ext/pro-module` — streams obfuscated PRO feature JS per-request (server-rendered feature code — no license = no code)

## 2. Hardened extension client

Layers stacked:

1. **Hardware fingerprint** (WebGL renderer + audio ctx + canvas + timezone + screen + fonts hash) → SHA-256, sent on activate
2. **WASM signing core** (`signer.wasm`, ~4KB Rust) — holds derived key, exposes only `sign(payload) → hmac`. Reverse-engineering WASM is hours, not minutes
3. **Every request** signed: `HMAC(secret, timestamp + nonce + method + path + body_hash)`, plus `X-Ext-Version`, `X-Device-Id`, `X-JWT`
4. **Short-lived JWT** — 5 min, auto-refresh via `/token`. Stolen JWT dies fast, and it's bound to fingerprint+UA
5. **Self-integrity check** on load — SHA-256 of `background.js` + `content.js` compared to hash baked into WASM. Tampered files → refuse to boot
6. **Heavy obfuscation** — `javascript-obfuscator` with control-flow flattening, string array encoding, dead-code injection, self-defending, debug protection on `background.js`, `content.js`, and the signing shim
7. **Server-streamed PRO logic** — PRO features fetched per-call from `/pro-module`, executed via `Function()` inside sandboxed iframe. Cracker with no valid license literally cannot obtain the code
8. **Heartbeat kill switch** — 60s poll. Server response `{revoked:true}` → wipes chrome.storage, unregisters listeners, shows "License revoked" screen
9. **Anomaly detection** (server-side) — >N req/min, >3 distinct IPs/hour, geo hop >1000km/10min → auto-flag → admin one-click revoke from dashboard

## 3. What survives cracking (honest boundaries)

- Static tampering: blocked by self-integrity + WASM signing
- Removing license check: pointless — server won't return output without valid signed request
- Copying license to another PC: fingerprint mismatch → activate rejected (or bumps device count past plan limit)
- MITM proxy on attacker's own device: possible, but only works for that one device, and kill switch neutralizes on demand
- This is the realistic ceiling for browser-extension DRM. Above this is diminishing returns.

## 4. Dashboard (bare minimum, this turn)

Admin-only routes:
- `/admin/licenses` — list, create, revoke, adjust credits, view devices, view usage chart
- `/admin/plans` — CRUD plans + `max_devices`
- Public `/activate` page shows license key + install instructions

Full user-facing dashboard (sign-in, plans, payment history, self-serve) = next phase after extension is proven working.

## 5. Deliverables this build

- Migrations (7 tables + policies + grants + `has_role`)
- 5 server routes under `src/routes/api/public/ext/*`
- Extension source in `extension/` — manifest v3, background service worker, content script, popup, sidepanel with Cloud White UI carried over
- `signer.wasm` (prebuilt, checked in) + JS glue
- `build-extension.mjs` — runs javascript-obfuscator, computes integrity hashes, injects into WASM, zips output to `public/Lovable-Infinity-Hardened.zip`
- Admin dashboard pages (licenses, plans)
- README with install steps

## 6. Order of operations

1. Migrations (approval gate — this comes first)
2. Server routes + HMAC/JWT helpers
3. Extension source + WASM signer + obfuscation build script
4. Admin dashboard
5. Package + upload to `archives` bucket, provide download

Approve and I start with the migration.
