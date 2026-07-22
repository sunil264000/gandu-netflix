import { supabase } from "@/integrations/supabase/client";

const DEVICE_KEY = "vault_device_label";

export function getDeviceLabel(): string {
  if (typeof window === "undefined") return "server";
  let label = localStorage.getItem(DEVICE_KEY);
  if (!label) {
    const ua = navigator.userAgent;
    let device = "Browser";
    if (/iPhone|iPad|iPod/.test(ua)) device = "iOS";
    else if (/Android/.test(ua)) device = "Android";
    else if (/Mac/.test(ua)) device = "Mac";
    else if (/Windows/.test(ua)) device = "Windows";
    else if (/Linux/.test(ua)) device = "Linux";
    const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
    label = `${device}-${suffix}`;
    localStorage.setItem(DEVICE_KEY, label);
  }
  return label;
}

export type TrackerStatus = "queued" | "thumb" | "uploading" | "saving" | "done" | "error";

export async function createUploadJob(params: {
  id: string;
  filename: string;
  sizeBytes: number;
  seriesLabel?: string;
}) {
  try {
    await supabase.from("upload_jobs").upsert({
      id: params.id,
      filename: params.filename,
      size_bytes: params.sizeBytes,
      uploaded_bytes: 0,
      progress: 0,
      status: "queued",
      message: "Queued",
      speed_bps: 0,
      device_label: getDeviceLabel(),
      series_label: params.seriesLabel ?? null,
    });
  } catch {
    /* non-blocking */
  }
}

export async function updateUploadJob(
  id: string,
  patch: {
    status?: TrackerStatus;
    message?: string;
    progress?: number;
    uploadedBytes?: number;
    speedBps?: number;
  },
) {
  try {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.message !== undefined) row.message = patch.message;
    if (patch.progress !== undefined) row.progress = patch.progress;
    if (patch.uploadedBytes !== undefined) row.uploaded_bytes = patch.uploadedBytes;
    if (patch.speedBps !== undefined) row.speed_bps = patch.speedBps;
    await supabase.from("upload_jobs").update(row).eq("id", id);
  } catch {
    /* non-blocking */
  }
}
