-- Social feed MVP for guides
-- Supports future extension to verified-client posting via author_type.

CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL DEFAULT 'guide' CHECK (author_type IN ('guide', 'verified_client')),
  content TEXT NOT NULL CHECK (char_length(trim(content)) BETWEEN 1 AND 3000),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS social_post_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  public_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, sort_order)
);

CREATE TABLE IF NOT EXISTS social_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(trim(content)) BETWEEN 1 AND 1500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS social_follows (
  follower_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  followed_guide_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_user_id, followed_guide_user_id),
  CHECK (follower_user_id <> followed_guide_user_id)
);

CREATE INDEX IF NOT EXISTS idx_social_posts_created_at_desc ON social_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_posts_author_created_at ON social_posts(author_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_posts_visible ON social_posts(status, created_at DESC)
  WHERE status = 'published' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_social_post_images_post_sort ON social_post_images(post_id, sort_order ASC);

CREATE INDEX IF NOT EXISTS idx_social_comments_post_created ON social_comments(post_id, created_at ASC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_social_comments_author_created ON social_comments(author_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_social_follows_followed ON social_follows(followed_guide_user_id);

DROP TRIGGER IF EXISTS update_social_posts_updated_at ON social_posts;
CREATE TRIGGER update_social_posts_updated_at
  BEFORE UPDATE ON social_posts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_social_comments_updated_at ON social_comments;
CREATE TRIGGER update_social_comments_updated_at
  BEFORE UPDATE ON social_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE social_posts IS 'Social feed posts authored by user accounts. Currently restricted to guides via RLS.';
COMMENT ON TABLE social_post_images IS 'Images attached to social feed posts. Ordered by sort_order.';
COMMENT ON TABLE social_comments IS 'Comments on social feed posts.';
COMMENT ON TABLE social_follows IS 'Follower -> guide follow relationship for following feed.';

ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_post_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_posts_select_public ON social_posts;
CREATE POLICY social_posts_select_public ON social_posts
  FOR SELECT TO authenticated, anon
  USING (status = 'published' AND deleted_at IS NULL);

DROP POLICY IF EXISTS social_posts_insert_guides_only ON social_posts;
CREATE POLICY social_posts_insert_guides_only ON social_posts
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = author_user_id
    AND author_type = 'guide'
    AND EXISTS (
      SELECT 1 FROM guide g
      WHERE g.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS social_posts_update_own ON social_posts;
CREATE POLICY social_posts_update_own ON social_posts
  FOR UPDATE TO authenticated
  USING (auth.uid() = author_user_id)
  WITH CHECK (auth.uid() = author_user_id);

DROP POLICY IF EXISTS social_posts_delete_own ON social_posts;
CREATE POLICY social_posts_delete_own ON social_posts
  FOR DELETE TO authenticated
  USING (auth.uid() = author_user_id);

DROP POLICY IF EXISTS social_post_images_select_public ON social_post_images;
CREATE POLICY social_post_images_select_public ON social_post_images
  FOR SELECT TO authenticated, anon
  USING (
    EXISTS (
      SELECT 1
      FROM social_posts p
      WHERE p.id = social_post_images.post_id
        AND p.status = 'published'
        AND p.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS social_post_images_insert_own_post ON social_post_images;
CREATE POLICY social_post_images_insert_own_post ON social_post_images
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM social_posts p
      WHERE p.id = social_post_images.post_id
        AND p.author_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS social_post_images_update_own_post ON social_post_images;
CREATE POLICY social_post_images_update_own_post ON social_post_images
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM social_posts p
      WHERE p.id = social_post_images.post_id
        AND p.author_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM social_posts p
      WHERE p.id = social_post_images.post_id
        AND p.author_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS social_post_images_delete_own_post ON social_post_images;
CREATE POLICY social_post_images_delete_own_post ON social_post_images
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM social_posts p
      WHERE p.id = social_post_images.post_id
        AND p.author_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS social_comments_select_public ON social_comments;
CREATE POLICY social_comments_select_public ON social_comments
  FOR SELECT TO authenticated, anon
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM social_posts p
      WHERE p.id = social_comments.post_id
        AND p.status = 'published'
        AND p.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS social_comments_insert_authenticated ON social_comments;
CREATE POLICY social_comments_insert_authenticated ON social_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = author_user_id
    AND EXISTS (
      SELECT 1
      FROM social_posts p
      WHERE p.id = social_comments.post_id
        AND p.status = 'published'
        AND p.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS social_comments_update_own ON social_comments;
CREATE POLICY social_comments_update_own ON social_comments
  FOR UPDATE TO authenticated
  USING (auth.uid() = author_user_id)
  WITH CHECK (auth.uid() = author_user_id);

DROP POLICY IF EXISTS social_comments_delete_own ON social_comments;
CREATE POLICY social_comments_delete_own ON social_comments
  FOR DELETE TO authenticated
  USING (auth.uid() = author_user_id);

DROP POLICY IF EXISTS social_follows_select_own ON social_follows;
CREATE POLICY social_follows_select_own ON social_follows
  FOR SELECT TO authenticated
  USING (auth.uid() = follower_user_id);

DROP POLICY IF EXISTS social_follows_insert_own ON social_follows;
CREATE POLICY social_follows_insert_own ON social_follows
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = follower_user_id
    AND EXISTS (
      SELECT 1
      FROM guide g
      WHERE g.user_id = followed_guide_user_id
    )
  );

DROP POLICY IF EXISTS social_follows_delete_own ON social_follows;
CREATE POLICY social_follows_delete_own ON social_follows
  FOR DELETE TO authenticated
  USING (auth.uid() = follower_user_id);

GRANT SELECT ON social_posts TO anon;
GRANT SELECT ON social_posts TO authenticated;
GRANT INSERT, UPDATE, DELETE ON social_posts TO authenticated;

GRANT SELECT ON social_post_images TO anon;
GRANT SELECT ON social_post_images TO authenticated;
GRANT INSERT, UPDATE, DELETE ON social_post_images TO authenticated;

GRANT SELECT ON social_comments TO anon;
GRANT SELECT ON social_comments TO authenticated;
GRANT INSERT, UPDATE, DELETE ON social_comments TO authenticated;

GRANT SELECT, INSERT, DELETE ON social_follows TO authenticated;

CREATE OR REPLACE VIEW social_posts_feed AS
SELECT
  p.id,
  p.author_user_id,
  p.author_type,
  p.content,
  p.created_at,
  p.updated_at,
  g.id AS guide_id,
  g.name AS guide_name,
  g.bio AS guide_bio,
  g.hourly_rate AS guide_hourly_rate,
  g.fish_types AS guide_fish_types,
  COALESCE(c.comment_count, 0)::INTEGER AS comment_count
FROM social_posts p
LEFT JOIN guide g ON g.user_id = p.author_user_id
LEFT JOIN (
  SELECT post_id, COUNT(*) AS comment_count
  FROM social_comments
  WHERE deleted_at IS NULL
  GROUP BY post_id
) c ON c.post_id = p.id
WHERE p.status = 'published' AND p.deleted_at IS NULL;

GRANT SELECT ON social_posts_feed TO anon;
GRANT SELECT ON social_posts_feed TO authenticated;

INSERT INTO storage.buckets (id, name, public)
VALUES ('social-posts', 'social-posts', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS social_posts_storage_read ON storage.objects;
CREATE POLICY social_posts_storage_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'social-posts');

DROP POLICY IF EXISTS social_posts_storage_insert_guide ON storage.objects;
CREATE POLICY social_posts_storage_insert_guide ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'social-posts'
    AND split_part(name, '/', 1) = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM guide g
      WHERE g.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS social_posts_storage_update_guide ON storage.objects;
CREATE POLICY social_posts_storage_update_guide ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'social-posts'
    AND split_part(name, '/', 1) = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'social-posts'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS social_posts_storage_delete_guide ON storage.objects;
CREATE POLICY social_posts_storage_delete_guide ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'social-posts'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

NOTIFY pgrst, 'reload schema';
