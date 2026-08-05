import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Stored files are named by UUID, so the human title is the reliable source
 * for artwork lookup; only fall back to the storage filename if it looks like
 * a real release name.
 */
function sourceName(title: string | null, storagePath: string | null) {
  const file = storagePath?.split("/").pop() ?? "";
  const looksLikeUuid = /^[0-9a-f-]{30,}\.[a-z0-9]+$/i.test(file);
  if (title && title.trim().length > 1) return title;
  return looksLikeUuid ? (title ?? file) : file;
}

/** Fetch artwork for one video from its filename/title. */
export const autoPosterForVideo = createServerFn({ method: "POST" })
  .inputValidator((i: { videoId: string }) => z.object({ videoId: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { autoPoster } = await import("@/lib/poster.server");
    const { data: row } = await supabaseAdmin
      .from("videos")
      .select("id,title,storage_path")
      .eq("id", data.videoId)
      .maybeSingle();
    if (!row) return { ok: false as const, reason: "not_found" };
    const name = sourceName(row.title, row.storage_path);
    return autoPoster(supabaseAdmin, row.id, name);
  });

/**
 * Sweep the library and attach real artwork to anything that has no thumbnail
 * or is still using a generated placeholder.
 */
export const autoPosterSweep = createServerFn({ method: "POST" })
  .inputValidator((i?: { force?: boolean }) => z.object({ force: z.boolean().default(false) }).parse(i ?? {}))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { autoPoster } = await import("@/lib/poster.server");
    const { data: rows, error } = await supabaseAdmin
      .from("videos")
      .select("id,title,storage_path,thumbnail_path")
      .order("created_at", { ascending: false })
      .limit(120);
    if (error) throw error;

    const targets = (rows ?? []).filter((r) => {
      if (data.force) return true;
      const t = r.thumbnail_path ?? "";
      return !t || t.endsWith(".svg");
    });

    let matched = 0;
    const failures: string[] = [];
    for (const row of targets) {
      const name = sourceName(row.title, row.storage_path);
      try {
        const res = await autoPoster(supabaseAdmin, row.id, name);
        if (res.ok) matched += 1;
        else failures.push(`${row.title}: ${res.reason}`);
      } catch (e) {
        failures.push(`${row.title}: ${(e as Error).message}`);
      }
    }
    return { scanned: targets.length, matched, missed: failures.slice(0, 8) };
  });

/**
 * Rewrites raw release filenames stored as titles into clean display titles:
 * "Movie.Name.2024.1080p.WEB-DL.DDP5.1.x265-Grp" -> "Movie Name (2024)".
 */
export const tidyTitlesSweep = createServerFn({ method: "POST" })
  .inputValidator((i?: { force?: boolean }) => z.object({ force: z.boolean().default(false) }).parse(i ?? {}))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { prettyTitle, looksLikeReleaseName } = await import("@/lib/poster.server");
    const { data: rows, error } = await supabaseAdmin
      .from("videos")
      .select("id,title")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw error;

    let renamed = 0;
    for (const row of rows ?? []) {
      if (!data.force && !looksLikeReleaseName(row.title)) continue;
      const next = prettyTitle(row.title);
      if (!next || next === row.title) continue;
      const { error: upErr } = await supabaseAdmin.from("videos").update({ title: next }).eq("id", row.id);
      if (!upErr) renamed += 1;
    }
    return { scanned: (rows ?? []).length, renamed };
  });

