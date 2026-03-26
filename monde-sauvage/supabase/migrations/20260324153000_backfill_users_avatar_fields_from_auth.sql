-- Backfill public.users avatar/name fields from auth.users metadata when columns exist.
-- Safe no-op for columns that are not present in the current schema.

DO $$
DECLARE
  has_users_table BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'users'
  ) INTO has_users_table;

  IF NOT has_users_table THEN
    RAISE NOTICE 'Skipping users avatar backfill: public.users does not exist.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'avatar_url'
  ) THEN
    EXECUTE $sql$
      UPDATE public.users u
      SET avatar_url = COALESCE(
        NULLIF(u.avatar_url, ''),
        NULLIF(au.raw_user_meta_data->>'avatar_url', ''),
        NULLIF(au.raw_user_meta_data->>'photo_url', ''),
        NULLIF(au.raw_user_meta_data->>'picture', ''),
        NULLIF(au.raw_user_meta_data->>'google_avatar', ''),
        NULLIF(au.raw_user_meta_data->>'google_avatar_url', ''),
        NULLIF(au.raw_user_meta_data->>'profile_photo_url', ''),
        NULLIF(au.raw_user_meta_data->>'image_url', '')
      )
      FROM auth.users au
      WHERE au.id = u.id
        AND COALESCE(NULLIF(u.avatar_url, ''), '') = ''
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'photo_url'
  ) THEN
    EXECUTE $sql$
      UPDATE public.users u
      SET photo_url = COALESCE(
        NULLIF(u.photo_url, ''),
        NULLIF(au.raw_user_meta_data->>'photo_url', ''),
        NULLIF(au.raw_user_meta_data->>'avatar_url', ''),
        NULLIF(au.raw_user_meta_data->>'picture', ''),
        NULLIF(au.raw_user_meta_data->>'image_url', '')
      )
      FROM auth.users au
      WHERE au.id = u.id
        AND COALESCE(NULLIF(u.photo_url, ''), '') = ''
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'picture'
  ) THEN
    EXECUTE $sql$
      UPDATE public.users u
      SET picture = COALESCE(
        NULLIF(u.picture, ''),
        NULLIF(au.raw_user_meta_data->>'picture', ''),
        NULLIF(au.raw_user_meta_data->>'avatar_url', ''),
        NULLIF(au.raw_user_meta_data->>'photo_url', ''),
        NULLIF(au.raw_user_meta_data->>'image_url', '')
      )
      FROM auth.users au
      WHERE au.id = u.id
        AND COALESCE(NULLIF(u.picture, ''), '') = ''
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'google_avatar'
  ) THEN
    EXECUTE $sql$
      UPDATE public.users u
      SET google_avatar = COALESCE(
        NULLIF(u.google_avatar, ''),
        NULLIF(au.raw_user_meta_data->>'google_avatar', ''),
        NULLIF(au.raw_user_meta_data->>'google_avatar_url', ''),
        NULLIF(au.raw_user_meta_data->>'picture', ''),
        NULLIF(au.raw_user_meta_data->>'avatar_url', '')
      )
      FROM auth.users au
      WHERE au.id = u.id
        AND COALESCE(NULLIF(u.google_avatar, ''), '') = ''
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'google_avatar_url'
  ) THEN
    EXECUTE $sql$
      UPDATE public.users u
      SET google_avatar_url = COALESCE(
        NULLIF(u.google_avatar_url, ''),
        NULLIF(au.raw_user_meta_data->>'google_avatar_url', ''),
        NULLIF(au.raw_user_meta_data->>'google_avatar', ''),
        NULLIF(au.raw_user_meta_data->>'picture', ''),
        NULLIF(au.raw_user_meta_data->>'avatar_url', '')
      )
      FROM auth.users au
      WHERE au.id = u.id
        AND COALESCE(NULLIF(u.google_avatar_url, ''), '') = ''
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'profile_photo_url'
  ) THEN
    EXECUTE $sql$
      UPDATE public.users u
      SET profile_photo_url = COALESCE(
        NULLIF(u.profile_photo_url, ''),
        NULLIF(au.raw_user_meta_data->>'profile_photo_url', ''),
        NULLIF(au.raw_user_meta_data->>'avatar_url', ''),
        NULLIF(au.raw_user_meta_data->>'photo_url', ''),
        NULLIF(au.raw_user_meta_data->>'picture', '')
      )
      FROM auth.users au
      WHERE au.id = u.id
        AND COALESCE(NULLIF(u.profile_photo_url, ''), '') = ''
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'image_url'
  ) THEN
    EXECUTE $sql$
      UPDATE public.users u
      SET image_url = COALESCE(
        NULLIF(u.image_url, ''),
        NULLIF(au.raw_user_meta_data->>'image_url', ''),
        NULLIF(au.raw_user_meta_data->>'avatar_url', ''),
        NULLIF(au.raw_user_meta_data->>'photo_url', ''),
        NULLIF(au.raw_user_meta_data->>'picture', '')
      )
      FROM auth.users au
      WHERE au.id = u.id
        AND COALESCE(NULLIF(u.image_url, ''), '') = ''
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'display_name'
  ) THEN
    EXECUTE $sql$
      UPDATE public.users u
      SET display_name = COALESCE(
        NULLIF(u.display_name, ''),
        NULLIF(au.raw_user_meta_data->>'full_name', ''),
        NULLIF(au.raw_user_meta_data->>'name', '')
      )
      FROM auth.users au
      WHERE au.id = u.id
        AND COALESCE(NULLIF(u.display_name, ''), '') = ''
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'name'
  ) THEN
    EXECUTE $sql$
      UPDATE public.users u
      SET name = COALESCE(
        NULLIF(u.name, ''),
        NULLIF(au.raw_user_meta_data->>'full_name', ''),
        NULLIF(au.raw_user_meta_data->>'name', '')
      )
      FROM auth.users au
      WHERE au.id = u.id
        AND COALESCE(NULLIF(u.name, ''), '') = ''
    $sql$;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
