import { createFileRoute } from "@tanstack/react-router";
import { verifyJwt } from "@/lib/ext/crypto.server";

export const Route = createFileRoute("/api/public/ext/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const jwt = request.headers.get("x-jwt") ?? "";
        const claims = await verifyJwt(jwt);
        if (!claims) return j({ status: "revoked", reason: "jwt_invalid" });

        const { data: killed } = await supabaseAdmin.from("kill_switch").select("reason").eq("license_id", claims.lic).maybeSingle();
        if (killed) return j({ status: "revoked", reason: killed.reason ?? "killed" });

        const { data: lic } = await supabaseAdmin.from("licenses").select("status,credits_remaining").eq("id", claims.lic).maybeSingle();
        if (!lic || lic.status !== "active") return j({ status: "revoked", reason: lic?.status ?? "missing" });

        const { data: dev } = await supabaseAdmin.from("devices").select("revoked").eq("id", claims.sub).maybeSingle();
        if (!dev || dev.revoked) return j({ status: "revoked", reason: "device_revoked" });

        const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
        await supabaseAdmin.from("devices").update({
          last_seen_at: new Date().toISOString(), last_seen_ip: ip,
        }).eq("id", claims.sub);

        return j({ status: "ok", credits_remaining: lic.credits_remaining });
      },
    },
  },
});

function j(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } }); }
