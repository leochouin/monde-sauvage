import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import supabase from '../../utils/supabase.js';
import GuestBookingPage from '../public/GuestBookingPage.jsx';
import '../public/PublicPage.css';

function fmtCAD(amount) {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(amount);
}

export default function EmbedWidget() {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const chaletId = searchParams.get('chaletId');

  // If chaletId is provided (or selected), render the booking flow directly.
  if (chaletId) {
    return <GuestBookingPage slugProp={slug} chaletIdProp={chaletId} isWidget />;
  }

  return <WidgetChaletList slug={slug} onSelect={(id) => setSearchParams({ chaletId: id })} />;
}

function WidgetChaletList({ slug, onSelect }) {
  const [establishment, setEstablishment] = useState(null);
  const [chalets, setChalets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const { data: estab, error: estabErr } = await supabase
          .from('Etablissement')
          .select('key, "Name", public_slug')
          .eq('public_slug', slug)
          .single();

        if (estabErr || !estab) throw new Error('Établissement introuvable.');
        setEstablishment(estab);

        const { data: chaletData } = await supabase
          .from('chalets')
          .select('key, "Name", price_per_night, nb_personnes, "Image"')
          .eq('etablishment_id', estab.key);

        setChalets(chaletData ?? []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [slug]);

  if (loading) return <div className="pub-loading" style={{ minHeight: 200 }}>Chargement…</div>;
  if (error) return <div className="pub-error-page" style={{ minHeight: 200 }}>{error}</div>;

  return (
    <div className="pub-widget-shell">
      <div className="pub-widget-header">
        {establishment?.Name} — Choisir un chalet
      </div>
      <div className="pub-widget-list">
        {chalets.length === 0 ? (
          <p className="pub-empty">Aucun chalet disponible pour le moment.</p>
        ) : (
          chalets.map((c) => (
            <div key={c.key} className="pub-widget-chalet">
              {c.Image && (
                <img src={c.Image} alt={c.Name} className="pub-widget-chalet-thumb" />
              )}
              <div className="pub-widget-chalet-info">
                <div className="pub-widget-chalet-name">{c.Name}</div>
                {c.price_per_night > 0 && (
                  <div className="pub-widget-chalet-price">
                    {fmtCAD(c.price_per_night)} / nuit
                    {c.nb_personnes ? ` · ${c.nb_personnes} pers.` : ''}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="pub-widget-btn"
                onClick={() => onSelect(c.key)}
              >
                Réserver
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
