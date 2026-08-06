// Google Drive folder/file import: resolves a Drive link into individual
// video files and queues them for the existing chunked ingest pipeline.
//
// All Drive traffic goes through the Lovable connector gateway, which holds the
// OAuth credentials and refreshes them automatically. No API key lives in the DB.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB — must match ingest.functions.ts
const ANON_USER = "00000000-0000-0000-0000-000000000000";
const GATEWAY = "https://connector-gateway.lovable.dev/google_drive/drive/v3";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function storageSafe(n: string) {
  return (
    n
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^[_.]+/, "")
      .slice(0, 120) || "video.mp4"
  );
}

function extractDriveId(url: string): { id: string; type: "folder" | "file" } | null {
  const m1 = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m1) return { id: m1[1]!, type: "folder" };
  const m3 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m3) return { id: m3[1]!, type: "file" };
  const m2 = url.match(/id=([a-zA-Z0-9_-]+)/);
  if (m2) return { id: m2[1]!, type: "file" };
  return null;
}

/**
 * Auth headers for the connector gateway. Returns null when the Google Drive
 * connector is not linked yet, so callers can produce a friendly message.
 */
export function gdriveHeaders(): Record<string, string> | null {
  const lovableKey = typeof process !== "undefined" ? process.env.LOVABLE_API_KEY : undefined;
  const connKey = typeof process !== "undefined" ? process.env.GOOGLE_DRIVE_API_KEY : undefined;
  if (!lovableKey || !connKey) return null;
  return { authorization: `Bearer ${lovableKey}`, "x-connection-api-key": connKey };
}

function requireHeaders(): Record<string, string> {
  const h = gdriveHeaders();
  if (!h)
    throw new Error(
      "Google Drive is not connected yet. Link the Google Drive connector in project settings and retry.",
    );
  return h;
}

type DriveFile = { id: string; name: string; size: number; mimeType: string; path: string };

