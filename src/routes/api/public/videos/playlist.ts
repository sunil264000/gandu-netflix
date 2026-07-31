import { createFileRoute } from "@tanstack/react-router";

// Hand a video off to a desktop player (VLC / MPV / IINA / Infuse).
// Returns a tiny .m3u playlist pointing at the pass-through stream endpoint,
// so the desktop player pulls the ORIGINAL bytes — every audio track intact
// (DTS-HD, TrueHD, Atmos), no re-encode, no quality loss.
export const Route = createFileRoute("/api/public/videos/playlist")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (!id) return new Response("missing id", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: v, error } = await supabaseAdmin
          .from("videos")
          .select("id, title, storage_path, upload_mode, duration_sec")
          .eq("id", id)
          .maybeSingle();
        if (error || !v) return new Response("not found", { status: 404 });

        let target: string;
        if (v.upload_mode === "chunked") {
          target = `${url.origin}/api/public/videos/stream?id=${encodeURIComponent(v.id)}`;
        } else {
          const { data: signed } = await supabaseAdmin.storage
            .from("videos")
            .createSignedUrl(v.storage_path, 60 * 60 * 12);
          if (!signed?.signedUrl) return new Response("unavailable", { status: 503 });
          target = signed.signedUrl;
        }

        const safeTitle = String(v.title).replace(/[\r\n]+/g, " ").slice(0, 180);
        const secs = Math.round(Number(v.duration_sec ?? 0)) || -1;
        const body = ["#EXTM3U", `#EXTINF:${secs},${safeTitle}`, target, ""].join("\n");
        const fileName = safeTitle.replace(/[^\w.-]+/g, "_").slice(0, 60) || "video";

        return new Response(body, {
          headers: {
            "Content-Type": "audio/x-mpegurl",
            "Content-Disposition": `attachment; filename="${fileName}.m3u"`,
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
