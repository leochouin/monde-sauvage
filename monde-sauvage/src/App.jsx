import { useState, useEffect } from 'react'
import { Routes, Route, BrowserRouter, Navigate } from 'react-router-dom'
import supabase from './utils/supabase.js'
import './App.css'
import MapApp from './components/MapApp.jsx'

function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [guide, setGuide] = useState(null);
  const [loading, setLoading] = useState(true);

  // Function to check if Google token is still valid
  const checkGoogleTokenValidity = async (guideId) => {
    try {
      const response = await fetch(
        `http://127.0.0.1:54321/functions/v1/check-google-token?guideId=${guideId}`
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

    // Function to fetch user data (profile + guide) with timeout
    const fetchUserData = async (userId, userEmail) => {
      // Add timeout to prevent hanging (3 seconds)
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('fetchUserData timeout')), 1)
      );

      try {
        await Promise.race([
          (async () => {
            // Fetch profile
            const { data: profileData, error: profileError } = await supabase
              .from('users')
              .select('*')
              .eq('id', userId)
              .single();

            if (profileError) {
              if (profileError.code === 'PGRST116') {
                // User doesn't exist, create them
                const { data: newProfile, error: insertError } = await supabase
                  .from('users')
                  .insert({
                    id: userId,
                    email: userEmail,
                    type: 'default',
                  })
                  .select()
                  .single();

                if (!insertError && mounted) {
                  setProfile(newProfile);
                }
              }
            } else if (mounted) {
              setProfile(profileData);
            }

            // Fetch guide
            const { data: guideData, error: guideError } = await supabase
              .from('guide')
              .select('*')
              .eq('user_id', userId)
              .single();

            if (mounted) {
              const fetchedGuide = guideError?.code === 'PGRST116' ? null : guideData;
              setGuide(fetchedGuide);
              
              // Check Google token validity if guide has a token
              if (fetchedGuide && fetchedGuide.google_refresh_token) {
                checkGoogleTokenValidity(fetchedGuide.id);
              }
            }
          })(),
          timeoutPromise
        ]);
      } catch (_err) {
        // Timeout or error - set defaults
        if (mounted) {
          setProfile(null);
          setGuide(null);
        }
      }
    };

    // Check session immediately on mount
    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (mounted) {
          authInitialized = true;
          
          if (session?.user) {
            setUser(session.user);
            await fetchUserData(session.user.id, session.user.email);
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
            await fetchUserData(session.user.id, session.user.email);
          }
          setLoading(false);
        } else if (event === 'SIGNED_OUT') {
          console.log('🚫 User signed out');
          setUser(null);
          setProfile(null);
          setGuide(null);
          setLoading(false);
        } else if (event === 'USER_UPDATED') {
          if (session?.user) {
            console.log("🔄 User updated:", session.user.email);
            setUser(session.user);
            await fetchUserData(session.user.id, session.user.email);
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
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;