import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/posterdebug")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const q = new URL(request.url).searchParams.get("q") ?? "";
        const { findPosterUrl, prettyTitle } = await import("@/lib/poster.server");
        const out: any = { q, pretty: prettyTitle(q) };
        try {
          out.found = await findPosterUrl(q);
        } catch (e) {
          out.error = (e as Error).message;
        }
        try {
          const page = await fetch(
            `https://www.themoviedb.org/search?query=${encodeURIComponent(q)}`,
            { headers: { "user-agent": "Mozilla/5.0", accept: "text/html" } },
          );
          out.tmdbStatus = page.status;
          out.tmdbLen = (await page.text()).length;
        } catch (e) {
          out.tmdbError = (e as Error).message;
        }
        return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
      },
    },
  },
});