async function driveGet(path: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ supportsAllDrives: "true", ...params });
  const res = await fetch(`${GATEWAY}${path}?${qs}`, { headers: requireHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Drive request failed [${res.status}]: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** Recursively list every video file inside a Drive folder (handles pagination + subfolders). */
async function listDriveFolder(folderId: string, pathPrefix = "", depth = 0): Promise<DriveFile[]> {
  if (depth > 10) return [];

  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params: Record<string, string> = {
      q: `'${folderId}' in parents and trashed=false`,
      fields: "nextPageToken,files(id,name,mimeType,size)",
      pageSize: "1000",
      includeItemsFromAllDrives: "true",
    };
    if (pageToken) params.pageToken = pageToken;

    const data = await driveGet("/files", params);

    for (const f of data.files || []) {
      if (f.mimeType === "application/vnd.google-apps.folder") {
        const subPath = pathPrefix ? `${pathPrefix}/${f.name}` : f.name;
        files.push(...(await listDriveFolder(f.id, subPath, depth + 1)));
      } else if (f.size) {
        const isVideoMime = f.mimeType?.startsWith("video/");
        const isVideoExt = /\.(mp4|mkv|webm|mov|m4v|avi|flv|ts|m2ts|wmv|mpg|mpeg)$/i.test(f.name);
        if (isVideoMime || isVideoExt) {
          files.push({ id: f.id, name: f.name, size: Number(f.size), mimeType: f.mimeType, path: pathPrefix });
        }
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return files;
}

async function getFolderName(folderId: string): Promise<string> {
  try {
    const meta = await driveGet(`/files/${folderId}`, { fields: "name" });
    if (meta.name) return meta.name as string;
  } catch {
    /* ignore */
  }
  return "Course";
}

/** Stored source reference — never contains credentials. */
function makeDownloadRef(fileId: string): string {
  return `gdrive:${fileId}`;
}

/** At pump time, turn a `gdrive:` reference into a gateway media URL. */
export function resolveGDriveUrl(sourceUrl: string): string | null {
  if (!sourceUrl.startsWith("gdrive:")) return null;
  const fileId = sourceUrl.slice(7);
  return `${GATEWAY}/files/${fileId}?alt=media&acknowledgeAbuse=true&supportsAllDrives=true`;
}

export async function executeStartGDriveIngest(url: string, categoryId?: string | null) {
  const parsed = extractDriveId(url);
  if (!parsed) throw new Error("Could not extract a valid Google Drive folder or file ID from the URL.");

  requireHeaders();
  const sb = await admin();
  const filesToImport: DriveFile[] = [];
  let folderName = "Course";

  if (parsed.type === "folder") {
    folderName = await getFolderName(parsed.id);
    filesToImport.push(...(await listDriveFolder(parsed.id)));
  } else {
    const f = await driveGet(`/files/${parsed.id}`, { fields: "id,name,mimeType,size" });
    if (f.size) {
      filesToImport.push({
        id: f.id,
        name: f.name,
        size: Number(f.size),
        mimeType: f.mimeType || "video/mp4",
        path: "",
      });
    }
  }

  if (filesToImport.length === 0) {
    throw new Error(
      "No video files found. Make sure the link is shared with the connected Google account and contains video files.",
    );
  }

  filesToImport.sort((a, b) => {
    const pathCmp = a.path.localeCompare(b.path);
    return pathCmp !== 0 ? pathCmp : a.name.localeCompare(b.name, undefined, { numeric: true });
  });

  const results = [];
  let currentPath = "";
  let partCounter = 1;

  for (let i = 0; i < filesToImport.length; i++) {
    const f = filesToImport[i]!;
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "mp4";

    if (f.path !== currentPath) {
      currentPath = f.path;
      partCounter = 1;
    }

    const { prettyTitle } = await import("@/lib/poster.server");
    const clean = prettyTitle(f.name);
    const pathLabel = f.path ? `${f.path.replace(/\//g, " - ")} - ` : "";
    const title =
      parsed.type === "folder" ? `${folderName} - ${pathLabel}Part ${partCounter} - ${clean}` : clean;

    partCounter++;

    const chunkCount = Math.ceil(f.size / CHUNK_SIZE);
    const storagePath = `ingest/${crypto.randomUUID()}/${storageSafe(f.name)}`;
    const downloadRef = makeDownloadRef(f.id);

    const { data: video, error: vErr } = await sb
      .from("videos")
      .insert({
        title,
        storage_path: storagePath,
        size_bytes: f.size,
        mime_type: f.mimeType,
        extension: ext,
        category_id: categoryId ?? null,
        uploaded_by: ANON_USER,
        upload_mode: "chunked",
        chunk_size_bytes: CHUNK_SIZE,
        chunk_count: chunkCount,
      })
      .select("id")
      .single();
    if (vErr) throw vErr;

    const { data: job, error: jErr } = await sb
      .from("ingest_jobs")
      .insert({
        video_id: video.id,
        source_url: downloadRef,
        file_name: f.name,
        storage_path: storagePath,
        total_bytes: f.size,
        chunk_size_bytes: CHUNK_SIZE,
        chunk_count: chunkCount,
        status: "queued",
      })
      .select("id")
      .single();
    if (jErr) throw jErr;

    // Artwork lookup up front so the card looks right while it downloads.
    try {
      const { autoPoster } = await import("@/lib/poster.server");
      await autoPoster(sb, video.id, f.name);
    } catch {
      /* best effort */
    }

    results.push({ jobId: job.id as string, videoId: video.id as string, title });
  }
  return { importedCount: filesToImport.length, jobs: results };
}

export const startGDriveIngest = createServerFn({ method: "POST" })
  .inputValidator((i: { url: string; categoryId?: string | null }) =>
    z
      .object({
        url: z.string().url().max(4000),
        categoryId: z.string().uuid().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    return executeStartGDriveIngest(data.url, data.categoryId);
  });
