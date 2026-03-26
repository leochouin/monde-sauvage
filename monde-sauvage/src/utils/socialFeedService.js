import supabase from './supabase.js';
import {
  getAvatarRawValueFromSources,
  getAvatarVersionKeyFromSources,
  resolveAvatarFromSources,
  resolveAvatarSource,
} from './avatar.js';

export const SOCIAL_POSTS_BUCKET = 'social-posts';
export const MAX_POST_LENGTH = 3000;
export const MAX_COMMENT_LENGTH = 1500;
export const MAX_POST_IMAGES = 6;
export const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const USER_ROW_CACHE_TTL_MS = 5 * 60 * 1000;
const userRowCache = new Map();

const sanitizeFileName = (name = '') => (
  name
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'image'
);

const toIso = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString();
};

const trimText = (value) => (typeof value === 'string' ? value.trim() : '');

const assertAuthenticatedUser = async () => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!user?.id) throw new Error('Vous devez etre connecte pour continuer.');
  return user;
};

const getAuthenticatedUserSafe = async () => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) {
    console.warn('Unable to load authenticated user for social avatar fallback:', error.message);
    return null;
  }
  return user || null;
};

const buildInitials = (name) => {
  const source = trimText(name);
  if (!source) return 'GU';
  return source
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'GU';
};

export const isGuideUser = async (userId) => {
  if (!userId) return false;

  const { data, error } = await supabase
    .from('guide')
    .select('id')
    .eq('user_id', userId)
    .limit(1);

  if (error) {
    throw new Error(`Impossible de verifier le statut guide: ${error.message}`);
  }

  return Boolean(data && data.length > 0);
};

const validatePostContent = (content) => {
  const text = trimText(content);
  if (!text) {
    throw new Error('Le contenu de la publication est requis.');
  }
  if (text.length > MAX_POST_LENGTH) {
    throw new Error(`Le contenu depasse ${MAX_POST_LENGTH} caracteres.`);
  }
  return text;
};

const validateCommentContent = (content) => {
  const text = trimText(content);
  if (!text) {
    throw new Error('Le commentaire ne peut pas etre vide.');
  }
  if (text.length > MAX_COMMENT_LENGTH) {
    throw new Error(`Le commentaire depasse ${MAX_COMMENT_LENGTH} caracteres.`);
  }
  return text;
};

const validateImages = (files) => {
  const normalizedFiles = Array.isArray(files) ? files.filter(Boolean) : [];

  if (normalizedFiles.length > MAX_POST_IMAGES) {
    throw new Error(`Vous pouvez joindre au maximum ${MAX_POST_IMAGES} images.`);
  }

  normalizedFiles.forEach((file) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      throw new Error('Format image non supporte. Utilisez JPG, PNG, WEBP ou GIF.');
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      throw new Error('Chaque image doit faire moins de 8 MB.');
    }
  });

  return normalizedFiles;
};

const fetchGuidesByUserIds = async (userIds = []) => {
  if (!userIds.length) return new Map();

  const { data, error } = await supabase
    .from('guide')
    .select('*')
    .in('user_id', userIds);

  if (error) {
    throw new Error(`Impossible de charger les profils guides: ${error.message}`);
  }

  const guideMap = new Map();
  (data || []).forEach((guide) => {
    guideMap.set(guide.user_id, guide);
  });
  return guideMap;
};

const fetchUserRows = async (userIds = []) => {
  if (!userIds.length) return new Map();

  const now = Date.now();
  const userMap = new Map();
  const missingIds = [];

  userIds.forEach((userId) => {
    const cached = userRowCache.get(userId);
    if (cached && cached.expiresAt > now) {
      userMap.set(userId, cached.row);
      return;
    }

    if (cached) {
      userRowCache.delete(userId);
    }
    missingIds.push(userId);
  });

  if (!missingIds.length) {
    return userMap;
  }

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .in('id', missingIds);

  if (error) {
    // Some environments restrict direct reads on the users table.
    // Feed rendering should still work with guide data and cached rows.
    console.warn('Unable to load users rows for social feed:', error.message);
    return userMap;
  }

  (data || []).forEach((user) => {
    userMap.set(user.id, user);
    userRowCache.set(user.id, {
      row: user,
      expiresAt: Date.now() + USER_ROW_CACHE_TTL_MS,
    });
  });

  return userMap;
};

