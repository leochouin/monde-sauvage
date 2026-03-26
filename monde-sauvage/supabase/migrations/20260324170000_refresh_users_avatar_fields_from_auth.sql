DO $$
DECLARE
  users_has_email boolean;
  users_has_display_name boolean;
  users_has_name boolean;
  users_has_full_name boolean;
  users_has_avatar_url boolean;
  users_has_photo_url boolean;
  users_has_picture boolean;
  users_has_google_avatar boolean;
  users_has_google_avatar_url boolean;
  users_has_profile_photo_url boolean;
  users_has_image_url boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'email'
  ) INTO users_has_email;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'display_name'
  ) INTO users_has_display_name;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'name'
  ) INTO users_has_name;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'full_name'
  ) INTO users_has_full_name;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'avatar_url'
  ) INTO users_has_avatar_url;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'photo_url'
  ) INTO users_has_photo_url;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'picture'
  ) INTO users_has_picture;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'google_avatar'
  ) INTO users_has_google_avatar;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'google_avatar_url'
  ) INTO users_has_google_avatar_url;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'profile_photo_url'
  ) INTO users_has_profile_photo_url;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'image_url'
  ) INTO users_has_image_url;

  EXECUTE format($sql$
    WITH auth_source AS (
      SELECT
        au.id,
        NULLIF(TRIM(COALESCE(au.email, '')), '') AS auth_email,
        NULLIF(TRIM(COALESCE(
          au.raw_user_meta_data ->> 'full_name',
          au.raw_user_meta_data ->> 'name',
          au.raw_user_meta_data ->> 'display_name',
          au.raw_user_meta_data ->> 'given_name'
        )), '') AS auth_name,
        NULLIF(TRIM(COALESCE(
          au.raw_user_meta_data ->> 'avatar_url',
          au.raw_user_meta_data ->> 'photo_url',
          au.raw_user_meta_data ->> 'picture',
          au.raw_user_meta_data ->> 'google_avatar',
          au.raw_user_meta_data ->> 'google_avatar_url',
          au.raw_user_meta_data ->> 'profile_photo_url',
          au.raw_user_meta_data ->> 'image_url'
        )), '') AS auth_avatar,
        NULLIF(TRIM(COALESCE(au.raw_user_meta_data ->> 'photo_url', '')), '') AS auth_photo_url,
        NULLIF(TRIM(COALESCE(au.raw_user_meta_data ->> 'picture', '')), '') AS auth_picture,
        NULLIF(TRIM(COALESCE(au.raw_user_meta_data ->> 'google_avatar', '')), '') AS auth_google_avatar,
        NULLIF(TRIM(COALESCE(au.raw_user_meta_data ->> 'google_avatar_url', '')), '') AS auth_google_avatar_url,
        NULLIF(TRIM(COALESCE(au.raw_user_meta_data ->> 'profile_photo_url', '')), '') AS auth_profile_photo_url,
        NULLIF(TRIM(COALESCE(au.raw_user_meta_data ->> 'image_url', '')), '') AS auth_image_url
      FROM auth.users au
    )
    UPDATE public.users u
    SET
      %1$s
      %2$s
      %3$s
      %4$s
      %5$s
      %6$s
      %7$s
      %8$s
      %9$s
      %10$s
      %11$s
    FROM auth_source src
    WHERE u.id = src.id
      AND (
        %12$s
        %13$s
        %14$s
        %15$s
        %16$s
        %17$s
        %18$s
        %19$s
        %20$s
        %21$s
        %22$s
      )
  $sql$,
    CASE WHEN users_has_email THEN
      'email = CASE WHEN src.auth_email IS NOT NULL THEN src.auth_email ELSE u.email END,'
    ELSE '' END,
    CASE WHEN users_has_display_name THEN
      'display_name = CASE WHEN src.auth_name IS NOT NULL THEN src.auth_name ELSE u.display_name END,'
    ELSE '' END,
    CASE WHEN users_has_name THEN
      'name = CASE WHEN src.auth_name IS NOT NULL THEN src.auth_name ELSE u.name END,'
    ELSE '' END,
    CASE WHEN users_has_full_name THEN
      'full_name = CASE WHEN src.auth_name IS NOT NULL THEN src.auth_name ELSE u.full_name END,'
    ELSE '' END,
    CASE WHEN users_has_avatar_url THEN
      'avatar_url = CASE WHEN src.auth_avatar IS NOT NULL THEN src.auth_avatar ELSE u.avatar_url END,'
    ELSE '' END,
    CASE WHEN users_has_photo_url THEN
      'photo_url = CASE WHEN src.auth_photo_url IS NOT NULL THEN src.auth_photo_url ELSE u.photo_url END,'
    ELSE '' END,
    CASE WHEN users_has_picture THEN
      'picture = CASE WHEN src.auth_picture IS NOT NULL THEN src.auth_picture ELSE u.picture END,'
    ELSE '' END,
    CASE WHEN users_has_google_avatar THEN
      'google_avatar = CASE WHEN src.auth_google_avatar IS NOT NULL THEN src.auth_google_avatar ELSE u.google_avatar END,'
    ELSE '' END,
    CASE WHEN users_has_google_avatar_url THEN
      'google_avatar_url = CASE WHEN src.auth_google_avatar_url IS NOT NULL THEN src.auth_google_avatar_url ELSE u.google_avatar_url END,'
    ELSE '' END,
    CASE WHEN users_has_profile_photo_url THEN
      'profile_photo_url = CASE WHEN src.auth_profile_photo_url IS NOT NULL THEN src.auth_profile_photo_url ELSE u.profile_photo_url END,'
    ELSE '' END,
    CASE WHEN users_has_image_url THEN
      'image_url = CASE WHEN src.auth_image_url IS NOT NULL THEN src.auth_image_url ELSE u.image_url END'
    ELSE 'id = u.id' END,

    CASE WHEN users_has_email THEN
      '(src.auth_email IS NOT NULL AND NULLIF(TRIM(COALESCE(u.email, '''')), '''') IS DISTINCT FROM src.auth_email) OR'
    ELSE '' END,
    CASE WHEN users_has_display_name THEN
      '(src.auth_name IS NOT NULL AND NULLIF(TRIM(COALESCE(u.display_name, '''')), '''') IS DISTINCT FROM src.auth_name) OR'
    ELSE '' END,
    CASE WHEN users_has_name THEN
      '(src.auth_name IS NOT NULL AND NULLIF(TRIM(COALESCE(u.name, '''')), '''') IS DISTINCT FROM src.auth_name) OR'
    ELSE '' END,
    CASE WHEN users_has_full_name THEN
      '(src.auth_name IS NOT NULL AND NULLIF(TRIM(COALESCE(u.full_name, '''')), '''') IS DISTINCT FROM src.auth_name) OR'
    ELSE '' END,
    CASE WHEN users_has_avatar_url THEN
      '(src.auth_avatar IS NOT NULL AND NULLIF(TRIM(COALESCE(u.avatar_url, '''')), '''') IS DISTINCT FROM src.auth_avatar) OR'
    ELSE '' END,
    CASE WHEN users_has_photo_url THEN
      '(src.auth_photo_url IS NOT NULL AND NULLIF(TRIM(COALESCE(u.photo_url, '''')), '''') IS DISTINCT FROM src.auth_photo_url) OR'
    ELSE '' END,
    CASE WHEN users_has_picture THEN
      '(src.auth_picture IS NOT NULL AND NULLIF(TRIM(COALESCE(u.picture, '''')), '''') IS DISTINCT FROM src.auth_picture) OR'
    ELSE '' END,
    CASE WHEN users_has_google_avatar THEN
      '(src.auth_google_avatar IS NOT NULL AND NULLIF(TRIM(COALESCE(u.google_avatar, '''')), '''') IS DISTINCT FROM src.auth_google_avatar) OR'
    ELSE '' END,
    CASE WHEN users_has_google_avatar_url THEN
      '(src.auth_google_avatar_url IS NOT NULL AND NULLIF(TRIM(COALESCE(u.google_avatar_url, '''')), '''') IS DISTINCT FROM src.auth_google_avatar_url) OR'
    ELSE '' END,
    CASE WHEN users_has_profile_photo_url THEN
      '(src.auth_profile_photo_url IS NOT NULL AND NULLIF(TRIM(COALESCE(u.profile_photo_url, '''')), '''') IS DISTINCT FROM src.auth_profile_photo_url) OR'
    ELSE '' END,
    CASE WHEN users_has_image_url THEN
      '(src.auth_image_url IS NOT NULL AND NULLIF(TRIM(COALESCE(u.image_url, '''')), '''') IS DISTINCT FROM src.auth_image_url)'
    ELSE 'false' END
  );
END $$;