# Lovable Infinity — Automated License Flow

## User journey

1. Visit landing → **Sign up / Sign in** (Google + Email)
2. Instant **15-min trial license** appears on dashboard (one-click copy)
3. Paste key into extension → **countdown starts on first activation**, key auto-expires
4. When trial ends → dashboard shows **Buy a plan** with pricing
5. User picks a plan → checkout (stubbed until gateway is chosen) → **new key generated**, shown with copy button
6. Paste → countdown starts on activation → auto-expires when duration hits zero

## Plans (INR, proportionally scaled from ₹150/day → ₹20,000/year)

| Plan       | Duration     | Price     | Effective/day |
| ---------- | ------------ | --------- | ------------- |
| Day Pass   | 1 day        | ₹150      | ₹150          |
| Weekly     | 7 days       | ₹899      | ₹128          |
| Monthly    | 30 days      | ₹2,999    | ₹100          |
| Quarterly  | 90 days      | ₹7,499    | ₹83           |
| Half-year  | 180 days     | ₹12,999   | ₹72           |
| Yearly     | 365 days     | ₹20,000   | ₹55           |

No lifetime plan. Prices editable later from admin.

## Anti-abuse (Maximum)

Trial is issued once per: **account + device fingerprint + IP**. Repeat attempts return the existing trial (or "trial exhausted" if it already expired). Fingerprint = the Canvas + WebGL + OS hash the extension already sends. IP is captured server-side from the trial-issue request.

## Countdown model

- Key row stores `duration_seconds` + nullable `activated_at`.
- **First** `/api/public/ext/activate` from the extension sets `activated_at = now()` atomically. Subsequent activations return the same `expires_at = activated_at + duration_seconds`.
- Server refuses `/exec` and `/token` calls after `expires_at`. Extension shows a live countdown from `expires_at` in the popup and disables features at 0.
- Kill-switch, revocation, and heartbeat rules already in place still apply.

## What I'll build this turn

### Backend (Lovable Cloud)
- Migration: add `plans` seed rows above; add `duration_seconds`, `activated_at`, `is_trial`, `trial_fingerprint`, `trial_ip` to `licenses`; add `orders` table (pending / paid / failed) linked to a plan and future gateway.
- Server fns (`createServerFn`, all `requireSupabaseAuth`):
  - `claimTrial()` — checks account+fp+ip, issues single 15-min trial, returns key
  - `listMyLicenses()` — dashboard listing with live status (trial / active / expired)
  - `listPlans()` — plans for the pricing grid
  - `createOrder({ planId })` — creates a pending order, returns a checkout URL (currently a stub route)
  - `getOrderStatus({ orderId })` — polls for "paid"
- Public route `/api/public/ext/activate` extended to set `activated_at` on first call (atomic via SQL `UPDATE ... WHERE activated_at IS NULL`).
- Stub checkout route `/checkout/$orderId` that immediately marks the order paid + generates the license (so end-to-end flow works today; swap for real gateway later).

### Frontend
- `/` landing — hero, features, pricing preview, CTA to sign up
- `/auth` — already exists; keep
- `/dashboard` (under `_authenticated/`):
  - "Your Trial" card with the key, copy button, live countdown, status pill
  - "My Licenses" table (all past + active keys with countdowns)
  - "Upgrade" grid — 6 plans with Buy button
- `/checkout/$orderId` — stub gateway page with "Confirm payment" button
- `/success/$orderId` — shows generated key with big copy button + install-extension steps
- `/admin` — add plan editor (price + duration), order log

### Extension
- Popup shows a live MM:SS countdown fed by the server's `expires_at`
- On paste-activate: single `/activate` call locks the timer server-side
- At expiry: features disabled, "Buy a plan" deep link to your site

### Payments
- Stubbed for now (you said "will tell later"). Order marked paid instantly on the stub `/checkout` page → key generated the same way real gateway will do via webhook. When you name the gateway (Stripe / Razorpay / Paddle), I'll swap the stub for the real webhook + hosted checkout with no changes to the rest of the flow.

## Out of scope this turn

- Real payment webhook (waiting on gateway choice)
- Email receipts (add after gateway)
- Coupon codes / referrals (say the word)

Approve and I'll ship it.