const enrichUserMapWithAuthenticatedUser = ({ userMap, authenticatedUser, targetUserIds = [] }) => {
  if (!authenticatedUser?.id) return userMap;

  const shouldInclude = targetUserIds.length === 0 || targetUserIds.includes(authenticatedUser.id);
  if (!shouldInclude) return userMap;

  const existing = userMap.get(authenticatedUser.id) || {};
  userMap.set(authenticatedUser.id, {
    ...existing,
    ...authenticatedUser,
  });
  return userMap;
};

const buildAuthorViewModel = ({ authorUserId, guideMap, userMap }) => {
  if (!authorUserId) {
    return {
      userId: null,
      guideId: null,
      name: 'Guide',
      bio: '',
      fishTypes: [],
      hourlyRate: null,
      initials: 'GU',
      hasGuideProfile: false,
      avatarRawValue: '',
      avatarVersionKey: '',
      avatarSrc: '',
    };
  }

  const guide = guideMap.get(authorUserId);
  const user = userMap.get(authorUserId);
  const displayName = trimText(guide?.name) || trimText(user?.email?.split('@')[0]) || 'Guide';
  const avatarRawValue = getAvatarRawValueFromSources(guide, user);
  const avatarVersionKey = getAvatarVersionKeyFromSources(guide, user);

  return {
    userId: authorUserId,
    guideId: guide?.id || null,
    name: displayName,
    bio: guide?.bio || '',
    fishTypes: guide?.fish_types || [],
    hourlyRate: guide?.hourly_rate || null,
    initials: buildInitials(displayName),
    hasGuideProfile: Boolean(guide?.id),
    avatarRawValue,
    avatarVersionKey,
    avatarSrc: '',
  };
};

const resolveAuthorAvatar = async (author) => {
  if (!author?.avatarRawValue) {
    return author;
  }

  const avatarSrc = await resolveAvatarSource(author.avatarRawValue, {
    supabase,
    versionKey: author.avatarVersionKey,
  });

  return {
    ...author,
    avatarSrc,
  };
};

const createResolvedAuthorLoader = ({ guideMap, userMap, resolveAvatars = true }) => {
  const cache = new Map();

  return (authorUserId) => {
    const cacheKey = authorUserId || '__missing__';
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    const viewModel = buildAuthorViewModel({
      authorUserId,
      guideMap,
      userMap,
    });

    const pending = resolveAvatars
      ? resolveAuthorAvatar(viewModel)
      : Promise.resolve(viewModel);

    cache.set(cacheKey, pending);
    return pending;
  };
};

const authorAvatarPromiseCache = new Map();

const resolveAuthorAvatarCached = (author) => {
  if (!author?.avatarRawValue || author?.avatarSrc) {
    return Promise.resolve(author);
  }

  const cacheKey = `${author.userId || '__missing__'}|${author.avatarRawValue}|${author.avatarVersionKey || ''}`;
  if (authorAvatarPromiseCache.has(cacheKey)) {
    return authorAvatarPromiseCache.get(cacheKey);
  }

  const pending = resolveAuthorAvatar(author)
    .finally(() => {
      authorAvatarPromiseCache.delete(cacheKey);
    });

  authorAvatarPromiseCache.set(cacheKey, pending);
  return pending;
};

export const hydrateFeedAuthorAvatars = async (posts = []) => {
  const list = Array.isArray(posts) ? posts : [];
  if (!list.length) return list;

  const authorsByUserId = new Map();
  list.forEach((post) => {
    const author = post?.author;
    if (!author?.userId || !author.avatarRawValue || author.avatarSrc) return;
    if (!authorsByUserId.has(author.userId)) {
      authorsByUserId.set(author.userId, author);
    }
  });

  if (!authorsByUserId.size) return list;

  const resolvedAuthors = await Promise.all(
    [...authorsByUserId.values()].map((author) => resolveAuthorAvatarCached(author))
  );
  const avatarByUserId = new Map(
    resolvedAuthors
      .filter((author) => author?.userId && author?.avatarSrc)
      .map((author) => [author.userId, author.avatarSrc])
  );

  if (!avatarByUserId.size) return list;

  return list.map((post) => {
    const currentAuthor = post?.author;
    const resolvedAvatar = avatarByUserId.get(currentAuthor?.userId);
    if (!resolvedAvatar || currentAuthor?.avatarSrc === resolvedAvatar) {
      return post;
    }

    return {
      ...post,
      author: {
        ...currentAuthor,
        avatarSrc: resolvedAvatar,
      },
    };
  });
};

