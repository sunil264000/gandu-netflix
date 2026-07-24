// Video streaming server functions — auth removed (single-user private vault).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type VideoRow = {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  storage_path: string;
  thumbnail_path: string | null;
  mime_type: string | null;
  extension: string | null;
  size_bytes: number;
  duration_sec: number | null;
  width: number | null;
  height: number | null;
  category_id: string | null;
  view_count: number;
  upload_mode: "single" | "chunked";
  chunk_size_bytes: number | null;
  chunk_count: number | null;
  created_at: string;
};

const SIGN_TTL = 60 * 60 * 6; // 6 hours
const ANON_USER = "00000000-0000-0000-0000-000000000000";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function signPath(sb: any, bucket: string, path: string | null) {
  if (!path) return null;
  const { data } = await sb.storage.from(bucket).createSignedUrl(path, SIGN_TTL);
  return data?.signedUrl ?? null;
}

export const listVideos = createServerFn({ method: "GET" })
  .inputValidator((i: { sort?: "new" | "az" | "large" | "views"; categoryId?: string | null; limit?: number; offset?: number } | undefined) =>
    z.object({
      sort: z.enum(["new", "az", "large", "views"]).default("new"),
      categoryId: z.string().uuid().nullable().optional(),
      limit: z.number().int().min(1).max(60).default(24),
      offset: z.number().int().min(0).default(0),
    }).parse(i ?? {}))
  .handler(async ({ data }) => {
    const sb = await admin();
    let q = sb.from("videos").select("*");
    if (data.categoryId) q = q.eq("category_id", data.categoryId);
    if (data.sort === "az") q = q.order("title", { ascending: true });
    else if (data.sort === "large") q = q.order("size_bytes", { ascending: false });
    else if (data.sort === "views") q = q.order("view_count", { ascending: false });
    else q = q.order("created_at", { ascending: false });
    q = q.range(data.offset, data.offset + data.limit - 1);
    const { data: rows, error } = await q;
    if (error) throw error;
    return Promise.all((rows as VideoRow[]).map(async (v) => ({
      ...v, thumbnail_url: await signPath(sb, "thumbnails", v.thumbnail_path),
    })));
  });

export const searchVideos = createServerFn({ method: "GET" })
  .inputValidator((i: { q: string }) => z.object({ q: z.string().min(1).max(200) }).parse(i))
  .handler(async ({ data }) => {
    const sb = await admin();
    const like = `%${data.q.replace(/[%_]/g, "")}%`;
    const { data: rows, error } = await sb.from("videos").select("*")
      .or(`title.ilike.${like},description.ilike.${like}`)
      .order("created_at", { ascending: false }).limit(60);
    if (error) throw error;
    return Promise.all((rows as VideoRow[]).map(async (v) => ({
      ...v, thumbnail_url: await signPath(sb, "thumbnails", v.thumbnail_path),
    })));
  });

export const getVideo = createServerFn({ method: "GET" })
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: v, error } = await sb.from("videos").select("*").eq("id", data.id).maybeSingle();
    if (error) throw error;
    if (!v) throw new Error("not_found");
    const streamUrl = v.upload_mode === "chunked"
      ? `/api/public/videos/stream?id=${encodeURIComponent(v.id)}`
      : await signPath(sb, "videos", v.storage_path);
    const thumbnailUrl = await signPath(sb, "thumbnails", v.thumbnail_path);
    const { data: progress } = await sb.from("watch_history")
      .select("position_sec, completed").eq("user_id", ANON_USER).eq("video_id", data.id).maybeSingle();
    return { ...v, stream_url: streamUrl, thumbnail_url: thumbnailUrl, resume_at: progress?.position_sec ?? 0, completed: progress?.completed ?? false };
  });

export const listCategories = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb.from("categories").select("*").order("name");
  if (error) throw error;
  return data as { id: string; name: string; slug: string }[];
});

