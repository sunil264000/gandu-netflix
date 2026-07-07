import { createFileRoute } from "@tanstack/react-router";
import { hmacVerify, verifyJwt, sha256Hex, deriveLicenseSecret } from "@/lib/ext/crypto.server";
import { checkNonce } from "@/lib/ext/nonce.server";

// Feature registry — server-authoritative credit costs.
// Every extension action MUST be listed here or it's rejected.
const ACTIONS: Record<string, { credits: number; handler: (input: unknown, ctx: Ctx) => Promise<unknown> }> = {
  "ping": { credits: 0, handler: async () => ({ pong: true, t: Date.now() }) },
  "ai.chat": { credits: 1, handler: async (input, ctx) => aiChat(input, ctx) },
  "ai.image": { credits: 10, handler: async (input, ctx) => aiImage(input, ctx) },
};

type Ctx = { licenseId: string; deviceId: string };

export const Route = createFileRoute("/api/public/ext/exec")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const ts = Number(request.headers.get("x-ts") ?? 0);
        const nonce = request.headers.get("x-nonce") ?? "";
        const sig = request.headers.get("x-sig") ?? "";
        const jwt = request.headers.get("x-jwt") ?? "";
        const ua = request.headers.get("user-agent") ?? "";
        const extVersion = request.headers.get("x-ext-version") ?? "";
        const bodyText = await request.text();

        if (!checkNonce(nonce, ts)) return j({ error: "replay" }, 401);
        const claims = await verifyJwt(jwt);
        if (!claims) return j({ error: "jwt_invalid" }, 401);
        if ((await sha256Hex(ua + "|" + extVersion)) !== claims.uav) return j({ error: "ua_mismatch" }, 401);

        // Session must still exist + not revoked
        const { data: sess } = await supabaseAdmin.from("sessions").select("revoked").eq("jti", claims.jti).maybeSingle();
        if (!sess || sess.revoked) return j({ error: "session_revoked" }, 401);

        // Kill switch check
        const { data: killed } = await supabaseAdmin.from("kill_switch").select("license_id").eq("license_id", claims.lic).maybeSingle();
        if (killed) return j({ error: "killed" }, 403);

        const { data: lic } = await supabaseAdmin.from("licenses").select("*").eq("id", claims.lic).maybeSingle();
        if (!lic || lic.status !== "active") return j({ error: "license_invalid" }, 401);
        if (lic.expires_at && new Date(lic.expires_at).getTime() <= Date.now()) {
          await supabaseAdmin.from("licenses").update({ status: "revoked" }).eq("id", lic.id).eq("status", "active");
          return j({ error: "license_expired" }, 403);
        }

        const secret = await deriveLicenseSecret(lic.key);
        const payload = `${ts}.${nonce}.POST./api/public/ext/exec.${await sha256Hex(bodyText)}`;
        if (!(await hmacVerify(secret, payload, sig))) return j({ error: "bad_sig" }, 401);

        let body: { action?: string; input?: unknown };
        try { body = JSON.parse(bodyText); } catch { return j({ error: "bad_json" }, 400); }
        const spec = ACTIONS[body.action ?? ""];
        if (!spec) return j({ error: "unknown_action" }, 400);
        if (lic.credits_remaining < spec.credits) return j({ error: "insufficient_credits" }, 402);

        // Atomic decrement (optimistic-concurrency style)
        if (spec.credits > 0) {
          const { data: upd, error: uErr } = await supabaseAdmin
            .from("licenses")
            .update({ credits_remaining: lic.credits_remaining - spec.credits })
            .eq("id", lic.id).eq("credits_remaining", lic.credits_remaining)
            .select("credits_remaining").maybeSingle();
          if (uErr || !upd) return j({ error: "concurrency_retry" }, 409);
        }

        const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
        await supabaseAdmin.from("usage_events").insert({
          license_id: lic.id, device_id: claims.sub, action: body.action!,
          credits_spent: spec.credits, ip, ua, meta: {},
        });

        // Basic anomaly heuristic: >120 events in the last 60s from this license → flag
        const { count } = await supabaseAdmin.from("usage_events")
          .select("*", { count: "exact", head: true })
          .eq("license_id", lic.id).gte("created_at", new Date(Date.now() - 60_000).toISOString());
        if ((count ?? 0) > 120) {
          await supabaseAdmin.from("anomaly_flags").insert({
            license_id: lic.id, kind: "rate_spike", severity: "high",
            meta: { window: "60s", count },
          });
        }

        try {
          const result = await spec.handler(body.input, { licenseId: lic.id, deviceId: claims.sub });
          return j({ ok: true, result, credits_remaining: lic.credits_remaining - spec.credits });
        } catch (e) {
          // Refund on failure
          if (spec.credits > 0) {
            await supabaseAdmin.rpc; // no-op guard
            await supabaseAdmin.from("licenses")
              .update({ credits_remaining: lic.credits_remaining })
              .eq("id", lic.id);
          }
          return j({ error: "action_failed", message: (e as Error).message }, 500);
        }
      },
    },
  },
});

function j(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } }); }

// ---------- Feature handlers (call Lovable AI Gateway) ----------
async function aiChat(input: unknown, _ctx: Ctx) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  const { prompt, system } = (input ?? {}) as { prompt?: string; system?: string };
  if (!prompt) throw new Error("prompt required");
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!r.ok) throw new Error(`ai_gateway_${r.status}`);
  const data = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
  return { text: data.choices?.[0]?.message?.content ?? "" };
}

async function aiImage(input: unknown, _ctx: Ctx) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  const { prompt } = (input ?? {}) as { prompt?: string };
  if (!prompt) throw new Error("prompt required");
  const r = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "google/gemini-2.5-flash-image", prompt }),
  });
  if (!r.ok) throw new Error(`ai_gateway_${r.status}`);
  return await r.json();
}
