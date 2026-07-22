REVOKE EXECUTE ON FUNCTION public.increment_video_view(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_video_view(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_video_view(uuid) FROM authenticated;