export const listContinueWatching = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb.from("watch_history")
    .select("position_sec, updated_at, video:videos(*)")
    .eq("user_id", ANON_USER).eq("completed", false)
    .order("updated_at", { ascending: false }).limit(12);
  if (error) throw error;
  const rows = (data ?? []) as { position_sec: number; video: VideoRow | null }[];
  return Promise.all(rows.filter(r => r.video).map(async (r) => ({
    ...(r.video as VideoRow), position_sec: r.position_sec,
    thumbnail_url: await signPath(sb, "thumbnails", r.video!.thumbnail_path),
  })));
});

export const listFavorites = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb.from("favorites")
    .select("video:videos(*)").eq("user_id", ANON_USER).order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as { video: VideoRow | null }[];
  return Promise.all(rows.filter(r => r.video).map(async (r) => ({
    ...(r.video as VideoRow),
    thumbnail_url: await signPath(sb, "thumbnails", r.video!.thumbnail_path),
  })));
});

export const toggleFavorite = createServerFn({ method: "POST" })
  .inputValidator((i: { videoId: string }) => z.object({ videoId: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: existing } = await sb.from("favorites").select("id")
      .eq("user_id", ANON_USER).eq("video_id", data.videoId).maybeSingle();
    if (existing) {
      await sb.from("favorites").delete().eq("id", existing.id);
      return { favorited: false };
    }
    await sb.from("favorites").insert({ user_id: ANON_USER, video_id: data.videoId });
    return { favorited: true };
  });

export const isFavorite = createServerFn({ method: "GET" })
  .inputValidator((i: { videoId: string }) => z.object({ videoId: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: existing } = await sb.from("favorites").select("id")
      .eq("user_id", ANON_USER).eq("video_id", data.videoId).maybeSingle();
    return { favorited: !!existing };
  });

export const saveProgress = createServerFn({ method: "POST" })
  .inputValidator((i: { videoId: string; positionSec: number; completed?: boolean }) => z.object({
    videoId: z.string().uuid(), positionSec: z.number().min(0), completed: z.boolean().optional(),
  }).parse(i))
  .handler(async ({ data }) => {
    const sb = await admin();
    await sb.from("watch_history").upsert({
      user_id: ANON_USER, video_id: data.videoId,
      position_sec: data.positionSec, completed: data.completed ?? false,
    }, { onConflict: "user_id,video_id" });
    return { ok: true };
  });

export const bumpView = createServerFn({ method: "POST" })
  .inputValidator((i: { videoId: string }) => z.object({ videoId: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { error } = await (sb.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }>)("increment_video_view_admin", { _video_id: data.videoId });
    if (error) {
      // Fallback to non-atomic increment if the RPC isn't deployed yet.
      const { data: cur } = await sb.from("videos").select("view_count").eq("id", data.videoId).maybeSingle();
      const next = (cur?.view_count ?? 0) + 1;
      await sb.from("videos").update({ view_count: next }).eq("id", data.videoId);
    }
    return { ok: true };
  });

// ---------------- Admin (no auth) ----------------

export const createVideoRecord = createServerFn({ method: "POST" })
  .inputValidator((i: {
    title: string; description?: string; storagePath: string; thumbnailPath?: string;
    sizeBytes: number; mimeType?: string; extension?: string; durationSec?: number;
    width?: number; height?: number; categoryId?: string | null;
    uploadMode?: "single" | "chunked"; chunkSizeBytes?: number; chunkCount?: number;
  }) => z.object({
    title: z.string().min(1).max(300),
    description: z.string().max(2000).optional(),
    storagePath: z.string().min(1),
    thumbnailPath: z.string().optional(),
    sizeBytes: z.number().int().min(0),
    mimeType: z.string().optional(),
    extension: z.string().optional(),
    durationSec: z.number().min(0).optional(),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    uploadMode: z.enum(["single", "chunked"]).default("single"),
    chunkSizeBytes: z.number().int().positive().optional(),
    chunkCount: z.number().int().positive().optional(),
  }).parse(i))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: row, error } = await sb.from("videos").insert({
      title: data.title, description: data.description ?? null,
      storage_path: data.storagePath, thumbnail_path: data.thumbnailPath ?? null,
      size_bytes: data.sizeBytes, mime_type: data.mimeType ?? null, extension: data.extension ?? null,
      duration_sec: data.durationSec ?? null, width: data.width ?? null, height: data.height ?? null,
      category_id: data.categoryId ?? null, uploaded_by: ANON_USER,
      upload_mode: data.uploadMode,
      chunk_size_bytes: data.uploadMode === "chunked" ? data.chunkSizeBytes ?? null : null,
      chunk_count: data.uploadMode === "chunked" ? data.chunkCount ?? null : null,
    }).select("id").single();
    if (error) throw error;
    return { id: row.id };
  });

