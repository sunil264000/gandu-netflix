
CREATE POLICY "anon_all_videos" ON storage.objects FOR ALL TO anon
  USING (bucket_id IN ('videos','thumbnails'))
  WITH CHECK (bucket_id IN ('videos','thumbnails'));
CREATE POLICY "auth_all_videos" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id IN ('videos','thumbnails'))
  WITH CHECK (bucket_id IN ('videos','thumbnails'));
