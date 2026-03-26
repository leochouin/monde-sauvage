import { useState, useEffect } from 'react'
import { Routes, Route, BrowserRouter, Navigate } from 'react-router-dom'
import supabase from './utils/supabase.js'
import { getAvatarRawValueFromSources } from './utils/avatar.js'
import './App.css'
import MapApp from './components/MapApp.jsx'

const AUTH_AVATAR_COLUMNS = [
  'avatar_url',
  'photo_url',
  'picture',
  'google_avatar',
  'google_avatar_url',
  'profile_photo_url',
  'image_url',
];

const trimValue = (value) => (typeof value === 'string' ? value.trim() : '');

const getAuthName = (authUser) => (
  trimValue(authUser?.user_metadata?.full_name)
  || trimValue(authUser?.user_metadata?.name)
  || trimValue(authUser?.raw_user_meta_data?.full_name)
  || trimValue(authUser?.raw_user_meta_data?.name)
);

const buildAuthAvatarCandidates = (authUser) => {
  const rawAvatar = trimValue(getAvatarRawValueFromSources(
    authUser,
    authUser?.user_metadata,
    authUser?.raw_user_meta_data,
  ));

  const directAvatarUrl = trimValue(authUser?.user_metadata?.avatar_url)
    || trimValue(authUser?.raw_user_meta_data?.avatar_url)
    || rawAvatar;

  return {
    avatar_url: directAvatarUrl,
    photo_url: trimValue(authUser?.user_metadata?.photo_url)
      || trimValue(authUser?.raw_user_meta_data?.photo_url),
    picture: trimValue(authUser?.user_metadata?.picture)
      || trimValue(authUser?.raw_user_meta_data?.picture),
    google_avatar: trimValue(authUser?.user_metadata?.google_avatar)
      || trimValue(authUser?.raw_user_meta_data?.google_avatar)
      || rawAvatar,
    google_avatar_url: trimValue(authUser?.user_metadata?.google_avatar_url)
      || trimValue(authUser?.raw_user_meta_data?.google_avatar_url),
    profile_photo_url: trimValue(authUser?.user_metadata?.profile_photo_url)
      || trimValue(authUser?.raw_user_meta_data?.profile_photo_url),
    image_url: trimValue(authUser?.user_metadata?.image_url)
      || trimValue(authUser?.raw_user_meta_data?.image_url),
  };
};

const syncUserProfileRow = async ({ userId, userEmail, authUser }) => {
  const { data: existingProfile, error: profileError } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (profileError && profileError.code !== 'PGRST116') {
    throw profileError;
  }

  let profileRow = existingProfile || null;

  if (!profileRow) {
    const { data: insertedProfile, error: insertError } = await supabase
      .from('users')
      .insert({
        id: userId,
        email: userEmail,
        type: 'default',
      })
      .select('*')
      .single();

    if (insertError) {
      throw insertError;
    }

    profileRow = insertedProfile;
  }

  const availableColumns = new Set(Object.keys(profileRow || {}));
  const authAvatarCandidates = buildAuthAvatarCandidates(authUser);
  const updatePayload = {};

  if (availableColumns.has('email') && userEmail && profileRow?.email !== userEmail) {
    updatePayload.email = userEmail;
  }

  const authName = getAuthName(authUser);
  if (authName) {
    if (availableColumns.has('display_name') && profileRow?.display_name !== authName) {
      updatePayload.display_name = authName;
    }
    if (availableColumns.has('name') && profileRow?.name !== authName) {
      updatePayload.name = authName;
    }
    if (availableColumns.has('full_name') && profileRow?.full_name !== authName) {
      updatePayload.full_name = authName;
    }
  }

  AUTH_AVATAR_COLUMNS.forEach((columnName) => {
    if (!availableColumns.has(columnName)) return;

    const nextValue = trimValue(authAvatarCandidates[columnName]);
    if (!nextValue) return;

    const currentValue = trimValue(profileRow?.[columnName]);
    if (!currentValue || currentValue !== nextValue) {
      updatePayload[columnName] = nextValue;
    }
  });

  if (!Object.keys(updatePayload).length) {
    return profileRow;
  }

  const { data: updatedProfile, error: updateError } = await supabase
    .from('users')
    .update(updatePayload)
    .eq('id', userId)
    .select('*')
    .single();

  if (updateError) {
    throw updateError;
  }

  return updatedProfile;
};

