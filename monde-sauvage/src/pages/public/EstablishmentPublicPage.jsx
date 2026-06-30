import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import supabase from '../../utils/supabase.js';
import './PublicPage.css';

function fmtCAD(amount) {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(amount);
}

export default function EstablishmentPublicPage() {
  const { slug } = useParams();
  const [establishment, setEstablishment] = useState(null);
  const [chalets, setChalets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const { data: estab, error: estabErr } = await supabase
          .from('Etablissement')
          .select('key, "Name", "Description", telephone, email, public_slug')
          .eq('public_slug', slug)
          .single();

        if (estabErr || !estab) {
          setError('Établissement introuvable.');
          return;
        }

        setEstablishment(estab);

        const { data: chaletData } = await supabase
          .from('chalets')
          .select('key, "Name", "Description", price_per_night, nb_personnes, "Image"')
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

  if (loading) return <div className="pub-loading">Chargement…</div>;
  if (error) return <div className="pub-error-page">{error}</div>;

  return (
    <div className="pub-shell">
      <header className="pub-header">
        <div className="pub-header-inner">
          <Link to="/map" className="pub-brand">🌿 Monde Sauvage</Link>
        </div>
      </header>

      <main className="pub-main">
        <div className="pub-hero">
          <h1 className="pub-title">{establishment.Name}</h1>
          {establishment.Description && (
            <p className="pub-desc">{establishment.Description}</p>
          )}
        </div>

        <section>
          <h2 className="pub-section-title">Nos chalets</h2>
          {chalets.length === 0 ? (
            <p className="pub-empty">Aucun chalet disponible pour le moment.</p>
          ) : (
            <div className="pub-chalet-grid">
              {chalets.map((c) => (
                <div key={c.key} className="pub-chalet-card">
                  {c.Image && (
                    <div className="pub-chalet-img-wrap">
                      <img src={c.Image} alt={c.Name} className="pub-chalet-img" />
                    </div>
                  )}
                  <div className="pub-chalet-body">
                    <h3 className="pub-chalet-name">{c.Name}</h3>
                    {c.Description && (
                      <p className="pub-chalet-desc">{c.Description}</p>
                    )}
                    <div className="pub-chalet-meta">
                      {c.nb_personnes && <span>👥 {c.nb_personnes} pers.</span>}
                      {c.price_per_night > 0 && (
                        <span className="pub-chalet-price">
                          {fmtCAD(c.price_per_night)} / nuit
                        </span>
                      )}
                    </div>
                    <Link
                      to={`/p/${slug}/book/${c.key}`}
                      className="pub-btn-reserve"
                    >
                      Réserver
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
