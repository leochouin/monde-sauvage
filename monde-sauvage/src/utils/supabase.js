import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Only clear expired sessions (not malformed ones, as they might be mid-save)
const clearExpiredSessions = () => {
  try {
    Object.keys(localStorage).forEach(key => {
      if (key.includes('sb-') && key.includes('-auth-token')) {
        try {
          const stored = localStorage.getItem(key);
          const parsed = JSON.parse(stored);
          
          // Only clear if definitely expired (not just missing fields)
          if (parsed?.expires_at && parsed.expires_at * 1000 < Date.now() - 60000) {
            console.warn('🧹 Clearing expired session (expired >1min ago)');
            localStorage.removeItem(key);
          }
        } catch (err) {
          // Only clear if completely unparseable
          console.warn('🧹 Clearing completely invalid session');
          localStorage.removeItem(key);
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