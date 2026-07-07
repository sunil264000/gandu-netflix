
CREATE TABLE public.archives (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  size_bytes BIGINT NOT NULL,
  mime_type TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.archives TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.archives TO authenticated;
GRANT ALL ON public.archives TO service_role;

ALTER TABLE public.archives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view archives" ON public.archives FOR SELECT USING (true);
CREATE POLICY "Anyone can insert archives" ON public.archives FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can delete archives" ON public.archives FOR DELETE USING (true);

-- Storage policies for archives bucket (public read + open write/delete)
CREATE POLICY "Anyone can upload to archives bucket"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'archives');

CREATE POLICY "Anyone can read archives bucket"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'archives');

CREATE POLICY "Anyone can delete from archives bucket"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'archives');
