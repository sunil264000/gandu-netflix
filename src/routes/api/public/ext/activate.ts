import { createFileRoute } from "@tanstack/react-router";
import { deriveLicenseSecret, sha256Hex } from "@/lib/ext/crypto.server";

export const Route = createFileRoute("/api/public/ext/activate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let body: { license_key?: string; fingerprint?: string; ua?: string; ext_version?: string };
        try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }

        const licKey = (body.license_key ?? "").trim();
        const fp = (body.fingerprint ?? "").trim();
        if (!licKey || !fp || fp.length < 32) return json({ error: "missing_fields" }, 400);

        const { data: lic, error: lErr } = await supabaseAdmin
          .from("licenses").select("*").eq("key", licKey).maybeSingle();
        if (lErr || !lic) return json({ error: "invalid_license" }, 404);
        if (lic.status !== "active") return json({ error: "license_" + lic.status }, 403);

        const { data: plan } = await supabaseAdmin
          .from("plans").select("*").eq("code", lic.plan_code).maybeSingle();
        if (!plan) return json({ error: "plan_missing" }, 500);

        const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
        const fpHash = await sha256Hex(fp);

        // Existing device with same fingerprint?
        const { data: existing } = await supabaseAdmin
          .from("devices").select("*").eq("license_id", lic.id).eq("fingerprint_hash", fpHash).maybeSingle();

        let deviceId: string;
        if (existing) {
          if (existing.revoked) return json({ error: "device_revoked" }, 403);
          await supabaseAdmin.from("devices").update({
            last_seen_ip: ip, last_seen_at: new Date().toISOString(),
            user_agent: body.ua ?? existing.user_agent, ext_version: body.ext_version ?? existing.ext_version,
          }).eq("id", existing.id);
          deviceId = existing.id;
        } else {
          const { count } = await supabaseAdmin
            .from("devices").select("*", { count: "exact", head: true })
            .eq("license_id", lic.id).eq("revoked", false);
          if ((count ?? 0) >= plan.max_devices) {
            return json({ error: "device_limit", max_devices: plan.max_devices }, 403);
          }
          const { data: dev, error: dErr } = await supabaseAdmin.from("devices").insert({
            license_id: lic.id, fingerprint_hash: fpHash, first_seen_ip: ip, last_seen_ip: ip,
            user_agent: body.ua ?? null, ext_version: body.ext_version ?? null,
          }).select("id").single();
          if (dErr || !dev) return json({ error: "device_create_failed" }, 500);
          deviceId = dev.id;
        }

        // Return derived per-license HMAC secret. Extension stores in chrome.storage.local.
        const secret = await deriveLicenseSecret(licKey);
        return json({
          ok: true,
          device_id: deviceId,
          hmac_secret: secret,
          plan: { code: plan.code, name: plan.name, max_devices: plan.max_devices, features: plan.features },
          credits_remaining: lic.credits_remaining,
        });
      },
    },
  },
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
}
