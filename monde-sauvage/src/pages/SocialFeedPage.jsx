import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import AvatarImage from '../components/AvatarImage.jsx';
import useAvatarSource from '../utils/useAvatarSource.js';
import {
  MAX_IMAGE_SIZE_BYTES,
  MAX_POST_IMAGES,
  createComment,
  createPost,
  followGuide,
  getFollowingFeed,
  getGlobalFeed,
  getPostComments,
  hydrateFeedAuthorAvatars,
  isGuideUser,
  unfollowGuide,
} from '../utils/socialFeedService.js';
import './SocialFeedPage.css';

const emptyComments = {};
const emptyOpenComments = {};
const emptyCommentDrafts = {};

const mergeHydratedAvatars = (currentPosts, hydratedPosts) => {
  const avatarByPostId = new Map(
    (hydratedPosts || []).map((post) => [post.id, post?.author?.avatarSrc || ''])
  );

  return (currentPosts || []).map((post) => {
    const hydratedAvatar = avatarByPostId.get(post.id);
    if (!hydratedAvatar || hydratedAvatar === post?.author?.avatarSrc) {
      return post;
    }

    return {
      ...post,
      author: {
        ...post.author,
        avatarSrc: hydratedAvatar,
      },
    };
  });
};

const formatDateTime = (isoValue) => {
  if (!isoValue) return '';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('fr-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

export default function SocialFeedPage({
  user,
  guide,
  onOpenGuideProfile,
  onBack,
}) {
  const location = useLocation();
  const { avatarSrc, handleAvatarError, avatarDebug } = useAvatarSource(user);

  const avatarDebugEnabled = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('avatarDebug') === '1';
  }, [location.search]);

  const avatarDebugUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    params.set('avatarDebug', '1');
    return `${location.pathname}?${params.toString()}`;
  }, [location.pathname, location.search]);

  const avatarDebugOffUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    params.delete('avatarDebug');
    const query = params.toString();
    return query ? `${location.pathname}?${query}` : location.pathname;
  }, [location.pathname, location.search]);

  const [activeTab, setActiveTab] = useState('feed');
  const [posts, setPosts] = useState([]);
  const [isLoadingPosts, setIsLoadingPosts] = useState(false);
  const [feedError, setFeedError] = useState('');
  const [isGuide, setIsGuide] = useState(Boolean(guide?.id));

  const [postDraft, setPostDraft] = useState('');
  const [postFiles, setPostFiles] = useState([]);
  const [isSubmittingPost, setIsSubmittingPost] = useState(false);
  const [postSubmitError, setPostSubmitError] = useState('');
  const [postSubmitSuccess, setPostSubmitSuccess] = useState('');

  const [openCommentsByPost, setOpenCommentsByPost] = useState(emptyOpenComments);
  const [commentsByPost, setCommentsByPost] = useState(emptyComments);
  const [loadingCommentsByPost, setLoadingCommentsByPost] = useState({});
  const [commentDraftByPost, setCommentDraftByPost] = useState(emptyCommentDrafts);
  const [commentErrorByPost, setCommentErrorByPost] = useState({});
  const [submittingCommentByPost, setSubmittingCommentByPost] = useState({});
  const [followPendingByUser, setFollowPendingByUser] = useState({});

  const currentUserId = user?.id || null;
  const postImagesInputRef = useRef(null);

  const postImagePreviews = useMemo(
    () => postFiles.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    })),
    [postFiles],
  );

  useEffect(() => {
    return () => {
      postImagePreviews.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, [postImagePreviews]);

  useEffect(() => {
    let isMounted = true;
    const likelyGuideFromProps = Boolean(
      currentUserId
      && guide?.id
      && (!guide?.user_id || guide.user_id === currentUserId)
    );

    const checkGuideState = async () => {
      if (!currentUserId) {
        setIsGuide(false);
        return;
      }

      if (likelyGuideFromProps) {
        setIsGuide(true);
        return;
      }

      try {
        const guideStatus = await isGuideUser(currentUserId);
        if (isMounted) setIsGuide(guideStatus);
      } catch (err) {
        if (isMounted) {
          console.error('Guide check failed:', err);
          setIsGuide(false);
        }
      }
    };

    checkGuideState();

    return () => {
      isMounted = false;
    };
  }, [currentUserId, guide?.id, guide?.user_id]);

  useEffect(() => {
    let cancelled = false;

    const loadPosts = async () => {
      setIsLoadingPosts(true);
      setFeedError('');

      try {
        const nextPosts = activeTab === 'following'
          ? await getFollowingFeed({ currentUserId })
          : await getGlobalFeed({ currentUserId });

        if (!cancelled) {
          setPosts(nextPosts);
          void hydrateFeedAuthorAvatars(nextPosts).then((hydratedPosts) => {
            if (!cancelled) {
              setPosts((prev) => mergeHydratedAvatars(prev, hydratedPosts));
            }
          });
        }
      } catch (err) {
        if (!cancelled) {
          setFeedError(err.message || 'Impossible de charger le fil social.');
          setPosts([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingPosts(false);
        }
      }
    };

    loadPosts();

    return () => {
      cancelled = true;
    };
  }, [activeTab, currentUserId]);

  const handleFileChange = (event) => {
    const selected = Array.from(event.target.files || []);
    const limited = selected.slice(0, MAX_POST_IMAGES);

    if (selected.length > MAX_POST_IMAGES) {
      setPostFiles(limited);
      setPostSubmitError(`Maximum ${MAX_POST_IMAGES} images par publication.`);
      return;
    }

    const invalidTypeFile = limited.find((file) => !file?.type?.startsWith('image/'));
    if (invalidTypeFile) {
      setPostFiles([]);
      setPostSubmitError('Format image non supporte. Utilisez JPG, PNG, WEBP ou GIF.');
      return;
    }

    const oversizedFile = limited.find((file) => file.size > MAX_IMAGE_SIZE_BYTES);
    if (oversizedFile) {
      setPostFiles([]);
      setPostSubmitError('Chaque image doit faire moins de 8 MB.');
      return;
    }

    setPostFiles(limited);
    setPostSubmitError('');
  };

  const refreshPosts = async () => {
    try {
      const refreshed = activeTab === 'following'
        ? await getFollowingFeed({ currentUserId })
        : await getGlobalFeed({ currentUserId });
      setPosts(refreshed);
      void hydrateFeedAuthorAvatars(refreshed).then((hydratedPosts) => {
        setPosts((prev) => mergeHydratedAvatars(prev, hydratedPosts));
      });
    } catch (err) {
      setFeedError(err.message || 'Impossible de mettre a jour le fil.');
    }
  };

  const handleSubmitPost = async (event) => {
    event.preventDefault();
    if (!isGuide || isSubmittingPost) return;

    if (!postDraft.trim()) {
      setPostSubmitError('Le contenu de la publication est requis.');
      return;
    }

    setIsSubmittingPost(true);
    setPostSubmitError('');
    setPostSubmitSuccess('');

    try {
      const createdPost = await createPost({
        content: postDraft,
        files: postFiles,
      });

      if (activeTab === 'feed') {
        setPosts((prev) => [createdPost, ...prev]);
      }

      setPostDraft('');
      setPostFiles([]);
      if (postImagesInputRef.current) {
        postImagesInputRef.current.value = '';
      }
      setPostSubmitSuccess('Publication ajoutee au fil.');
      refreshPosts();
    } catch (err) {
      setPostSubmitError(err.message || 'Impossible de publier pour le moment.');
    } finally {
      setIsSubmittingPost(false);
    }
  };

  const handleToggleFollow = async (post) => {
    if (!currentUserId || !post?.author?.userId || post.author.userId === currentUserId) return;
    if (followPendingByUser[post.author.userId]) return;

    const wasFollowing = post.isFollowingAuthor;
    const targetUserId = post.author.userId;

    setFollowPendingByUser((prev) => ({ ...prev, [targetUserId]: true }));

    setPosts((prev) => prev.map((item) => (
      item.author.userId === targetUserId
        ? { ...item, isFollowingAuthor: !wasFollowing }
        : item
    )));

    try {
      if (wasFollowing) {
        await unfollowGuide(post.author.userId);
      } else {
        await followGuide(post.author.userId);
      }

      if (activeTab === 'following' && wasFollowing) {
        setPosts((prev) => prev.filter((item) => item.author.userId !== targetUserId));
      }
    } catch (err) {
      setPosts((prev) => prev.map((item) => (
        item.author.userId === targetUserId
          ? { ...item, isFollowingAuthor: wasFollowing }
          : item
      )));
      setFeedError(err.message || 'Action de suivi impossible.');
    } finally {
      setFollowPendingByUser((prev) => ({ ...prev, [targetUserId]: false }));
    }
  };

  const openGuideProfile = (guideUserId) => {
    if (!guideUserId || !onOpenGuideProfile) return;
    onOpenGuideProfile(guideUserId);
  };

  const handleToggleComments = async (postId) => {
    const currentlyOpen = Boolean(openCommentsByPost[postId]);
    setOpenCommentsByPost((prev) => ({ ...prev, [postId]: !currentlyOpen }));

    if (currentlyOpen || commentsByPost[postId] || loadingCommentsByPost[postId]) {
      return;
    }

    setLoadingCommentsByPost((prev) => ({ ...prev, [postId]: true }));
    setCommentErrorByPost((prev) => ({ ...prev, [postId]: '' }));

    try {
      const postComments = await getPostComments(postId);
      setCommentsByPost((prev) => ({ ...prev, [postId]: postComments }));
    } catch (err) {
      setCommentErrorByPost((prev) => ({
        ...prev,
        [postId]: err.message || 'Impossible de charger les commentaires.',
      }));
    } finally {
      setLoadingCommentsByPost((prev) => ({ ...prev, [postId]: false }));
    }
  };

  const handleSubmitComment = async (postId) => {
    if (!currentUserId || submittingCommentByPost[postId]) return;

    const draft = commentDraftByPost[postId] || '';
    const safeDraft = draft.trim();
    if (!safeDraft) {
      setCommentErrorByPost((prev) => ({
        ...prev,
        [postId]: 'Le commentaire ne peut pas etre vide.',
      }));
      return;
    }

    setSubmittingCommentByPost((prev) => ({ ...prev, [postId]: true }));
    setCommentErrorByPost((prev) => ({ ...prev, [postId]: '' }));

    try {
      const created = await createComment({ postId, content: safeDraft });
      setCommentsByPost((prev) => ({
        ...prev,
        [postId]: [...(prev[postId] || []), created],
      }));
      setCommentDraftByPost((prev) => ({ ...prev, [postId]: '' }));
      setPosts((prev) => prev.map((item) => (
        item.id === postId
          ? { ...item, commentCount: (item.commentCount || 0) + 1 }
          : item
      )));
    } catch (err) {
      setCommentErrorByPost((prev) => ({
        ...prev,
        [postId]: err.message || 'Impossible d\'ajouter le commentaire.',
      }));
    } finally {
      setSubmittingCommentByPost((prev) => ({ ...prev, [postId]: false }));
    }
  };

  const followingEmpty = activeTab === 'following' && !isLoadingPosts && posts.length === 0 && !feedError;
  const followingNeedsAuth = activeTab === 'following' && !currentUserId && !isLoadingPosts && posts.length === 0 && !feedError;

  return (
    <div className="social-feed-page">
      <header className="social-page-header">
        <div className="social-page-header-top">
          <button type="button" className="social-back-btn" onClick={onBack}>
            Retour a la carte
          </button>
          <span className="social-page-badge">Guides seulement</span>
        </div>
        <div className="social-avatar-debug-links">
          {avatarDebugEnabled ? (
            <a href={avatarDebugOffUrl}>Desactiver debug avatar</a>
          ) : (
            <a href={avatarDebugUrl}>Activer debug avatar</a>
          )}
        </div>
        <h1>Section Sociale</h1>
        <p>Partagez vos sorties, inspirez les pecheurs et suivez vos guides preferes.</p>
      </header>

      <main className="social-page-main">
        <section className="social-feed-column">
          {isGuide && (
            <form className="social-composer" onSubmit={handleSubmitPost}>
              <div className="social-composer-head">
                <img
                  src={avatarSrc}
                  alt="Avatar guide"
                  referrerPolicy="no-referrer"
                  onError={handleAvatarError}
                  className="social-composer-avatar"
                />
                <div>
                  <strong>Publier comme guide</strong>
                  <span>Partagez vos disponibilites, captures et conseils.</span>
                </div>
              </div>

              {avatarDebugEnabled && (
                <pre className="social-avatar-debug-panel">
{JSON.stringify(avatarDebug, null, 2)}
                </pre>
              )}

              <textarea
                value={postDraft}
                onChange={(event) => setPostDraft(event.target.value)}
                placeholder="Decrivez votre derniere sortie ou annoncez vos prochains creneaux."
                maxLength={3000}
              />

              <div className="social-composer-actions">
                <label className="social-image-picker" htmlFor="social-post-images">
                  Ajouter des images
                </label>
                <input
                  id="social-post-images"
                  ref={postImagesInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  onChange={handleFileChange}
                />
                <span>{postFiles.length}/{MAX_POST_IMAGES} image(s)</span>
              </div>

              {postImagePreviews.length > 0 && (
                <div className="social-post-preview-images">
                  {postImagePreviews.map((item, index) => (
                    <img key={`${item.file.name}-${index}`} src={item.previewUrl} alt={item.file.name} />
                  ))}
                </div>
              )}

              {postSubmitError && <p className="social-error">{postSubmitError}</p>}
              {postSubmitSuccess && <p className="social-success">{postSubmitSuccess}</p>}

              <button type="submit" disabled={isSubmittingPost}>
                {isSubmittingPost ? 'Publication en cours...' : 'Publier'}
              </button>
            </form>
          )}

          <div className="social-feed-tabs">
            <button
              type="button"
              className={activeTab === 'feed' ? 'active' : ''}
              onClick={() => setActiveTab('feed')}
            >
              Fil
            </button>
            <button
              type="button"
              className={activeTab === 'following' ? 'active' : ''}
              onClick={() => setActiveTab('following')}
            >
              Abonnements
            </button>
          </div>

          {feedError && <p className="social-error social-feed-global-error">{feedError}</p>}

          <div className="social-feed-content">
          {isLoadingPosts ? (
            <div className="social-state">Chargement du fil social...</div>
          ) : followingNeedsAuth ? (
            <div className="social-state social-empty-following">
              <h3>Connectez-vous pour voir vos abonnements</h3>
              <p>L'onglet Abonnements affiche les publications des guides que vous suivez.</p>
            </div>
          ) : followingEmpty ? (
            <div className="social-state social-empty-following">
              <h3>Vous ne suivez encore aucun guide</h3>
              <p>Explorez le fil general pour decouvrir des guides et commencer a suivre ceux qui vous inspirent.</p>
              <button type="button" onClick={() => setActiveTab('feed')}>Decouvrir des guides</button>
            </div>
          ) : posts.length === 0 ? (
            <div className="social-state">Aucune publication pour le moment.</div>
          ) : (
            posts.map((post) => {
              const comments = commentsByPost[post.id] || [];
              const commentsOpen = Boolean(openCommentsByPost[post.id]);

              return (
                <article key={post.id} className="social-post-card">
                  <div className="social-post-header">
                    <button
                      type="button"
                      className="social-post-author"
                      onClick={() => openGuideProfile(post.author.userId)}
                      disabled={!post.author.hasGuideProfile}
                    >
                      <AvatarImage
                        src={post.author.avatarSrc}
                        name={post.author.name}
                        alt={post.author.name}
                        className="social-avatar-image"
                        fallbackClassName="social-avatar-initials"
                        fallback={post.author.initials || 'GU'}
                      />
                      <span>
                        <strong>{post.author.name}</strong>
                        <small>{formatDateTime(post.createdAt)}</small>
                      </span>
                    </button>

                    {currentUserId && post.author.userId !== currentUserId && post.author.hasGuideProfile && (
                      <button
                        type="button"
                        className={post.isFollowingAuthor ? 'social-follow-btn following' : 'social-follow-btn'}
                        onClick={() => handleToggleFollow(post)}
                        disabled={Boolean(followPendingByUser[post.author.userId])}
                      >
                        {followPendingByUser[post.author.userId]
                          ? 'Mise a jour...'
                          : (post.isFollowingAuthor ? 'Abonne' : 'Suivre')}
                      </button>
                    )}
                  </div>

                  <p className="social-post-content">{post.content}</p>

                  {post.images.length > 0 && (
                    <div className={`social-post-images grid-${Math.min(post.images.length, 3)}`}>
                      {post.images.map((image) => (
                        <img key={image.id} src={image.url} alt="Publication guide" />
                      ))}
                    </div>
                  )}

                  <div className="social-post-footer">
                    <span>{post.commentCount} commentaire(s)</span>
                    <button type="button" onClick={() => handleToggleComments(post.id)}>
                      {commentsOpen ? 'Masquer les commentaires' : 'Commenter'}
                    </button>
                    {post.author.hasGuideProfile && (
                      <button type="button" onClick={() => openGuideProfile(post.author.userId)}>
                        Voir le profil guide
                      </button>
                    )}
                  </div>

                  {commentsOpen && (
                    <div className="social-comments-block">
                      {loadingCommentsByPost[post.id] ? (
                        <p className="social-state">Chargement des commentaires...</p>
                      ) : (
                        <>
                          {comments.length === 0 ? (
                            <p className="social-state">Aucun commentaire pour cette publication.</p>
                          ) : (
                            <div className="social-comments-list">
                              {comments.map((comment) => (
                                <div key={comment.id} className="social-comment-item">
                                  <AvatarImage
                                    src={comment.author.avatarSrc}
                                    name={comment.author.name}
                                    alt={comment.author.name}
                                    className="social-comment-avatar-image"
                                    fallbackClassName="social-comment-avatar"
                                    fallback={comment.author.initials || 'GU'}
                                  />
                                  <div>
                                    <div className="social-comment-meta">
                                      <strong>{comment.author.name}</strong>
                                      <small>{formatDateTime(comment.createdAt)}</small>
                                    </div>
                                    <p>{comment.content}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {currentUserId ? (
                            <div className="social-comment-form">
                              <textarea
                                value={commentDraftByPost[post.id] || ''}
                                onChange={(event) => setCommentDraftByPost((prev) => ({
                                  ...prev,
                                  [post.id]: event.target.value,
                                }))}
                                placeholder="Ajouter un commentaire..."
                                maxLength={1500}
                              />
                              {commentErrorByPost[post.id] && (
                                <p className="social-error">{commentErrorByPost[post.id]}</p>
                              )}
                              <button
                                type="button"
                                onClick={() => handleSubmitComment(post.id)}
                                disabled={Boolean(submittingCommentByPost[post.id])}
                              >
                                {submittingCommentByPost[post.id] ? 'Envoi...' : 'Publier le commentaire'}
                              </button>
                            </div>
                          ) : (
                            <p className="social-state">Connectez-vous pour commenter.</p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </article>
              );
            })
          )}
          </div>
        </section>
      </main>
    </div>
  );
}
