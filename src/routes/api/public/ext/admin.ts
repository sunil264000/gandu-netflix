// Bootstrap admin API — all requests require X-Admin-Token = EXT_MASTER_SECRET.
// Actions: create_license, list_licenses, revoke_license, unrevoke_license,
//          kill_license, unkill_license, adjust_credits, list_devices, revoke_device
import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "@/lib/ext/admin-guard.server";
import { randomLicenseKey, deriveLicenseSecret } from "@/lib/ext/crypto.server";

export const Route = createFileRoute("/api/public/ext/admin")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = requireAdmin(request);
        if (denied) return denied;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const body = await request.json() as { action: string; [k: string]: unknown };

        switch (body.action) {
          case "list_plans": {
            const { data } = await supabaseAdmin.from("plans").select("*").order("price_inr");
            return j({ ok: true, plans: data });
          }
          case "list_licenses": {
            const { data } = await supabaseAdmin.from("licenses")
              .select("id,key,plan_code,status,credits_remaining,credits_reset_at,notes,created_at")
              .order("created_at", { ascending: false }).limit(500);
            return j({ ok: true, licenses: data });
          }
          case "create_license": {
            const plan = (body.plan_code as string) ?? "free";
            const notes = (body.notes as string) ?? null;
            const { data: p } = await supabaseAdmin.from("plans").select("*").eq("code", plan).maybeSingle();
            if (!p) return j({ error: "plan_missing" }, 400);
            const key = randomLicenseKey();
            const hmac = await deriveLicenseSecret(key);
            const { data, error } = await supabaseAdmin.from("licenses").insert({
              key, plan_code: plan, credits_remaining: p.monthly_credits, hmac_secret: hmac, notes,
            }).select().single();
            if (error) return j({ error: error.message }, 500);
            return j({ ok: true, license: data });
          }
          case "revoke_license": {
            await supabaseAdmin.from("licenses").update({ status: "revoked" }).eq("id", body.license_id as string);
            return j({ ok: true });
          }
          case "unrevoke_license": {
            await supabaseAdmin.from("licenses").update({ status: "active" }).eq("id", body.license_id as string);
            return j({ ok: true });
          }
          case "kill_license": {
            await supabaseAdmin.from("kill_switch").upsert({
              license_id: body.license_id as string, reason: (body.reason as string) ?? "admin",
            });
            await supabaseAdmin.from("sessions").update({ revoked: true }).eq("license_id", body.license_id as string);
            return j({ ok: true });
          }
          case "unkill_license": {
            await supabaseAdmin.from("kill_switch").delete().eq("license_id", body.license_id as string);
            return j({ ok: true });
          }
          case "adjust_credits": {
            await supabaseAdmin.from("licenses").update({
              credits_remaining: body.credits as number,
            }).eq("id", body.license_id as string);
            return j({ ok: true });
          }
          case "list_devices": {
            const { data } = await supabaseAdmin.from("devices").select("*")
              .eq("license_id", body.license_id as string).order("created_at", { ascending: false });
            return j({ ok: true, devices: data });
          }
          case "revoke_device": {
            await supabaseAdmin.from("devices").update({ revoked: true }).eq("id", body.device_id as string);
            return j({ ok: true });
          }
          case "list_usage": {
            const { data } = await supabaseAdmin.from("usage_events").select("*")
              .eq("license_id", body.license_id as string)
              .order("created_at", { ascending: false }).limit(200);
            return j({ ok: true, usage: data });
          }
          default:
            return j({ error: "unknown_action" }, 400);
        }
      },
    },
  },
});

function j(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } }); }
