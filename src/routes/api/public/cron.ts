import { createFileRoute } from "@tanstack/react-router";
import { executePump } from "@/lib/ingest.functions";
import { getTelegramConfig, sendTelegramMessage } from "@/lib/telegram";

// Automation worker: keeps pumping queued/running downloads for as long as the
// request budget allows, then reports finished jobs to Telegram.
// Safe to hit repeatedly (pg_cron, uptime pinger, or the admin UI).
const BUDGET_MS = 45_000;

export const Route = createFileRoute("/api/public/cron")({
  server: {
    handlers: {
      GET: async () => {
        const t0 = Date.now();
        const log: string[] = [];
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { adminChatId } = getTelegramConfig();

          while (Date.now() - t0 < BUDGET_MS) {
            const { data: job, error } = await supabaseAdmin
              .from("ingest_jobs")
              .select("id,file_name")
              .in("status", ["queued", "running"])
              .order("updated_at", { ascending: true })
              .limit(1)
              .maybeSingle();

            if (error) {
              console.error("Cron db error:", error);
              return new Response(`DB error: ${error.message}`, { status: 500 });
            }
            if (!job) break;

            const res = await executePump(job.id);
            log.push(`${job.file_name}: ${res.status} ${res.chunksDone}/${res.chunkCount}`);

            if (res.status === "done" && adminChatId) {
              await sendTelegramMessage(adminChatId, `✅ Finished downloading <b>${job.file_name}</b>`);
            }
            if (res.status === "error" && adminChatId) {
              await sendTelegramMessage(adminChatId, `❌ Download failed: <b>${job.file_name}</b>`);
            }
            if (res.status === "error") break;
          }

          return new Response(log.length ? log.join("\n") : "No active jobs", { status: 200 });
        } catch (e: any) {
          console.error("Cron error:", e);
          return new Response(e?.message || "Error", { status: 500 });
        }
      },
    },
  },
});