function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [guide, setGuide] = useState(null);
  const [loading, setLoading] = useState(true);

  // Function to check if Google token is still valid
  const checkGoogleTokenValidity = async (guideId) => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-google-token?guideId=${guideId}`
      );
      
      const result = await response.json();
      
      if (!result.valid && result.requiresAuth) {
        console.log("⚠️ Google Calendar token expired or invalid for guide:", guideId);
        // Token is invalid - it was already cleared by the function
        // The guide will see the "Connect Google Calendar" button
      } else if (result.valid) {
        console.log("✅ Google Calendar token is valid for guide:", guideId);
      }
    } catch (error) {
      console.error("Error checking Google token validity:", error);
    }
  };

  useEffect(() => {
    let mounted = true;
    let authInitialized = false;
    let latestFetchToken = 0;
    let lastFetchedAuthKey = '';

    const getAuthUserFetchKey = (authUser) => (
      [
        authUser?.id || '',
        authUser?.updated_at || '',
        authUser?.last_sign_in_at || '',
        authUser?.email || '',
      ].join('|')
    );

    // Function to fetch user data (profile + guide) without blocking first paint.
    const fetchUserData = async (authUser, fetchToken) => {
      const userId = authUser?.id;
      const userEmail = authUser?.email;
      if (!userId) return;

      let freshestAuthUser = authUser;
      try {
        const { data: { user: authUserData } } = await supabase.auth.getUser();
        if (authUserData?.id === userId) {
          freshestAuthUser = authUserData;
        }
      } catch {
        // Keep using event/session payload when auth.getUser is unavailable.
      }

      try {
        const syncedProfile = await syncUserProfileRow({
          userId,
          userEmail,
          authUser: freshestAuthUser,
        });

        if (!mounted || fetchToken !== latestFetchToken) return;
        setProfile(syncedProfile || null);

        // Fetch guide
        const { data: guideData, error: guideError } = await supabase
          .from('guide')
          .select('*')
          .eq('user_id', userId)
          .single();

        if (!mounted || fetchToken !== latestFetchToken) return;

        const fetchedGuide = guideError?.code === 'PGRST116' ? null : guideData;
        setGuide(fetchedGuide);

        // Token validation runs in background and should not block render.
        if (fetchedGuide && fetchedGuide.google_refresh_token) {
          checkGoogleTokenValidity(fetchedGuide.id);
        }
      } catch (_err) {
        if (mounted && fetchToken === latestFetchToken) {
          setProfile(null);
          setGuide(null);
        }
      }
    };

    const queueUserDataFetch = (authUser) => {
      if (!authUser?.id) return;

      const nextKey = getAuthUserFetchKey(authUser);
      if (nextKey && nextKey === lastFetchedAuthKey) {
        return;
      }

      lastFetchedAuthKey = nextKey;
      const fetchToken = ++latestFetchToken;
      void fetchUserData(authUser, fetchToken);
    };

    // Check session immediately on mount
    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (mounted) {
          authInitialized = true;
          
          if (session?.user) {
            setUser(session.user);
            queueUserDataFetch(session.user);
          }

          setLoading(false);
        }
      } catch (err) {
        console.error('Initial session check failed:', err);
        if (mounted) {
          setLoading(false);
        }
      }
    };

    // Start checking immediately
    initAuth();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log("🧠 Auth event:", event, "| Session:", !!session);

        if (!mounted) return;

        // Mark that auth has been initialized
        if (!authInitialized) {
          authInitialized = true;
          console.log("✅ Auth initialized via listener");
        }

        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
          if (session?.user) {
            console.log("📝 Setting user from auth event:", session.user.email);
            setUser(session.user);
            queueUserDataFetch(session.user);
          }

          setLoading(false);
        } else if (event === 'SIGNED_OUT') {
          console.log('🚫 User signed out');
          lastFetchedAuthKey = '';
          latestFetchToken += 1;
          setUser(null);
          setProfile(null);
          setGuide(null);
          setLoading(false);
        } else if (event === 'USER_UPDATED') {
          if (session?.user) {
            console.log("🔄 User updated:", session.user.email);
            setUser(session.user);
            queueUserDataFetch(session.user);
          }
        }
      }
    );

    // Fallback: if auth listener doesn't fire within 500ms, ensure loading stops
    const fallbackTimeout = setTimeout(() => {
      if (!authInitialized && mounted) {
        console.log('⏱️ Fallback timeout reached, stopping loading');
        setLoading(false);
      }
    }, 500);

    return () => {
      mounted = false;
      clearTimeout(fallbackTimeout);
      subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontSize: '18px',
        background: 'white',
        color: '#333'
      }}>
        Loading...
      </div>
    );
  }

  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/map" />} />
          <Route path="/map" element={<MapApp user={user} profile={profile} guide={guide} />} />
          <Route path="/social" element={<MapApp user={user} profile={profile} guide={guide} />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;