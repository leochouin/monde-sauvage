import { useNavigate } from 'react-router-dom'
import { PARTNERS } from '../data/partners.js'
import { useScrollReveal } from '../hooks/useScrollReveal.js'
import './Landing.css'
import './DestinationsPage.css'

/* ── Inline SVG icons (no external icon dependency) ── */
const IconArrowLeft = (props) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M19 12H5" /><path d="m11 18-6-6 6-6" />
  </svg>
)
const IconExternal = (props) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
)
const IconCheck = (props) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

export default function DestinationsPage() {
  const navigate = useNavigate()
  useScrollReveal()

  return (
    <div className="landing destinations-page">
      <button className="des-back" onClick={() => navigate('/')}>
        <IconArrowLeft /> Retour à l'accueil
      </button>

      {PARTNERS.map((p, i) => (
        <section key={p.slug} className="des-chapter">
          {/* ── HÉRO PLEIN ÉCRAN AVEC PARALLAX ── */}
          <div
            className="des-hero parallax"
            style={{ backgroundImage: `url(${p.hero})` }}
          >
            <div className="des-hero__overlay" />
            <div className="landing-container des-hero__inner">
              <span className="des-hero__index">{`0${i + 1}`}</span>
              <p className="des-hero__kicker">{p.kicker}</p>
              <h2 className="des-hero__title">{p.name}</h2>
              <p className="des-hero__short">{p.short}</p>
            </div>
          </div>

          {/* ── CONTENU + GALERIE ── */}
          <div className="landing-container des-content">
            <div className="des-content__head">
              <div className="des-content__text" data-reveal>
                <p className="des-content__desc">{p.desc}</p>
                <ul className="des-content__features">
                  {p.features.map((f) => (
                    <li key={f}><IconCheck /> {f}</li>
                  ))}
                </ul>
                <a
                  className="landing-btn landing-btn--dark"
                  href={p.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Visiter le site officiel
                  <IconExternal />
                </a>
              </div>
            </div>

            <div className="des-gallery">
              {p.gallery.map((src, gi) => (
                <figure
                  key={src}
                  className="des-gallery__item"
                  data-reveal
                  style={{ transitionDelay: `${gi * 90}ms` }}
                >
                  <img src={src} alt={`${p.name} — photo ${gi + 1}`} loading="lazy" draggable="false" />
                </figure>
              ))}
            </div>
          </div>
        </section>
      ))}

      {/* ── CTA FINAL ── */}
      <section className="landing-section des-cta">
        <div className="landing-container des-cta__inner" data-reveal>
          <h2 className="des-cta__title">Situez ces domaines sur la carte</h2>
          <p className="des-cta__lead">
            Repérez Falls Gully, le Château Lamontagne et toutes nos autres
            expériences sur notre carte interactive de la Gaspésie.
          </p>
          <button
            className="landing-btn landing-btn--primary landing-btn--lg"
            onClick={() => navigate('/map')}
          >
            Ouvrir la carte
          </button>
        </div>
      </section>
    </div>
  )
}
