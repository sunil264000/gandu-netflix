ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS upload_mode text NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS chunk_size_bytes integer,
  ADD COLUMN IF NOT EXISTS chunk_count integer;

ALTER TABLE public.videos
  DROP CONSTRAINT IF EXISTS videos_upload_mode_check;

ALTER TABLE public.videos
  ADD CONSTRAINT videos_upload_mode_check CHECK (upload_mode IN ('single', 'chunked'));

UPDATE public.videos
SET upload_mode = 'single'
WHERE upload_mode IS NULL;