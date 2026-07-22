CREATE OR REPLACE FUNCTION public.increment_video_view_admin(_video_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.videos SET view_count = view_count + 1 WHERE id = _video_id;
$$;

REVOKE ALL ON FUNCTION public.increment_video_view_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_video_view_admin(uuid) TO service_role;