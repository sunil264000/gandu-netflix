// Google Drive folder/file import: resolves a public Drive link into individual
// video files and queues them for the existing chunked ingest pipeline.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB — must match ingest.functions.ts
const ANON_USER = "00000000-0000-0000-0000-000000000000";

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

function getApiKey(): string {
  const apiKey = typeof process !== 'undefined' ? process.env.GOOGLE_DRIVE_API_KEY : undefined;
  if (!apiKey) {
    throw new Error("GOOGLE_DRIVE_API_KEY environment variable is not set. Please configure it in your environment.");
  }
  return apiKey;
}

type DriveFile = { id: string; name: string; size: number; mimeType: string; path: string };

/**
 * Recursively list all video files inside a Google Drive folder,
 * handling pagination (nextPageToken) and subfolders.
 */
async function listDriveFolder(
  folderId: string,
  apiKey: string,
  pathPrefix: string = "",
  depth: number = 0,
): Promise<DriveFile[]> {
  if (depth > 10) return []; // safety limit to prevent infinite recursion

  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      key: apiKey,
      fields: "nextPageToken,files(id,name,mimeType,size)",
      pageSize: "1000",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to list Google Drive folder: ${res.statusText} - ${err}`);
    }

    const data = await res.json();

    for (const f of data.files || []) {
      if (f.mimeType === "application/vnd.google-apps.folder") {
        // Recurse into subfolder
        const subPath = pathPrefix ? `${pathPrefix}/${f.name}` : f.name;
        const subFiles = await listDriveFolder(f.id, apiKey, subPath, depth + 1);
        files.push(...subFiles);
      } else if (f.size) {
        const isVideoMime = f.mimeType?.startsWith("video/");
        const isVideoExt = /\.(mp4|mkv|webm|mov|m4v|avi|flv)$/i.test(f.name);
        if (isVideoMime || isVideoExt) {
          files.push({
            id: f.id,
            name: f.name,
            size: Number(f.size),
            mimeType: f.mimeType,
            path: pathPrefix,
          });
        }
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return files;
}

async function getFolderName(folderId: string, apiKey: string): Promise<string> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${folderId}?key=${apiKey}&fields=name`,
    );
    if (res.ok) {
      const meta = await res.json();
      if (meta.name) return meta.name;
    }
  } catch {
    // ignore
  }
  return "Course";
}

/**
 * Build a download URL for the ingest pump. The API key is NOT embedded in the
 * stored URL — instead, a special `gdrive:` prefix signals pumpIngest to resolve
 * the key at download time from the environment.
 */
function makeDownloadRef(fileId: string): string {
  return `gdrive:${fileId}`;
}

/**
 * At pump time, resolve a gdrive: reference to an actual download URL.
 * This keeps the API key out of the database.
 */
export function resolveGDriveUrl(sourceUrl: string): string | null {
  if (!sourceUrl.startsWith("gdrive:")) return null;
  const fileId = sourceUrl.slice(7);
  const apiKey = typeof process !== 'undefined' ? process.env.GOOGLE_DRIVE_API_KEY : undefined;
  if (!apiKey) return null;
  // acknowledgeAbuse=true is REQUIRED for large files — without it Google returns 403
  return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&acknowledgeAbuse=true&key=${apiKey}`;
}

export async function executeStartGDriveIngest(url: string, categoryId?: string | null) {
    const parsed = extractDriveId(url);
    if (!parsed) throw new Error("Could not extract a valid Google Drive folder or file ID from the URL.");

    const apiKey = getApiKey();
    const sb = await admin();
    const filesToImport: DriveFile[] = [];
    let folderName = "Course";

    if (parsed.type === "folder") {
      folderName = await getFolderName(parsed.id, apiKey);
      const found = await listDriveFolder(parsed.id, apiKey);
      filesToImport.push(...found);
    } else {
      // Single file
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${parsed.id}?key=${apiKey}&fields=id,name,mimeType,size`,
      );
      if (!res.ok) throw new Error("Failed to fetch Google Drive file metadata");
      const f = await res.json();
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
      throw new Error("No video files found to import. Ensure the link is public and contains video files.");
    }

    // Sort by path then name for logical ordering
    filesToImport.sort((a, b) => {
      const pathCmp = a.path.localeCompare(b.path);
      return pathCmp !== 0 ? pathCmp : a.name.localeCompare(b.name);
    });

    const results = [];
    let currentPath = "";
    let partCounter = 1;

    for (let i = 0; i < filesToImport.length; i++) {
      const f = filesToImport[i]!;
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "mp4";

      // Reset part counter for each new subfolder
      if (f.path !== currentPath) {
        currentPath = f.path;
        partCounter = 1;
      }

      // Build title: "CourseName - SubFolder - Part X - FileName"
      const pathLabel = f.path ? `${f.path.replace(/\//g, " - ")} - ` : "";
      const title =
        parsed.type === "folder"
          ? `${folderName} - ${pathLabel}Part ${partCounter} - ${f.name.replace(/\.[^/.]+$/, "")}`
          : f.name.replace(/\.[^/.]+$/, "");
      
      partCounter++;

      const chunkCount = Math.ceil(f.size / CHUNK_SIZE);
      const storagePath = `ingest/${crypto.randomUUID()}/${storageSafe(f.name)}`;

      // Store a gdrive: reference instead of embedding the API key
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
