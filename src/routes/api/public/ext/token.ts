import { createFileRoute } from "@tanstack/react-router";
import { hmacVerify, signJwt, sha256Hex, randomHex, deriveLicenseSecret } from "@/lib/ext/crypto.server";
import { checkNonce } from "@/lib/ext/nonce.server";

export const Route = createFileRoute("/api/public/ext/token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const ts = Number(request.headers.get("x-ts") ?? 0);
        const nonce = request.headers.get("x-nonce") ?? "";
        const sig = request.headers.get("x-sig") ?? "";
        const deviceId = request.headers.get("x-device-id") ?? "";
        const extVersion = request.headers.get("x-ext-version") ?? "";
        const ua = request.headers.get("user-agent") ?? "";
        const body = await request.text();

        if (!checkNonce(nonce, ts)) return j({ error: "replay" }, 401);
        if (!deviceId || !sig) return j({ error: "missing" }, 400);

        const { data: dev } = await supabaseAdmin.from("devices").select("*, licenses(*)").eq("id", deviceId).maybeSingle();
        if (!dev || dev.revoked) return j({ error: "device_invalid" }, 401);
        const lic = (dev as { licenses: { key: string; status: string; id: string } }).licenses;
        if (!lic || lic.status !== "active") return j({ error: "license_invalid" }, 401);

        const secret = await deriveLicenseSecret(lic.key);
        const payload = `${ts}.${nonce}.POST./api/public/ext/token.${await sha256Hex(body)}`;
        if (!(await hmacVerify(secret, payload, sig))) return j({ error: "bad_sig" }, 401);

        const jti = randomHex(12);
        const uav = await sha256Hex(ua + "|" + extVersion);
        const now = Math.floor(Date.now() / 1000);
        const exp = now + 300; // 5 min
        const token = await signJwt({ sub: deviceId, lic: lic.id, fp: dev.fingerprint_hash, uav, jti, iat: now, exp });

        await supabaseAdmin.from("sessions").insert({
          license_id: lic.id, device_id: deviceId, jti, expires_at: new Date(exp * 1000).toISOString(),
        });
        return j({ ok: true, token, exp });
      },
    },
  },
});

function j(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } }); }
