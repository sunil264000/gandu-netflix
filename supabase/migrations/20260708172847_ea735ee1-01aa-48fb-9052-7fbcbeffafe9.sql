
-- Lock down archives table to admins only
DROP POLICY IF EXISTS "Anyone can view archives" ON public.archives;
DROP POLICY IF EXISTS "Anyone can insert archives" ON public.archives;
DROP POLICY IF EXISTS "Anyone can delete archives" ON public.archives;

CREATE POLICY "Admins manage archives"
ON public.archives
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Lock down archives storage bucket to admins only
DROP POLICY IF EXISTS "Anyone can read archives bucket" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload to archives bucket" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete from archives bucket" ON storage.objects;

CREATE POLICY "Admins read archives bucket"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'archives' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins upload to archives bucket"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'archives' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update archives bucket"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'archives' AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'archives' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete from archives bucket"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'archives' AND public.has_role(auth.uid(), 'admin'));
