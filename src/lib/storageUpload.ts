// Shared browser-side storage upload helpers (resumable + direct).
import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export const DIRECT_UPLOAD_LIMIT = 42 * 1024 * 1024;

export function tusUploadFile(
  bucket: string,
  path: string,
  file: File | Blob,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { Authorization: `Bearer ${SUPABASE_KEY}`, "x-upsert": "true", apikey: SUPABASE_KEY },
      uploadDataDuringCreation: false,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType: (file as File).type || "application/octet-stream",
        cacheControl: "3600",
      },
      chunkSize: 6 * 1024 * 1024,
      onError: (e) => reject(e),
      onProgress: (sent, total) => onProgress?.((sent / total) * 100),
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}

export async function uploadSmallObject(bucket: string, path: string, blob: Blob, contentType?: string) {
  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    upsert: true,
    contentType: contentType || blob.type || "application/octet-stream",
    cacheControl: "3600",
  });
  if (error) throw error;
}

export async function uploadAny(
  bucket: string,
  path: string,
  file: File,
  onProgress?: (pct: number) => void,
) {
  if (file.size <= DIRECT_UPLOAD_LIMIT) {
    await uploadSmallObject(bucket, path, file, file.type);
    onProgress?.(100);
    return;
  }
  await tusUploadFile(bucket, path, file, onProgress);
}
