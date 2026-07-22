
CREATE TABLE public.upload_jobs (
  id UUID PRIMARY KEY,
  filename TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  uploaded_bytes BIGINT NOT NULL DEFAULT 0,
  progress REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  message TEXT,
  speed_bps BIGINT NOT NULL DEFAULT 0,
  device_label TEXT,
  series_label TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.upload_jobs TO anon, authenticated;
GRANT ALL ON public.upload_jobs TO service_role;

ALTER TABLE public.upload_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read upload_jobs" ON public.upload_jobs FOR SELECT USING (true);
CREATE POLICY "public write upload_jobs" ON public.upload_jobs FOR INSERT WITH CHECK (true);
CREATE POLICY "public update upload_jobs" ON public.upload_jobs FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "public delete upload_jobs" ON public.upload_jobs FOR DELETE USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.upload_jobs;
ALTER TABLE public.upload_jobs REPLICA IDENTITY FULL;

CREATE INDEX upload_jobs_updated_idx ON public.upload_jobs (updated_at DESC);
