import { createFileRoute } from "@tanstack/react-router";
import { newRequestId, log, errShape } from "@/lib/server-log";

export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () => {
        const reqId = newRequestId();
        const started = Date.now();
        const result: {
          status: "ok" | "degraded";
          request_id: string;
          checks: Record<string, { ok: boolean; ms: number; error?: string }>;
          version: string;
        } = {
          status: "ok",
          request_id: reqId,
          checks: {},
          version: "1.0.0",
        };

        // DB check — trivial select with timeout
        const dbStart = Date.now();
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin.from("videos").select("id", { count: "exact", head: true }).limit(1);
          if (error) throw error;
          result.checks.database = { ok: true, ms: Date.now() - dbStart };
        } catch (err) {
          result.status = "degraded";
          result.checks.database = { ok: false, ms: Date.now() - dbStart, error: errShape(err).message };
          log("error", "health.db", { reqId, err: errShape(err) });
        }

        return new Response(JSON.stringify(result, null, 2), {
          status: result.status === "ok" ? 200 : 503,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "x-request-id": reqId,
            "server-timing": `total;dur=${Date.now() - started}`,
          },
        });
      },
    },
  },
});
