
ALTER TABLE public.videos DROP CONSTRAINT IF EXISTS videos_uploaded_by_fkey;
ALTER TABLE public.videos ALTER COLUMN uploaded_by DROP NOT NULL;

ALTER TABLE public.videos REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'videos'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.videos';
  END IF;
END $$;
