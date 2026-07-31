CREATE TABLE IF NOT EXISTS public.ingest_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id UUID REFERENCES public.videos(id) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  total_bytes BIGINT NOT NULL DEFAULT 0,
  chunk_size_bytes BIGINT NOT NULL DEFAULT 25165824,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  chunks_done INTEGER NOT NULL DEFAULT 0,
  bytes_done BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  last_speed_bps DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.ingest_jobs TO service_role;
ALTER TABLE public.ingest_jobs ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS ingest_jobs_updated_at ON public.ingest_jobs;
CREATE TRIGGER ingest_jobs_updated_at BEFORE UPDATE ON public.ingest_jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS ingest_jobs_status_idx ON public.ingest_jobs (status, created_at DESC);