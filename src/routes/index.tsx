import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Upload, FileArchive, X, CheckCircle2, Download, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  component: Index,
});

type ArchiveRow = {
  id: string;
  filename: string;
  storage_path: string;
  size_bytes: number;
  mime_type: string | null;
  note: string | null;
  created_at: string;
};

const ACCEPTED = [".zip", ".rar"];
const MAX_BYTES = 25 * 1024 * 1024; // 25MB safety cap

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function Index() {
  const [rows, setRows] = useState<ArchiveRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadRows = useCallback(async () => {
    const { data, error } = await supabase
      .from("archives")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Failed to load archives");
      return;
    }
    setRows(data as ArchiveRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const uploadFiles = useCallback(
    async (incoming: FileList | null) => {
      if (!incoming || !incoming.length) return;
      setUploading(true);
      try {
        for (const file of Array.from(incoming)) {
          const lower = file.name.toLowerCase();
          if (!ACCEPTED.some((ext) => lower.endsWith(ext))) {
            toast.error(`"${file.name}" is not a .zip or .rar file`);
            continue;
          }
          if (file.size > MAX_BYTES) {
            toast.error(`"${file.name}" exceeds 25MB limit`);
            continue;
          }
          const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name}`;
          const { error: upErr } = await supabase.storage
            .from("archives")
            .upload(path, file, { contentType: file.type || "application/octet-stream" });
          if (upErr) {
            toast.error(`Upload failed: ${upErr.message}`);
            continue;
          }
          const { error: dbErr } = await supabase.from("archives").insert({
            filename: file.name,
            storage_path: path,
            size_bytes: file.size,
            mime_type: file.type || null,
          });
          if (dbErr) {
            toast.error(`Saving record failed: ${dbErr.message}`);
            continue;
          }
          toast.success(`Uploaded ${file.name}`);
        }
        await loadRows();
      } finally {
        setUploading(false);
      }
    },
    [loadRows],
  );

  const download = async (row: ArchiveRow) => {
    const { data, error } = await supabase.storage
      .from("archives")
      .createSignedUrl(row.storage_path, 60);
    if (error || !data) {
      toast.error("Could not generate download link");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const remove = async (row: ArchiveRow) => {
    await supabase.storage.from("archives").remove([row.storage_path]);
    await supabase.from("archives").delete().eq("id", row.id);
    toast.success("Deleted");
    await loadRows();
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-10 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            Upload your extension archive
          </h1>
          <p className="mt-3 text-muted-foreground">
            Drop a <code className="rounded bg-muted px-1.5 py-0.5 text-sm">.zip</code> or{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">.rar</code> (up to 25 MB).
            No login required.
          </p>
        </header>

        <Card
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            uploadFiles(e.dataTransfer.files);
          }}
          onClick={() => !uploading && inputRef.current?.click()}
          className={`cursor-pointer border-2 border-dashed p-12 text-center transition-colors ${
            dragging ? "border-primary bg-accent" : "border-border hover:bg-accent/40"
          } ${uploading ? "pointer-events-none opacity-60" : ""}`}
        >
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-full bg-primary/10 p-4">
              {uploading ? (
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              ) : (
                <Upload className="h-8 w-8 text-primary" />
              )}
            </div>
            <p className="text-lg font-medium text-foreground">
              {uploading ? "Uploading…" : "Drag & drop, or click to browse"}
            </p>
            <p className="text-sm text-muted-foreground">Accepted: .zip, .rar</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,.rar,application/zip,application/x-rar-compressed,application/vnd.rar"
            multiple
            className="hidden"
            onChange={(e) => {
              uploadFiles(e.target.files);
              if (inputRef.current) inputRef.current.value = "";
            }}
          />
        </Card>

        <div className="mt-10">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Uploaded archives {rows.length > 0 && `(${rows.length})`}
          </h2>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing uploaded yet.</p>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => (
                <Card key={row.id} className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <FileArchive className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium text-foreground">{row.filename}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(row.size_bytes)} ·{" "}
                        {new Date(row.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="mr-1 h-4 w-4 text-primary" />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => download(row)}
                      aria-label={`Download ${row.filename}`}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(row)}
                      aria-label={`Delete ${row.filename}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
