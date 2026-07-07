// Server-only crypto helpers for the hardened extension backend.
// HMAC-SHA256 request signing + compact HS256 JWT using Web Crypto.

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function hmacSign(secret: string, payload: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return b64url(sig);
}

export async function hmacVerify(secret: string, payload: string, sig: string): Promise<boolean> {
  try {
    const key = await hmacKey(secret);
    const sigBytes = b64urlDecode(sig);
    return await crypto.subtle.verify("HMAC", key, sigBytes.buffer.slice(sigBytes.byteOffset, sigBytes.byteOffset + sigBytes.byteLength) as ArrayBuffer, enc.encode(payload));
  } catch {
    return false;
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", enc.encode(input));
  const b = new Uint8Array(h);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Derive a per-license HMAC secret from the master secret + license key.
// This means the DB never stores raw secrets in a way that a leaked DB alone unlocks signing.
export async function deriveLicenseSecret(licenseKey: string): Promise<string> {
  const master = process.env.EXT_MASTER_SECRET;
  if (!master) throw new Error("EXT_MASTER_SECRET not set");
  return await hmacSign(master, `license:${licenseKey}`);
}

// ---------- HS256 JWT ----------
type JwtClaims = {
  sub: string;       // device_id
  lic: string;       // license_id
  fp: string;        // fingerprint hash
  uav: string;       // sha256(ua + ext_version)
  jti: string;
  iat: number;
  exp: number;
};

export async function signJwt(claims: JwtClaims): Promise<string> {
  const secret = process.env.EXT_JWT_SECRET;
  if (!secret) throw new Error("EXT_JWT_SECRET not set");
  const header = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = await hmacSign(secret, `${header}.${body}`);
  return `${header}.${body}.${sig}`;
}

export async function verifyJwt(token: string): Promise<JwtClaims | null> {
  const secret = process.env.EXT_JWT_SECRET;
  if (!secret) throw new Error("EXT_JWT_SECRET not set");
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  if (!(await hmacVerify(secret, `${h}.${b}`, s))) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(b))) as JwtClaims;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

export function randomHex(bytes = 16): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function randomLicenseKey(): string {
  // Format: LIF-XXXX-XXXX-XXXX-XXXX (base32-ish)
  const alph = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  const seg = (i: number) => Array.from(b.slice(i, i + 4)).map((x) => alph[x % 32]).join("");
  return `LIF-${seg(0)}-${seg(4)}-${seg(8)}-${seg(12)}`;
}