const fetchPostImages = async (postIds = []) => {
  if (!postIds.length) return new Map();

  const { data, error } = await supabase
    .from('social_post_images')
    .select('id, post_id, storage_path, public_url, sort_order')
    .in('post_id', postIds)
    .order('sort_order', { ascending: true });

  if (error) {
    throw new Error(`Impossible de charger les images des publications: ${error.message}`);
  }

  const imageMap = new Map();
  (data || []).forEach((image) => {
    const list = imageMap.get(image.post_id) || [];
    list.push({
      id: image.id,
      storagePath: image.storage_path,
      url: image.public_url,
      sortOrder: image.sort_order,
    });
    imageMap.set(image.post_id, list);
  });

  return imageMap;
};

const fetchFollowedGuideUserIds = async (currentUserId) => {
  if (!currentUserId) return new Set();

  const { data, error } = await supabase
    .from('social_follows')
    .select('followed_guide_user_id')
    .eq('follower_user_id', currentUserId);

  if (error) {
    throw new Error(`Impossible de charger les abonnements: ${error.message}`);
  }

  return new Set((data || []).map((row) => row.followed_guide_user_id));
};

export const getGlobalFeed = async ({ currentUserId = null, limit = 30, resolveAvatars = false } = {}) => {
  const { data: baseRows, error } = await supabase
    .from('social_posts_feed')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Impossible de charger le fil: ${error.message}`);
  }

  const posts = baseRows || [];
  const postIds = posts.map((post) => post.id);
  const authorUserIds = [...new Set(posts.map((post) => post.author_user_id).filter(Boolean))];

  const [imageMap, guideMap, userMap, followedGuideUserIds, authenticatedUser] = await Promise.all([
    fetchPostImages(postIds),
    fetchGuidesByUserIds(authorUserIds),
    fetchUserRows(authorUserIds),
    fetchFollowedGuideUserIds(currentUserId),
    getAuthenticatedUserSafe(),
  ]);

  enrichUserMapWithAuthenticatedUser({
    userMap,
    authenticatedUser,
    targetUserIds: authorUserIds,
  });

  const loadResolvedAuthor = createResolvedAuthorLoader({
    guideMap,
    userMap,
    resolveAvatars,
  });

  return Promise.all(posts.map(async (post) => {
    const author = await loadResolvedAuthor(post.author_user_id);

    return {
      id: post.id,
      content: post.content,
      createdAt: toIso(post.created_at),
      updatedAt: toIso(post.updated_at),
      authorType: post.author_type,
      commentCount: Number(post.comment_count || 0),
      images: imageMap.get(post.id) || [],
      author,
      isFollowingAuthor: followedGuideUserIds.has(post.author_user_id),
    };
  }));
};

export const getFollowingFeed = async ({ currentUserId, limit = 30, resolveAvatars = false } = {}) => {
  if (!currentUserId) return [];

  const followedGuideUserIds = await fetchFollowedGuideUserIds(currentUserId);
  const followedList = [...followedGuideUserIds];

  if (!followedList.length) {
    return [];
  }

  const { data: rows, error } = await supabase
    .from('social_posts_feed')
    .select('*')
    .in('author_user_id', followedList)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Impossible de charger le fil des abonnements: ${error.message}`);
  }

  const posts = rows || [];
  const postIds = posts.map((post) => post.id);
  const authorUserIds = [...new Set(posts.map((post) => post.author_user_id).filter(Boolean))];

  const [imageMap, guideMap, userMap, authenticatedUser] = await Promise.all([
    fetchPostImages(postIds),
    fetchGuidesByUserIds(authorUserIds),
    fetchUserRows(authorUserIds),
    getAuthenticatedUserSafe(),
  ]);

  enrichUserMapWithAuthenticatedUser({
    userMap,
    authenticatedUser,
    targetUserIds: authorUserIds,
  });

  const loadResolvedAuthor = createResolvedAuthorLoader({
    guideMap,
    userMap,
    resolveAvatars,
  });

  return Promise.all(posts.map(async (post) => ({
    id: post.id,
    content: post.content,
    createdAt: toIso(post.created_at),
    updatedAt: toIso(post.updated_at),
    authorType: post.author_type,
    commentCount: Number(post.comment_count || 0),
    images: imageMap.get(post.id) || [],
    author: await loadResolvedAuthor(post.author_user_id),
    isFollowingAuthor: true,
  })));
};

