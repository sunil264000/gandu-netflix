
-- Videos bucket policies
CREATE POLICY "videos read auth" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'videos');
CREATE POLICY "videos write admin" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'videos' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "videos update admin" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'videos' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "videos delete admin" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'videos' AND public.has_role(auth.uid(), 'admin'));

-- Thumbnails bucket policies
CREATE POLICY "thumbs read auth" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'thumbnails');
CREATE POLICY "thumbs write admin" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'thumbnails' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "thumbs update admin" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'thumbnails' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "thumbs delete admin" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'thumbnails' AND public.has_role(auth.uid(), 'admin'));
