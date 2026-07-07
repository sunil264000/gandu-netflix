// ============================================================
// Lovable Infinity — hardened client core
// ------------------------------------------------------------
// Every network call:
//   1) collects a hardware fingerprint (cached)
//   2) signs the request with HMAC-SHA256 using a device-scoped
//      secret received on activation
//   3) attaches a short-lived JWT (auto-refreshes every 4 min)
//   4) verifies integrity of core files before booting
//   5) polls /heartbeat every 60s; server-side kill switch wipes
//      state immediately
// ============================================================

const API_BASE = "__API_BASE__"; // replaced at build time
const EXT_VERSION = "2.0.0";
const HEARTBEAT_MS = 60_000;
const TOKEN_TTL_MS = 5 * 60_000;
const TOKEN_REFRESH_MS = 4 * 60_000;

// ---------- storage helpers ----------
const S = {
  get: (k) => new Promise((r) => chrome.storage.local.get(k, (v) => r(v[k]))),
  set: (o) => new Promise((r) => chrome.storage.local.set(o, r)),
  clear: () => new Promise((r) => chrome.storage.local.clear(r)),
};

// ---------- crypto (Web Crypto — same primitives server verifies) ----------
const enc = new TextEncoder();
function b64url(bytes) {
  let s = "";
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function importKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
async function hmac(secret, data) {
  const k = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(data));
  return b64url(sig);
}
async function sha256Hex(str) {
  const h = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return Array.from(new Uint8Array(h)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function nonce() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ---------- hardware fingerprint (persisted after first collect) ----------
async function collectFingerprint() {
  const cached = await S.get("fp");
  if (cached) return cached;
  const parts = [
    navigator.userAgent,
    navigator.language,
    navigator.languages?.join(",") ?? "",
    navigator.hardwareConcurrency ?? "",
    navigator.deviceMemory ?? "",
    screen.width + "x" + screen.height + "x" + screen.colorDepth,
    new Date().getTimezoneOffset(),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ];
  try {
    const canvas = new OffscreenCanvas(200, 50);
    const ctx = canvas.getContext("2d");
    ctx.textBaseline = "top";
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = "#f60";
    ctx.fillRect(0, 0, 200, 50);
    ctx.fillStyle = "#069";
    ctx.fillText("lovable-inf-fp", 2, 2);
    const blob = await canvas.convertToBlob();
    const buf = await blob.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", buf);
    parts.push(b64url(hash));
  } catch { parts.push("nocanvas"); }
  const fp = await sha256Hex(parts.join("|"));
  await S.set({ fp });
  return fp;
}

// ---------- integrity self-check ----------
async function selfIntegrityOk() {
  // Fetch our own background script and hash it. If a hash manifest is baked in
  // (window.__INTEGRITY__ replaced at build time), compare. Otherwise pass —
  // build script fills this in.
  try {
    const expected = "__INTEGRITY_BG__";
    if (!expected || expected.startsWith("__")) return true;
    const src = await (await fetch(chrome.runtime.getURL("background.js"))).text();
    const actual = await sha256Hex(src);
    return actual === expected;
  } catch { return false; }
}

// ---------- signed request ----------
async function signedFetch(path, body) {
  const secret = await S.get("hmac");
  if (!secret) throw new Error("not_activated");
  const bodyStr = body ? JSON.stringify(body) : "";
  const ts = Date.now();
  const n = nonce();
  const bodyHash = await sha256Hex(bodyStr);
  const payload = `${ts}.${n}.POST.${path}.${bodyHash}`;
  const sig = await hmac(secret, payload);
  const jwt = await S.get("jwt");
  const deviceId = await S.get("device_id");
  const headers = {
    "content-type": "application/json",
    "x-ts": String(ts),
    "x-nonce": n,
    "x-sig": sig,
    "x-device-id": deviceId ?? "",
    "x-ext-version": EXT_VERSION,
  };
  if (jwt) headers["x-jwt"] = jwt;
  const r = await fetch(API_BASE + path, { method: "POST", headers, body: bodyStr });
  return r.json();
}

// ---------- activation ----------
async function activate(licenseKey) {
  const fp = await collectFingerprint();
  const r = await fetch(API_BASE + "/api/public/ext/activate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      license_key: licenseKey, fingerprint: fp,
      ua: navigator.userAgent, ext_version: EXT_VERSION,
    }),
  }).then((x) => x.json());
  if (!r.ok) throw new Error(r.error ?? "activation_failed");
  await S.set({
    license_key: licenseKey,
    device_id: r.device_id,
    hmac: r.hmac_secret,
    plan: r.plan,
    credits: r.credits_remaining,
    activated_at: Date.now(),
    expires_at: r.expires_at ? new Date(r.expires_at).getTime() : null,
    duration_seconds: r.duration_seconds ?? 0,
    is_trial: !!r.is_trial,
  });
  await refreshToken();
  return r;
}

// ---------- token refresh ----------
async function refreshToken() {
  try {
    const r = await signedFetch("/api/public/ext/token", {});
    if (r.ok) {
      await S.set({ jwt: r.token, jwt_exp: r.exp });
      return true;
    }
  } catch (e) { console.warn("token refresh failed", e); }
  return false;
}

// ---------- heartbeat ----------
async function heartbeat() {
  const jwt = await S.get("jwt");
  if (!jwt) return;
  try {
    const r = await fetch(API_BASE + "/api/public/ext/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-jwt": jwt, "x-ext-version": EXT_VERSION },
    }).then((x) => x.json());
    if (r.status === "revoked") {
      console.warn("License revoked:", r.reason);
      await S.clear();
      await S.set({ revoked: true, revoke_reason: r.reason });
    } else if (r.status === "ok") {
      await S.set({ credits: r.credits_remaining });
    }
  } catch (e) { console.warn("heartbeat failed", e); }
}

// ---------- exec (called from popup/content) ----------
async function exec(action, input) {
  // Ensure token fresh
  const exp = await S.get("jwt_exp");
  if (!exp || exp * 1000 - Date.now() < 30_000) await refreshToken();
  const r = await signedFetch("/api/public/ext/exec", { action, input });
  if (r.ok) await S.set({ credits: r.credits_remaining });
  return r;
}

// ---------- boot ----------
(async () => {
  if (!(await selfIntegrityOk())) {
    console.error("Integrity check failed. Refusing to boot.");
    await S.set({ tampered: true });
    return;
  }
  chrome.alarms.create("heartbeat", { periodInMinutes: 1 });
  chrome.alarms.create("tokenRefresh", { periodInMinutes: 4 });
})();

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "heartbeat") heartbeat();
  if (a.name === "tokenRefresh") refreshToken();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "activate") sendResponse(await activate(msg.license_key));
      else if (msg.type === "exec") sendResponse(await exec(msg.action, msg.input));
      else if (msg.type === "status") {
        sendResponse({
          activated: !!(await S.get("hmac")),
          revoked: !!(await S.get("revoked")),
          revoke_reason: await S.get("revoke_reason"),
          credits: await S.get("credits"),
          plan: await S.get("plan"),
        });
      } else if (msg.type === "sign_out") { await S.clear(); sendResponse({ ok: true }); }
      else sendResponse({ error: "unknown" });
    } catch (e) { sendResponse({ error: String(e.message ?? e) }); }
  })();
  return true; // async
});

chrome.action.onClicked?.addListener?.((tab) => {
  chrome.sidePanel?.open?.({ tabId: tab.id });
});
