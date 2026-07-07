// Simple bootstrap admin guard: requests must present X-Admin-Token equal to EXT_MASTER_SECRET.
// This lets you administer licenses before a full auth flow exists.
export function requireAdmin(request: Request): Response | null {
  const provided = request.headers.get("x-admin-token");
  const expected = process.env.EXT_MASTER_SECRET;
  if (!expected || !provided) return new Response("unauthorized", { status: 401 });
  // Constant-time compare
  if (provided.length !== expected.length) return new Response("unauthorized", { status: 401 });
  let ok = 0;
  for (let i = 0; i < provided.length; i++) ok |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  if (ok !== 0) return new Response("unauthorized", { status: 401 });
  return null;
}
