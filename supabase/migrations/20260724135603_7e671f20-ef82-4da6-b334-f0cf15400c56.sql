
-- Add slug column
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS slug text;

-- Slug generator
CREATE OR REPLACE FUNCTION public.slugify(input text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(both '-' from regexp_replace(lower(coalesce(input,'')), '[^a-z0-9]+', '-', 'g'));
$$;

-- Backfill unique slugs from title (+ short id suffix for collisions)
DO $$
DECLARE r RECORD; base text; candidate text; n int;
BEGIN
  FOR r IN SELECT id, title FROM public.videos WHERE slug IS NULL OR slug = '' LOOP
    base := NULLIF(public.slugify(r.title), '');
    IF base IS NULL THEN base := 'video'; END IF;
    candidate := base;
    n := 0;
    WHILE EXISTS (SELECT 1 FROM public.videos WHERE slug = candidate AND id <> r.id) LOOP
      n := n + 1;
      candidate := base || '-' || substr(r.id::text, 1, 4 + n);
    END LOOP;
    UPDATE public.videos SET slug = candidate WHERE id = r.id;
  END LOOP;
END $$;

-- Enforce uniqueness going forward
CREATE UNIQUE INDEX IF NOT EXISTS videos_slug_key ON public.videos(slug);

-- Auto-slug on insert/update when null
CREATE OR REPLACE FUNCTION public.videos_autoslug()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base text; candidate text; n int := 0;
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    base := NULLIF(public.slugify(NEW.title), '');
    IF base IS NULL THEN base := 'video'; END IF;
    candidate := base;
    WHILE EXISTS (SELECT 1 FROM public.videos WHERE slug = candidate AND id <> NEW.id) LOOP
      n := n + 1;
      candidate := base || '-' || substr(coalesce(NEW.id::text, gen_random_uuid()::text), 1, 4 + n);
    END LOOP;
    NEW.slug := candidate;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS videos_autoslug_trg ON public.videos;
CREATE TRIGGER videos_autoslug_trg BEFORE INSERT OR UPDATE ON public.videos
  FOR EACH ROW EXECUTE FUNCTION public.videos_autoslug();
