import { createFileRoute } from "@tanstack/react-router";
import { executePump } from "@/lib/ingest.functions";

export const Route = createFileRoute("/api/public/cron")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          
          // Find the oldest active or queued job
          const { data: job, error } = await supabaseAdmin
            .from("ingest_jobs")
            .select("id")
            .in("status", ["queued", "running"])
            .order("updated_at", { ascending: true })
            .limit(1)
            .maybeSingle();

          if (error) {
            console.error("Cron db error:", error);
            return new Response("DB Error", { status: 500 });
          }

          if (job) {
            console.log(`Cron auto-pumping job: ${job.id}`);
            // This runs the pump synchronously for up to 15 seconds, making progress!
            const res = await executePump(job.id);
            return new Response(`Pumped job ${job.id} - status: ${res.status}`, { status: 200 });
          }

          return new Response("No active jobs", { status: 200 });
        } catch (e: any) {
          console.error("Cron error:", e);
          return new Response(e.message || "Error", { status: 500 });
        }
      },
    },
  },
});
