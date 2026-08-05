
-- Categories
CREATE TABLE public.categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read categories" ON public.categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage categories" ON public.categories FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Videos
CREATE TABLE public.videos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  storage_path TEXT NOT NULL,
  thumbnail_path TEXT,
  mime_type TEXT,
  extension TEXT,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  duration_sec NUMERIC,
  width INT,
  height INT,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  view_count BIGINT NOT NULL DEFAULT 0,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX videos_created_at_idx ON public.videos (created_at DESC);
CREATE INDEX videos_category_idx ON public.videos (category_id);
CREATE INDEX videos_views_idx ON public.videos (view_count DESC);
CREATE INDEX videos_title_idx ON public.videos USING gin (to_tsvector('english', title || ' ' || coalesce(description, '')));
GRANT SELECT ON public.videos TO authenticated;
GRANT ALL ON public.videos TO service_role;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read videos" ON public.videos FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage videos" ON public.videos FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER videos_updated_at BEFORE UPDATE ON public.videos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Watch history (resume + most-watched)
CREATE TABLE public.watch_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  position_sec NUMERIC NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, video_id)
);
CREATE INDEX watch_history_user_updated_idx ON public.watch_history (user_id, updated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.watch_history TO authenticated;
GRANT ALL ON public.watch_history TO service_role;
ALTER TABLE public.watch_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own watch history" ON public.watch_history FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER watch_history_updated_at BEFORE UPDATE ON public.watch_history FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Favorites
CREATE TABLE public.favorites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, video_id)
);
CREATE INDEX favorites_user_idx ON public.favorites (user_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.favorites TO authenticated;
GRANT ALL ON public.favorites TO service_role;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own favorites" ON public.favorites FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- View increment RPC (bypasses direct table write)
CREATE OR REPLACE FUNCTION public.increment_video_view(_video_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE public.videos SET view_count = view_count + 1 WHERE id = _video_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_video_view(UUID) TO authenticated;

-- Seed default categories
INSERT INTO public.categories (name, slug) VALUES
  ('Movies', 'movies'),
  ('Shows', 'shows'),
  ('Clips', 'clips'),
  ('Other', 'other');
