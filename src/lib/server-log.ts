// Tiny structured logger for server functions & routes.
// Emits single-line JSON so Cloudflare/Worker logs stay grep-friendly.

export type LogLevel = "info" | "warn" | "error";

export function newRequestId(): string {
  // Short random id; not security-critical, just for correlation.
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function log(level: LogLevel, scope: string, fields: Record<string, unknown>): void {
  const payload = { t: new Date().toISOString(), level, scope, ...fields };
  const line = safeStringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function errShape(err: unknown): { message: string; name?: string } {
  if (err instanceof Error) return { message: err.message, name: err.name };
  return { message: String(err) };
}
