import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Upload, FileArchive, X, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

type UploadedFile = {
  name: string;
  size: number;
  type: string;
};

const ACCEPTED = [".zip", ".rar"];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function Index() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return;
    setError(null);
    const valid: UploadedFile[] = [];
    for (const f of Array.from(incoming)) {
      const lower = f.name.toLowerCase();
      if (!ACCEPTED.some((ext) => lower.endsWith(ext))) {
        setError(`"${f.name}" is not a .zip or .rar file`);
        continue;
      }
      valid.push({ name: f.name, size: f.size, type: f.type });
    }
    if (valid.length) setFiles((prev) => [...prev, ...valid]);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-10 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            Upload your extension archive
          </h1>
          <p className="mt-3 text-muted-foreground">
            Drop a <code className="rounded bg-muted px-1.5 py-0.5 text-sm">.zip</code> or{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">.rar</code> to get started.
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
            handleFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer border-2 border-dashed p-12 text-center transition-colors ${
            dragging ? "border-primary bg-accent" : "border-border hover:bg-accent/40"
          }`}
        >
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-full bg-primary/10 p-4">
              <Upload className="h-8 w-8 text-primary" />
            </div>
            <p className="text-lg font-medium text-foreground">
              Drag & drop, or click to browse
            </p>
            <p className="text-sm text-muted-foreground">Accepted: .zip, .rar</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,.rar,application/zip,application/x-rar-compressed,application/vnd.rar"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </Card>

        {error && (
          <p className="mt-4 text-sm text-destructive">{error}</p>
        )}

        {files.length > 0 && (
          <div className="mt-8 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Uploaded files
            </h2>
            {files.map((f, i) => (
              <Card key={i} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <FileArchive className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium text-foreground">{f.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(f.size)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setFiles((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    aria-label={`Remove ${f.name}`}
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
  );
}
