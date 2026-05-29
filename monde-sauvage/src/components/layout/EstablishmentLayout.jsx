import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom';
import supabase from '../../utils/supabase.js';
import './EstablishmentLayout.css';

// ─── Context ─────────────────────────────────────────────────────────────────
// Shared state disponible à toutes les pages enfants via useEstablishment().
export const EstablishmentContext = createContext(null);

export const useEstablishment = () => {
  const ctx = useContext(EstablishmentContext);
  if (!ctx) throw new Error('useEstablishment doit être utilisé dans EstablishmentLayout');
  return ctx;
};

// ─── Navigation items ────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { path: '', label: 'Aperçu', icon: '📋', end: true },
  { path: 'demarrage', label: 'Démarrage', icon: '✅' },
  { path: 'chalets', label: 'Chalets', icon: '🏠' },
  { path: 'equipements', label: 'Équipements', icon: '🛶' },
  { path: 'calendrier', label: 'Calendrier', icon: '📅' },
  { path: 'clients', label: 'Clients', icon: '👤' },
  { path: 'reservations', label: 'Réservations', icon: '📋' },
  { path: 'paiements', label: 'Paiements', icon: '💳' },
  { path: 'parametres', label: 'Paramètres', icon: '⚙️' },
];

// ─── Supabase helpers (même logique que le modal d'origine) ──────────────────
const fetchEstablishmentsForUser = async (userId) => {
  // Essaie 'Etablissement' (capital E) en premier, puis la version minuscule.
  let res = await supabase.from('Etablissement').select('*').eq('owner_id', userId);
  if (res.error) {
    res = await supabase.from('etablissement').select('*').eq('owner_id', userId);
  }
  if (res.error) throw res.error;
  return res.data ?? [];
};

const fetchChaletsForEstablishment = async (establishmentKey) => {
  // La colonne dans la DB s'appelle 'etablishment_id' (typo conservée intentionnellement).
  let res = await supabase
    .from('chalets')
    .select('*')
    .eq('etablishment_id', establishmentKey);
  if (res.error) {
    res = await supabase.from('chalets').select('*').eq('establishment_id', establishmentKey);
  }
  return res.data ?? [];
};

// ─── Layout ──────────────────────────────────────────────────────────────────
export default function EstablishmentLayout() {
  const navigate = useNavigate();

  const [authUser, setAuthUser] = useState(null);
  const [establishments, setEstablishments] = useState([]);
  const [selectedEstablishment, setSelectedEstablishment] = useState(null);
  const [chalets, setChalets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── Chargement initial ──
  const loadEstablishments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('Session expirée.');

      setAuthUser(user);
      const data = await fetchEstablishmentsForUser(user.id);
      setEstablishments(data);
      // Sélectionne automatiquement le premier établissement disponible.
      if (data.length > 0) setSelectedEstablishment(data[0]);
    } catch (err) {
      setError(err.message ?? 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadEstablishments(); }, [loadEstablishments]);

  // ── Recharge les chalets quand l'établissement sélectionné change ──
  useEffect(() => {
    if (!selectedEstablishment) { setChalets([]); return; }
    const key = String(selectedEstablishment.key ?? selectedEstablishment.id ?? '');
    if (!key) return;
    fetchChaletsForEstablishment(key).then(setChalets).catch(() => setChalets([]));
  }, [selectedEstablishment?.key ?? selectedEstablishment?.id]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/map');
  };

  // ── Nom d'affichage de l'établissement actif ──
  const activeEstabName =
    selectedEstablishment?.Name
    ?? selectedEstablishment?.name
    ?? 'Mon établissement';

  // ── Contexte partagé avec toutes les pages enfants ──
  const contextValue = {
    authUser,
    establishments,
    selectedEstablishment,
    setSelectedEstablishment,
    chalets,
    loading,
    error,
    refresh: loadEstablishments,
  };

  return (
    <EstablishmentContext.Provider value={contextValue}>
      <div className="esbl-shell">
        {/* ── Sidebar ── */}
        <aside className="esbl-sidebar">
          <div className="esbl-sidebar-logo">
            <div className="esbl-sidebar-logo-text">🌿 Monde Sauvage</div>
            <div className="esbl-sidebar-logo-sub">Portail pourvoyeur</div>
          </div>

          <nav className="esbl-nav" aria-label="Navigation principale">
            <div className="esbl-nav-label">Gestion</div>
            {NAV_ITEMS.map(({ path, label, icon, end }) => (
              <NavLink
                key={label}
                to={path}
                end={end}
                className={({ isActive }) =>
                  `esbl-nav-link${isActive ? ' active' : ''}`
                }
              >
                <span className="esbl-nav-icon">{icon}</span>
                {label}
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* ── Main ── */}
        <div className="esbl-main">
          {/* ── Header ── */}
          <header className="esbl-header">
            <div className="esbl-header-left">
              {establishments.length > 1 ? (
                <select
                  className="esbl-estab-select"
                  value={selectedEstablishment?.key ?? selectedEstablishment?.id ?? ''}
                  onChange={(e) => {
                    const found = establishments.find(
                      (es) => String(es.key ?? es.id) === e.target.value
                    );
                    if (found) setSelectedEstablishment(found);
                  }}
                >
                  {establishments.map((es) => {
                    const k = String(es.key ?? es.id ?? '');
                    return (
                      <option key={k} value={k}>
                        {es.Name ?? es.name ?? `Établissement ${k}`}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <span className="esbl-estab-name">{activeEstabName}</span>
              )}
            </div>

            <div className="esbl-header-right">
              <Link to="/map" className="esbl-btn-back">
                ← Carte
              </Link>
              <button
                type="button"
                className="esbl-btn-signout"
                onClick={handleSignOut}
              >
                Déconnexion
              </button>
            </div>
          </header>

          {/* ── Page content (injecté par le routeur) ── */}
          <main className="esbl-content">
            <div className="esbl-content-inner">
              {loading ? (
                <div className="esbl-layout-loading">
                  <span style={{ fontSize: '2rem' }}>🌿</span>
                  <p>Chargement de l'établissement…</p>
                </div>
              ) : (
                <Outlet />
              )}
            </div>
          </main>
        </div>
      </div>
    </EstablishmentContext.Provider>
  );
}
