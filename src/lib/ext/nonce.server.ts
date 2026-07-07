// In-memory nonce cache for replay protection.
// Note: Workers are stateless per instance — this catches the common case (same-instance retries).
// The 60s timestamp window is the primary replay defense.
const seen = new Map<string, number>();
const WINDOW_MS = 60_000;

export function checkNonce(nonce: string, ts: number): boolean {
  const now = Date.now();
  if (Math.abs(now - ts) > WINDOW_MS) return false;
  // GC old entries
  if (seen.size > 5000) {
    for (const [k, v] of seen) if (now - v > WINDOW_MS) seen.delete(k);
  }
  if (seen.has(nonce)) return false;
  seen.set(nonce, now);
  return true;
}
