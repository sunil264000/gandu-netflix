import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const CHUNK_SIZE = 24 * 1024 * 1024; // 24 MB
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

function extractDriveId(url: string) {
  const m1 = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = url.match(/id=([a-zA-Z0-9_-]+)/);
  if (m2) return m2[1];
  const m3 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m3) return m3[1];
  return null;
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
    const driveId = extractDriveId(data.url);
    if (!driveId) throw new Error("Could not extract a valid Google Drive folder or file ID from the URL.");

    const apiKey = process.env.GOOGLE_DRIVE_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_DRIVE_API_KEY environment variable is not set. Please configure it in your environment.");
    }

    const sb = await admin();
    const isFolder = data.url.includes("/folders/");
    const filesToImport: { id: string; name: string; size: number; mimeType: string }[] = [];
    let folderName = "Course";

    if (isFolder) {
      // Get folder name
      try {
        const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}?key=${apiKey}&fields=name`);
        if (metaRes.ok) {
          const meta = await metaRes.json();
          if (meta.name) folderName = meta.name;
        }
      } catch (e) {
        // ignore
      }

      // List files inside folder
      const listUrl = `https://www.googleapis.com/drive/v3/files?q='${driveId}'+in+parents+and+trashed=false&key=${apiKey}&fields=files(id,name,mimeType,size)&pageSize=100`;
      const res = await fetch(listUrl);
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Failed to list Google Drive folder: ${res.statusText} - ${err}`);
      }
      const listData = await res.json();
      for (const f of listData.files || []) {
        if (f.mimeType && f.mimeType.startsWith("video/") && f.size) {
          filesToImport.push({ id: f.id, name: f.name, size: Number(f.size), mimeType: f.mimeType });
        }
      }
    } else {
      // Single file
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}?key=${apiKey}&fields=id,name,mimeType,size`);
      if (!res.ok) throw new Error("Failed to fetch Google Drive file metadata");
      const f = await res.json();
      if (f.size) {
        filesToImport.push({ id: f.id, name: f.name, size: Number(f.size), mimeType: f.mimeType || "video/mp4" });
      }
    }

    if (filesToImport.length === 0) {
      throw new Error("No video files found to import. Ensure the link is public and contains video files.");
    }

    // Sort files by name to order them nicely as parts
    filesToImport.sort((a, b) => a.name.localeCompare(b.name));

    const results = [];

    for (let i = 0; i < filesToImport.length; i++) {
      const f = filesToImport[i]!;
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "mp4";
      
      // If we are importing a folder, group them using a series marker so they show up as a Course.
      const title = isFolder 
        ? `${folderName} - Part ${i + 1} - ${f.name.replace(/\.[^/.]+$/, "")}`
        : f.name.replace(/\.[^/.]+$/, "");

      const chunkCount = Math.ceil(f.size / CHUNK_SIZE);
      const storagePath = `ingest/${crypto.randomUUID()}/${storageSafe(f.name)}`;
      
      // Use alt=media for downloading
      const downloadUrl = `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&key=${apiKey}`;

      const { data: video, error: vErr } = await sb
        .from("videos")
        .insert({
          title,
          storage_path: storagePath,
          size_bytes: f.size,
          mime_type: f.mimeType,
          extension: ext,
          category_id: data.categoryId ?? null,
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
          source_url: downloadUrl,
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

    return { importedCount: results.length, jobs: results };
  });
