import { useEffect, useState } from 'react';
import { useEstablishment } from '../../components/layout/EstablishmentLayout.jsx';
import supabase from '../../utils/supabase.js';
import './establishment-dashboard.css';

const BASE_URL = typeof window !== 'undefined' ? window.location.origin : '';

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function Integration() {
  const { selectedEstablishment, loading, refresh } = useEstablishment();

  const [slug, setSlug] = useState('');
  const [slugSaving, setSlugSaving] = useState(false);
  const [slugError, setSlugError] = useState(null);
  const [slugNotice, setSlugNotice] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  // Sync slug from selected establishment
  useEffect(() => {
    if (!selectedEstablishment) return;
    const existing = selectedEstablishment.public_slug ?? '';
    if (existing) {
      setSlug(existing);
    } else {
      const name = selectedEstablishment.Name ?? selectedEstablishment.name ?? '';
      setSlug(slugify(name));
    }
    setSlugError(null);
    setSlugNotice(null);
  }, [selectedEstablishment?.key ?? selectedEstablishment?.id]);

  const handleSlugChange = (e) => {
    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
  };

  const handleSaveSlug = async (e) => {
    e.preventDefault();
    if (!selectedEstablishment) return;
    setSlugSaving(true);
    setSlugError(null);
    setSlugNotice(null);
    try {
      const key = selectedEstablishment.key ?? selectedEstablishment.id;
      const { error } = await supabase
        .from('Etablissement')
        .update({ public_slug: slug.trim() || null })
        .eq('key', key);
      if (error) throw error;
      setSlugNotice('Lien public mis à jour.');
      await refresh();
    } catch (err) {
      const msg = String(err.message ?? '');
      if (msg.includes('unique') || msg.includes('duplicate')) {
        setSlugError('Ce slug est déjà utilisé par un autre établissement. Choisissez-en un autre.');
      } else {
        setSlugError(`Erreur : ${msg || 'Erreur inconnue'}`);
      }
    } finally {
      setSlugSaving(false);
    }
  };

  const handleCopy = async (text, setCopied) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="esbl-loading-state">
        <span style={{ fontSize: '2rem' }}>🔗</span>
        <p style={{ margin: 0 }}>Chargement…</p>
      </div>
    );
  }

  if (!selectedEstablishment) {
    return (
      <div className="esbl-page">
        <div className="esbl-page-intro">
          <h1 className="esbl-page-title">🔗 Intégration</h1>
          <p className="esbl-page-subtitle">Sélectionnez un établissement pour configurer votre lien public.</p>
        </div>
      </div>
    );
  }

  const savedSlug = selectedEstablishment.public_slug ?? '';
  const bookingLink = savedSlug ? `${BASE_URL}/p/${savedSlug}` : '';
  const iframeSnippet = savedSlug
    ? `<iframe\n  src="${BASE_URL}/widget/${savedSlug}"\n  width="100%"\n  height="680"\n  frameborder="0"\n  style="border-radius:12px;border:none;"\n></iframe>`
    : '';

  return (
    <div className="esbl-page">
      <div className="esbl-page-intro">
        <h1 className="esbl-page-title">🔗 Intégration</h1>
        <p className="esbl-page-subtitle">Partagez votre lien de réservation ou intégrez le widget sur votre site web.</p>
      </div>

      {/* ── Slug ── */}
      <div className="esbl-form-card">
        <h2 className="esbl-form-title">Identifiant public (slug)</h2>
        <p style={{ fontSize: '0.88rem', color: 'var(--esbl-muted)', marginBottom: 16, marginTop: 4 }}>
          Identifie votre établissement dans l'URL publique. Lettres minuscules, chiffres et tirets uniquement.
        </p>
        {slugError && (
          <div className="esbl-alert esbl-alert--error" style={{ marginBottom: 14 }}>{slugError}</div>
        )}
        {slugNotice && (
          <div className="esbl-alert esbl-alert--info" style={{ marginBottom: 14 }}>{slugNotice}</div>
        )}
        <form onSubmit={handleSaveSlug}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--esbl-muted)', fontSize: '0.88rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {BASE_URL}/p/
            </span>
            <input
              className="esbl-input"
              style={{ flex: '1 1 160px', minWidth: 0 }}
              value={slug}
              onChange={handleSlugChange}
              placeholder="mon-etablissement"
              pattern="[a-z0-9][a-z0-9-]*"
              title="Lettres minuscules, chiffres et tirets uniquement"
              required
            />
            <button
              type="submit"
              className="esbl-btn esbl-btn--primary"
              disabled={slugSaving}
              style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {slugSaving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>

      {/* ── Booking link ── */}
      <div className="esbl-form-card" style={{ opacity: bookingLink ? 1 : 0.45 }}>
        <h2 className="esbl-form-title">Lien de réservation</h2>
        <p style={{ fontSize: '0.88rem', color: 'var(--esbl-muted)', marginBottom: 14, marginTop: 4 }}>
          Envoyez ce lien à vos clients. Ils pourront choisir un chalet et payer en ligne sans créer de compte.
        </p>
        {bookingLink ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <a
              href={bookingLink}
              target="_blank"
              rel="noopener noreferrer"
              className="esbl-input"
              style={{
                flex: 1,
                minWidth: 0,
                color: 'var(--esbl-accent)',
                textDecoration: 'none',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'block',
              }}
            >
              {bookingLink}
            </a>
            <button
              type="button"
              className="esbl-btn esbl-btn--ghost"
              onClick={() => handleCopy(bookingLink, setCopiedLink)}
              style={{ flexShrink: 0 }}
            >
              {copiedLink ? '✓ Copié !' : 'Copier'}
            </button>
          </div>
        ) : (
          <p style={{ fontSize: '0.88rem', color: 'var(--esbl-muted)', margin: 0 }}>
            Enregistrez un slug ci-dessus pour générer votre lien.
          </p>
        )}
      </div>

      {/* ── Widget iframe ── */}
      <div className="esbl-form-card" style={{ opacity: iframeSnippet ? 1 : 0.45 }}>
        <h2 className="esbl-form-title">Widget iframe</h2>
        <p style={{ fontSize: '0.88rem', color: 'var(--esbl-muted)', marginBottom: 14, marginTop: 4 }}>
          Collez ce code HTML dans votre site web pour intégrer le widget de réservation directement.
        </p>
        {iframeSnippet ? (
          <div style={{ position: 'relative' }}>
            <pre style={{
              background: '#f1f5f9',
              border: '1px solid var(--esbl-border)',
              borderRadius: 10,
              padding: '14px 52px 14px 16px',
              fontSize: '0.78rem',
              overflow: 'auto',
              whiteSpace: 'pre',
              fontFamily: '"SF Mono", "Fira Code", monospace',
              color: '#334155',
              margin: 0,
              lineHeight: 1.6,
            }}>
              {iframeSnippet}
            </pre>
            <button
              type="button"
              className="esbl-btn esbl-btn--ghost"
              onClick={() => handleCopy(iframeSnippet, setCopiedEmbed)}
              style={{ position: 'absolute', top: 8, right: 8, fontSize: '0.8rem' }}
            >
              {copiedEmbed ? '✓ Copié !' : 'Copier'}
            </button>
          </div>
        ) : (
          <p style={{ fontSize: '0.88rem', color: 'var(--esbl-muted)', margin: 0 }}>
            Enregistrez un slug ci-dessus pour générer le snippet.
          </p>
        )}
      </div>
    </div>
  );
}
