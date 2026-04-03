import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Only clear expired sessions — skip PKCE flow keys (code-verifier, flow state)
const clearExpiredSessions = () => {
  // Don't clear anything if we're in the middle of an OAuth callback
  if (window.location.search.includes('code=') || window.location.hash.includes('access_token')) {
    return;
  }

  try {
    Object.keys(localStorage).forEach(key => {
      // Only target the exact session token key, not code-verifier or other auth flow keys
      if (key.match(/sb-[^-]+-auth-token$/) && !key.includes('code-verifier')) {
        try {
          const stored = localStorage.getItem(key);
          const parsed = JSON.parse(stored);

          // Only clear if definitely expired (not just missing fields)
          if (parsed?.expires_at && parsed.expires_at * 1000 < Date.now() - 60000) {
            console.warn('Clearing expired session (expired >1min ago)');
            localStorage.removeItem(key);
          }
        } catch {
          // Don't clear unparseable items — could be mid-save during auth flow
        }
      }
    });
  } catch (err) {
    console.error('Error checking sessions:', err);
  }
};

clearExpiredSessions();

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: localStorage,
  },
});

console.log('Supabase initialized with:', supabaseUrl);

export default supabase;