import { useState, useEffect } from 'react';
import { useEstablishment } from '../../components/layout/EstablishmentLayout.jsx';
import EstablishmentCalendar from '../../components/EstablishmentCalendar.jsx';
import supabase from '../../utils/supabase.js';

const edgeFunctionHeaders = (accessToken) => ({
  'Content-Type': 'application/json',
  ...(import.meta.env.VITE_SUPABASE_ANON_KEY ? { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } : {}),
  ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
});

const isGoogleCalendarConnectionError = (statusCode, errorData) => {
  if (statusCode === 401 || errorData?.requiresAuth) return true;
  const txt = `${errorData?.error || ''} ${errorData?.message || ''}`.toLowerCase();
  return txt.includes('google') && (
    txt.includes('auth') || txt.includes('connect') || txt.includes('reconnect') ||
    txt.includes('token') || txt.includes('expired')
  );
};

export default function Calendar() {
  const { selectedEstablishment, setSelectedEstablishment, chalets, loading: ctxLoading, refresh } = useEstablishment();

  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [connectionSuccess, setConnectionSuccess] = useState(false);

  const estabKey = selectedEstablishment?.key ?? selectedEstablishment?.id ?? '';

  // Handle return from Google OAuth
  useEffect(() => {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    if (params.get('google_connected') !== 'true') return;

    setConnectionSuccess(true);
    globalThis.history?.replaceState({}, '', globalThis.location.pathname);
    refresh();

    const t = setTimeout(() => setConnectionSuccess(false), 5000);
    return () => clearTimeout(t);
  }, []);

  const handleConnect = () => {
    if (!estabKey) return;
    try {
      setIsConnecting(true);
      setConnectionError(null);

      const oauthUrl = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar-oauth`);
      oauthUrl.searchParams.set('establishmentId', estabKey);

      const redirectUrl = new URL(globalThis.location.origin + '/dashboard/establishment/calendrier');
      redirectUrl.searchParams.set('google_connected', 'true');
      oauthUrl.searchParams.set('redirect_to', redirectUrl.toString());

      globalThis.location.href = oauthUrl.toString();
    } catch (err) {
      setConnectionError(err.message ?? 'Erreur lors de la connexion à Google Calendar');
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!selectedEstablishment) return;
    const ok = globalThis.confirm(
      'Êtes-vous sûr de vouloir déconnecter Google Calendar ? Les calendriers des chalets resteront actifs mais ne pourront plus être synchronisés.'
    );
    if (!ok) return;

    try {
      setIsConnecting(true);
      setConnectionError(null);

      const session = (await supabase.auth.getSession()).data.session;
      const accessToken = session?.access_token;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/disconnect-google-calendar`,
        {
          method: 'POST',
          headers: edgeFunctionHeaders(accessToken),
          body: JSON.stringify({ establishment_id: estabKey }),
        }
      );

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? 'Erreur lors de la déconnexion.');
      }

      setSelectedEstablishment((prev) => ({ ...prev, google_calendar_id: null }));
      await refresh();
    } catch (err) {
      setConnectionError(err.message ?? 'Erreur lors de la déconnexion.');
    } finally {
      setIsConnecting(false);
    }
  };

  if (ctxLoading) {
    return (
      <div className="esbl-loading-state">
        <span style={{ fontSize: '2rem' }}>📅</span>
        <p style={{ margin: 0 }}>Chargement…</p>
      </div>
    );
  }

  if (!selectedEstablishment) {
    return (
      <div className="esbl-empty-state">
        <div style={{ fontSize: '3rem' }}>📅</div>
        <p>Aucun établissement sélectionné.</p>
      </div>
    );
  }

  const isConnected = !!selectedEstablishment.google_calendar_id;

  return (
    <div className="esbl-page">
      <div className="esbl-page-intro">
        <h1 className="esbl-page-title">📅 Calendrier</h1>
        <p className="esbl-page-subtitle">
          Vue centralisée des disponibilités chalets et équipements.
        </p>
      </div>

      <div className="esbl-alert esbl-alert--info">
        <strong style={{ display: 'block', marginBottom: 6 }}>Employés et Google Agenda</strong>
        Ce lieu utilise <strong>un compte Google</strong> connecté ci-dessous. Chaque chalet ou chaloupe peut avoir son
        <strong> sous-agenda</strong> : votre équipe voit les mêmes réservations dans Google Calendar, ou vous pouvez
        <strong> partager chaque sous-agenda</strong> avec des courriels employés (Paramètres de l'agenda → Partager avec des personnes spécifiques).
      </div>

      <div className="esbl-card">
        <EstablishmentCalendar
          establishmentKey={estabKey}
          chalets={chalets}
        />

        <div className="esbl-calendar-meta">
          <span>
            Google Agenda :{' '}
            {isConnected
              ? <span className="esbl-status esbl-status--ok">connecté</span>
              : <span className="esbl-status esbl-status--muted">non connecté</span>}
            {connectionSuccess && <span className="esbl-status esbl-status--ok">✓ synchro récente</span>}
          </span>

          {isConnected ? (
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isConnecting}
              className="esbl-link-button esbl-link-button--danger"
            >
              {isConnecting ? 'Déconnexion…' : 'Déconnecter Google'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConnect}
              disabled={isConnecting}
              className="esbl-link-button"
            >
              {isConnecting ? 'Connexion…' : 'Connecter Google'}
            </button>
          )}
        </div>

        {connectionError && (
          <p className="esbl-calendar-error">
            {connectionError}
          </p>
        )}
      </div>
    </div>
  );
}
