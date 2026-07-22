// Video streaming server functions.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type VideoRow = {
  id: string;
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
  created_at: string;
};

const SIGN_TTL = 60 * 60; // 1 hour

async function signPath(supabase: any, bucket: string, path: string | null) {
  if (!path) return null;
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, SIGN_TTL);
  return data?.signedUrl ?? null;
}

export const listVideos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { sort?: "new" | "az" | "large" | "views"; categoryId?: string | null; limit?: number; offset?: number } | undefined) =>
    z.object({
      sort: z.enum(["new", "az", "large", "views"]).default("new"),
      categoryId: z.string().uuid().nullable().optional(),
      limit: z.number().int().min(1).max(60).default(24),
      offset: z.number().int().min(0).default(0),
    }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("videos").select("*");
    if (data.categoryId) q = q.eq("category_id", data.categoryId);
    if (data.sort === "az") q = q.order("title", { ascending: true });
    else if (data.sort === "large") q = q.order("size_bytes", { ascending: false });
    else if (data.sort === "views") q = q.order("view_count", { ascending: false });
    else q = q.order("created_at", { ascending: false });
    q = q.range(data.offset, data.offset + data.limit - 1);
    const { data: rows, error } = await q;
    if (error) throw error;
    const items = await Promise.all((rows as VideoRow[]).map(async (v) => ({
      ...v,
      thumbnail_url: await signPath(context.supabase, "thumbnails", v.thumbnail_path),
    })));
    return items;
  });

export const searchVideos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { q: string }) => z.object({ q: z.string().min(1).max(200) }).parse(i))
  .handler(async ({ data, context }) => {
    const like = `%${data.q.replace(/[%_]/g, "")}%`;
    const { data: rows, error } = await context.supabase
      .from("videos")
      .select("*")
      .or(`title.ilike.${like},description.ilike.${like}`)
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) throw error;
    return Promise.all((rows as VideoRow[]).map(async (v) => ({
      ...v,
      thumbnail_url: await signPath(context.supabase, "thumbnails", v.thumbnail_path),
    })));
  });

export const getVideo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: v, error } = await context.supabase.from("videos").select("*").eq("id", data.id).maybeSingle();
    if (error) throw error;
    if (!v) throw new Error("not_found");
    const streamUrl = await signPath(context.supabase, "videos", v.storage_path);
    const thumbnailUrl = await signPath(context.supabase, "thumbnails", v.thumbnail_path);
    const { data: progress } = await context.supabase
      .from("watch_history").select("position_sec, completed").eq("user_id", context.userId).eq("video_id", data.id).maybeSingle();
    return { ...v, stream_url: streamUrl, thumbnail_url: thumbnailUrl, resume_at: progress?.position_sec ?? 0, completed: progress?.completed ?? false };
  });

export const listCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("categories").select("*").order("name");
    if (error) throw error;
    return data as { id: string; name: string; slug: string }[];
  });

export const listContinueWatching = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("watch_history")
      .select("position_sec, updated_at, video:videos(*)")
      .eq("user_id", context.userId)
      .eq("completed", false)
      .order("updated_at", { ascending: false })
      .limit(12);
    if (error) throw error;
    const rows = (data ?? []) as { position_sec: number; video: VideoRow | null }[];
    return Promise.all(rows.filter(r => r.video).map(async (r) => ({
      ...(r.video as VideoRow),
      position_sec: r.position_sec,
      thumbnail_url: await signPath(context.supabase, "thumbnails", r.video!.thumbnail_path),
    })));
  });

export const listFavorites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("favorites")
      .select("video:videos(*)")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as { video: VideoRow | null }[];
    return Promise.all(rows.filter(r => r.video).map(async (r) => ({
      ...(r.video as VideoRow),
      thumbnail_url: await signPath(context.supabase, "thumbnails", r.video!.thumbnail_path),
    })));
  });

export const toggleFavorite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { videoId: string }) => z.object({ videoId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: existing } = await context.supabase
      .from("favorites").select("id").eq("user_id", context.userId).eq("video_id", data.videoId).maybeSingle();
    if (existing) {
      await context.supabase.from("favorites").delete().eq("id", existing.id);
      return { favorited: false };
    }
    await context.supabase.from("favorites").insert({ user_id: context.userId, video_id: data.videoId });
    return { favorited: true };
  });

export const isFavorite = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { videoId: string }) => z.object({ videoId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: existing } = await context.supabase
      .from("favorites").select("id").eq("user_id", context.userId).eq("video_id", data.videoId).maybeSingle();
    return { favorited: !!existing };
  });

export const saveProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { videoId: string; positionSec: number; completed?: boolean }) => z.object({
    videoId: z.string().uuid(), positionSec: z.number().min(0), completed: z.boolean().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await context.supabase.from("watch_history").upsert({
      user_id: context.userId, video_id: data.videoId,
      position_sec: data.positionSec, completed: data.completed ?? false,
    }, { onConflict: "user_id,video_id" });
    return { ok: true };
  });

export const bumpView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { videoId: string }) => z.object({ videoId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await context.supabase.rpc("increment_video_view", { _video_id: data.videoId });
    return { ok: true };
  });

// ---------------- Admin ----------------

async function assertAdmin(context: any) {
  const { data } = await context.supabase.from("user_roles").select("role")
    .eq("user_id", context.userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Error("forbidden");
}

export const createVideoRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: {
    title: string; description?: string; storagePath: string; thumbnailPath?: string;
    sizeBytes: number; mimeType?: string; extension?: string; durationSec?: number;
    width?: number; height?: number; categoryId?: string | null;
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
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: row, error } = await context.supabase.from("videos").insert({
      title: data.title, description: data.description ?? null,
      storage_path: data.storagePath, thumbnail_path: data.thumbnailPath ?? null,
      size_bytes: data.sizeBytes, mime_type: data.mimeType ?? null, extension: data.extension ?? null,
      duration_sec: data.durationSec ?? null, width: data.width ?? null, height: data.height ?? null,
      category_id: data.categoryId ?? null, uploaded_by: context.userId,
    }).select("id").single();
    if (error) throw error;
    return { id: row.id };
  });

export const updateVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; title?: string; description?: string; categoryId?: string | null }) =>
    z.object({
      id: z.string().uuid(),
      title: z.string().min(1).max(300).optional(),
      description: z.string().max(2000).optional(),
      categoryId: z.string().uuid().nullable().optional(),
    }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;
    if (data.categoryId !== undefined) patch.category_id = data.categoryId;
    const { error } = await context.supabase.from("videos").update(patch).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const deleteVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: v } = await context.supabase.from("videos").select("storage_path, thumbnail_path").eq("id", data.id).maybeSingle();
    if (v?.storage_path) await context.supabase.storage.from("videos").remove([v.storage_path]);
    if (v?.thumbnail_path) await context.supabase.storage.from("thumbnails").remove([v.thumbnail_path]);
    const { error } = await context.supabase.from("videos").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const createCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { name: string }) => z.object({ name: z.string().min(1).max(80) }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const { data: row, error } = await context.supabase.from("categories").insert({ name: data.name, slug }).select("*").single();
    if (error) throw error;
    return row;
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("categories").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const storageStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase.from("videos").select("size_bytes, view_count");
    if (error) throw error;
    const rows = (data ?? []) as { size_bytes: number; view_count: number }[];
    return {
      total_videos: rows.length,
      total_bytes: rows.reduce((s, r) => s + Number(r.size_bytes), 0),
      total_views: rows.reduce((s, r) => s + Number(r.view_count), 0),
    };
  });