export const getPostComments = async (postId) => {
  if (!postId) return [];

  const { data: comments, error } = await supabase
    .from('social_comments')
    .select('id, post_id, author_user_id, content, created_at, updated_at')
    .eq('post_id', postId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Impossible de charger les commentaires: ${error.message}`);
  }

  const commentRows = comments || [];
  const authorUserIds = [...new Set(commentRows.map((row) => row.author_user_id).filter(Boolean))];
  const [guideMap, userMap, authenticatedUser] = await Promise.all([
    fetchGuidesByUserIds(authorUserIds),
    fetchUserRows(authorUserIds),
    getAuthenticatedUserSafe(),
  ]);

  enrichUserMapWithAuthenticatedUser({
    userMap,
    authenticatedUser,
    targetUserIds: authorUserIds,
  });

  const loadResolvedAuthor = createResolvedAuthorLoader({ guideMap, userMap });

  return Promise.all(commentRows.map(async (comment) => ({
    id: comment.id,
    postId: comment.post_id,
    content: comment.content,
    createdAt: toIso(comment.created_at),
    updatedAt: toIso(comment.updated_at),
    author: await loadResolvedAuthor(comment.author_user_id),
  })));
};

const uploadPostImages = async ({ userId, postId, files }) => {
  const imageFiles = validateImages(files);
  if (!imageFiles.length) return [];

  const uploadedPaths = [];
  const uploadedRows = [];

  try {
    for (let index = 0; index < imageFiles.length; index += 1) {
      const file = imageFiles[index];
      const safeName = sanitizeFileName(file.name);
      const path = `${userId}/${postId}/${Date.now()}-${index}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from(SOCIAL_POSTS_BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type });

      if (uploadError) {
        throw new Error(`Echec televersement image: ${uploadError.message}`);
      }

      uploadedPaths.push(path);

      const { data: publicData } = supabase.storage
        .from(SOCIAL_POSTS_BUCKET)
        .getPublicUrl(path);

      uploadedRows.push({
        post_id: postId,
        storage_path: path,
        public_url: publicData?.publicUrl || null,
        sort_order: index,
      });
    }

    const { data: createdImages, error: insertError } = await supabase
      .from('social_post_images')
      .insert(uploadedRows)
      .select('id, post_id, storage_path, public_url, sort_order');

    if (insertError) {
      throw new Error(`Impossible de sauvegarder les images: ${insertError.message}`);
    }

    return (createdImages || []).map((image) => ({
      id: image.id,
      postId: image.post_id,
      storagePath: image.storage_path,
      url: image.public_url,
      sortOrder: image.sort_order,
    }));
  } catch (error) {
    if (uploadedPaths.length > 0) {
      const { error: cleanupError } = await supabase.storage
        .from(SOCIAL_POSTS_BUCKET)
        .remove(uploadedPaths);

      if (cleanupError) {
        console.warn('Unable to cleanup uploaded social images after failure:', cleanupError.message);
      }
    }

    throw error;
  }
};