export const updateVideo = createServerFn({ method: "POST" })
  .inputValidator((i: { id: string; title?: string; description?: string; categoryId?: string | null }) =>
    z.object({
      id: z.string().uuid(),
      title: z.string().min(1).max(300).optional(),
      description: z.string().max(2000).optional(),
      categoryId: z.string().uuid().nullable().optional(),
    }).parse(i))
  .handler(async ({ data }) => {
    const sb = await admin();
    const patch: { title?: string; description?: string | null; category_id?: string | null } = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;
    if (data.categoryId !== undefined) patch.category_id = data.categoryId;
    const { error } = await sb.from("videos").update(patch).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const deleteVideo = createServerFn({ method: "POST" })
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: row, error: fetchErr } = await sb
      .from("videos")
      .select("storage_path, thumbnail_path, upload_mode, chunk_count")
      .eq("id", data.id)
      .maybeSingle();
    if (fetchErr) throw fetchErr;

    if (row) {
      // Remove video bytes (chunks or single file)
      const videoPaths: string[] = [];
      if (row.upload_mode === "chunked" && row.chunk_count && row.storage_path) {
        for (let i = 0; i < row.chunk_count; i += 1) {
          videoPaths.push(`${row.storage_path}.part-${String(i).padStart(6, "0")}`);
        }
      } else if (row.storage_path) {
        videoPaths.push(row.storage_path);
      }
      if (videoPaths.length) {
        await sb.storage.from("videos").remove(videoPaths);
      }
      if (row.thumbnail_path) {
        await sb.storage.from("thumbnails").remove([row.thumbnail_path]);
      }
    }

    // Clean up dependent rows first (avoid FK issues)
    await sb.from("favorites").delete().eq("video_id", data.id);
    await sb.from("watch_history").delete().eq("video_id", data.id);

    const { error } = await sb.from("videos").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const createCategory = createServerFn({ method: "POST" })
  .inputValidator((i: { name: string }) => z.object({ name: z.string().min(1).max(80) }).parse(i))
  .handler(async ({ data }) => {
    const sb = await admin();
    const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const { data: row, error } = await sb.from("categories").insert({ name: data.name, slug }).select("*").single();
    if (error) throw error;
    return row;
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { error } = await sb.from("categories").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const storageStats = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb.from("videos").select("size_bytes, view_count");
  if (error) throw error;
  const rows = (data ?? []) as { size_bytes: number; view_count: number }[];
  return {
    total_videos: rows.length,
    total_bytes: rows.reduce((s, r) => s + Number(r.size_bytes), 0),
    total_views: rows.reduce((s, r) => s + Number(r.view_count), 0),
  };
});

export const getUploadUrl = createServerFn({ method: "POST" })
  .inputValidator((i: { path: string; bucket: "videos" | "thumbnails" }) =>
    z.object({ path: z.string().min(1), bucket: z.enum(["videos", "thumbnails"]) }).parse(i))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: signed, error } = await sb.storage.from(data.bucket).createSignedUploadUrl(data.path);
    if (error) throw error;
    return signed;
  });
