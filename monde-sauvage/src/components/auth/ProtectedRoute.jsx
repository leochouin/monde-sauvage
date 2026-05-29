import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import supabase from '../../utils/supabase.js';

// Gère le chargement initial sans flash de redirection.
const LoadingScreen = () => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    background: '#f8fafc',
    flexDirection: 'column',
    gap: '12px',
  }}>
    <div style={{ fontSize: '2.4rem' }}>🌿</div>
    <p style={{ color: '#64748b', fontSize: '0.95rem', margin: 0 }}>Vérification des accès…</p>
  </div>
);

/**
 * Protège les routes du portail SaaS.
 * Conditions d'accès : session Supabase valide + profile.type dans allowedTypes.
 * Redirige vers /map si l'accès est refusé ou si l'utilisateur n'est pas connecté.
 */
export default function ProtectedRoute({
  children,
  allowedTypes = ['establishment', 'admin'],
  redirectTo = '/map',
}) {
  // 'loading' | 'allowed' | 'unauthenticated' | 'denied'
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let mounted = true;

    const checkAccess = async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
          if (mounted) setStatus('unauthenticated');
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from('users')
          .select('type')
          .eq('id', user.id)
          .maybeSingle();

        if (!mounted) return;

        if (profileError) {
          setStatus('denied');
          return;
        }

        if (profile && allowedTypes.includes(profile.type)) {
          setStatus('allowed');
        } else {
          setStatus('denied');
        }
      } catch {
        if (mounted) setStatus('unauthenticated');
      }
    };

    checkAccess();
    return () => { mounted = false; };
  }, [allowedTypes.join(',')]);

  if (status === 'loading') return <LoadingScreen />;
  if (status === 'unauthenticated' || status === 'denied') {
    return <Navigate to={redirectTo} replace />;
  }

  return children;
}