export const createPost = async ({ content, files = [] }) => {
  const user = await assertAuthenticatedUser();

  const isGuide = await isGuideUser(user.id);
  if (!isGuide) {
    throw new Error('Seuls les guides peuvent publier pour le moment.');
  }

  const safeContent = validatePostContent(content);
  const safeFiles = validateImages(files);

  const { data: post, error: postError } = await supabase
    .from('social_posts')
    .insert({
      author_user_id: user.id,
      author_type: 'guide',
      content: safeContent,
      status: 'published',
    })
    .select('id, author_user_id, author_type, content, created_at, updated_at')
    .single();

  if (postError) {
    throw new Error(`Impossible de creer la publication: ${postError.message}`);
  }

  try {
    const images = await uploadPostImages({
      userId: user.id,
      postId: post.id,
      files: safeFiles,
    });

    const [guideMap, userMap] = await Promise.all([
      fetchGuidesByUserIds([user.id]),
      fetchUserRows([user.id]),
    ]);
    enrichUserMapWithAuthenticatedUser({
      userMap,
      authenticatedUser: user,
      targetUserIds: [user.id],
    });
    const loadResolvedAuthor = createResolvedAuthorLoader({ guideMap, userMap });

    return {
      id: post.id,
      content: post.content,
      createdAt: toIso(post.created_at),
      updatedAt: toIso(post.updated_at),
      authorType: post.author_type,
      commentCount: 0,
      images,
      author: await loadResolvedAuthor(post.author_user_id),
      isFollowingAuthor: false,
    };
  } catch (uploadErr) {
    await supabase
      .from('social_posts')
      .delete()
      .eq('id', post.id);

    throw uploadErr;
  }
};

export const createComment = async ({ postId, content }) => {
  const user = await assertAuthenticatedUser();
  const safeContent = validateCommentContent(content);

  const { data, error } = await supabase
    .from('social_comments')
    .insert({
      post_id: postId,
      author_user_id: user.id,
      content: safeContent,
    })
    .select('id, post_id, author_user_id, content, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(`Impossible d'ajouter le commentaire: ${error.message}`);
  }

  const guideMap = await fetchGuidesByUserIds([user.id]);
  const userMap = await fetchUserRows([user.id]);
  enrichUserMapWithAuthenticatedUser({
    userMap,
    authenticatedUser: user,
    targetUserIds: [user.id],
  });
  const loadResolvedAuthor = createResolvedAuthorLoader({ guideMap, userMap });

  return {
    id: data.id,
    postId: data.post_id,
    content: data.content,
    createdAt: toIso(data.created_at),
    updatedAt: toIso(data.updated_at),
    author: await loadResolvedAuthor(data.author_user_id),
  };
};

export const followGuide = async (guideUserId) => {
  const user = await assertAuthenticatedUser();
  if (!guideUserId) {
    throw new Error('Guide invalide pour abonnement.');
  }
  if (guideUserId === user.id) return;

  const { error } = await supabase
    .from('social_follows')
    .upsert({
      follower_user_id: user.id,
      followed_guide_user_id: guideUserId,
    }, {
      onConflict: 'follower_user_id,followed_guide_user_id',
      ignoreDuplicates: true,
    });

  if (error) {
    throw new Error(`Impossible de suivre ce guide: ${error.message}`);
  }
};

export const unfollowGuide = async (guideUserId) => {
  const user = await assertAuthenticatedUser();
  if (!guideUserId) {
    throw new Error('Guide invalide pour desabonnement.');
  }

  const { error } = await supabase
    .from('social_follows')
    .delete()
    .eq('follower_user_id', user.id)
    .eq('followed_guide_user_id', guideUserId);

  if (error) {
    throw new Error(`Impossible de retirer cet abonnement: ${error.message}`);
  }
};

export const getGuideByUserId = async (guideUserId) => {
  if (!guideUserId) return null;

  const { data, error } = await supabase
    .from('guide')
    .select('*')
    .eq('user_id', guideUserId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Impossible de charger ce guide: ${error.message}`);
  }

  let linkedUser = null;
  const { data: linkedUserRow, error: linkedUserError } = await supabase
    .from('users')
    .select('*')
    .eq('id', guideUserId)
    .maybeSingle();

  if (!linkedUserError) {
    linkedUser = linkedUserRow || null;
  }

  const authUser = await getAuthenticatedUserSafe();
  const authUserSource = authUser?.id === guideUserId ? authUser : null;

  const { avatarRawValue, avatarVersionKey, avatarSrc } = await resolveAvatarFromSources(
    [data, linkedUser, authUserSource],
    {
      supabase,
      emptySrcFallback: '',
    },
  );

  return {
    ...data,
    avatarSrc,
    avatarRawValue,
    avatarVersionKey,
  };
};
