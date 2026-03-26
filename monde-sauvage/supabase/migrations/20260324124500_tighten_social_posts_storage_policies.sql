-- Keep social-posts storage permissions aligned with guides-only posting.
-- This migration is additive to avoid mutating previously applied migrations.

DROP POLICY IF EXISTS social_posts_storage_update_guide ON storage.objects;
CREATE POLICY social_posts_storage_update_guide ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'social-posts'
    AND split_part(name, '/', 1) = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM guide g
      WHERE g.user_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'social-posts'
    AND split_part(name, '/', 1) = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM guide g
      WHERE g.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS social_posts_storage_delete_guide ON storage.objects;
CREATE POLICY social_posts_storage_delete_guide ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'social-posts'
    AND split_part(name, '/', 1) = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM guide g
      WHERE g.user_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
