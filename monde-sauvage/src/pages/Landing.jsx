import { useNavigate } from 'react-router-dom'
import './Landing.css'

const EXPERIENCES = [
  {
    icon: '🎣',
    title: 'Guides de pêche',
    desc: 'Partez avec des guides locaux qui connaissent chaque rivière, chaque anse, chaque marée de la Gaspésie.',
  },
  {
    icon: '🏔️',
    title: 'Chalets en nature',
    desc: 'Des hébergements isolés, loin du bruit, au bord de l\'eau ou en forêt. Réservez en quelques clics.',
  },
  {
    icon: '🌊',
    title: 'Rivières sauvages',
    desc: 'Explorez les rivières à saumon et les plans d\'eau vierges que seuls les locaux connaissent vraiment.',
  },
]

const STEPS = [
  { num: '01', label: 'Explorez la carte', desc: 'Une carte illustrée de la Gaspésie avec tous les guides et établissements.' },
  { num: '02', label: 'Choisissez une expérience', desc: 'Filtrez par activité, dates et secteur géographique.' },
  { num: '03', label: 'Réservez en ligne', desc: 'Paiement sécurisé, confirmation instantanée, zéro paperasse.' },
]

export default function Landing() {
  const navigate = useNavigate()

  return (
    <div className="landing">
      {/* ── HERO ── */}
      <section className="landing-hero">
        <div className="landing-hero__bg" />
        <video
          className="landing-hero__video"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        >
          <source src="/intro.mp4" type="video/mp4" />
        </video>
        <div className="landing-hero__overlay" />

        <div className="landing-hero__content">
          <img
            src="/logo-mondesauvage.png"
            alt="Monde Sauvage"
            className="landing-hero__logo"
            draggable="false"
          />
          <p className="landing-hero__tagline">
            Réservez des aventures authentiques avec des guides locaux de la Gaspésie
          </p>
          <div className="landing-hero__ctas">
            <button
              className="landing-btn landing-btn--primary"
              onClick={() => navigate('/map')}
            >
              Explorer la carte
            </button>
            <button
              className="landing-btn landing-btn--ghost"
              onClick={() => navigate('/dashboard/establishment')}
            >
              Je suis un établissement
            </button>
          </div>
        </div>

        <div className="landing-hero__scroll-hint" aria-hidden="true">
          <span />
        </div>
      </section>

      {/* ── COMMENT ÇA MARCHE ── */}
      <section className="landing-section landing-how">
        <div className="landing-container">
          <h2 className="landing-section__title">Comment ça marche</h2>
          <div className="landing-how__steps">
            {STEPS.map((s) => (
              <div key={s.num} className="landing-how__step">
                <span className="landing-how__num">{s.num}</span>
                <h3 className="landing-how__step-title">{s.label}</h3>
                <p className="landing-how__step-desc">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── EXPÉRIENCES ── */}
      <section className="landing-section landing-exp">
        <div className="landing-container">
          <h2 className="landing-section__title">Ce que vous trouverez</h2>
          <div className="landing-exp__grid">
            {EXPERIENCES.map((e) => (
              <div key={e.title} className="landing-exp__card">
                <span className="landing-exp__icon">{e.icon}</span>
                <h3 className="landing-exp__card-title">{e.title}</h3>
                <p className="landing-exp__card-desc">{e.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── POUR LES ÉTABLISSEMENTS ── */}
      <section className="landing-section landing-biz">
        <div className="landing-container landing-biz__inner">
          <div className="landing-biz__text">
            <h2 className="landing-section__title landing-section__title--left">
              Vous êtes un pourvoyeur ou un lodge?
            </h2>
            <p className="landing-biz__desc">
              Rejoignez Monde Sauvage et gérez vos réservations, votre calendrier et
              vos paiements depuis un seul tableau de bord. Apparaissez sur la carte
              illustrée et rejoignez des centaines d'aventuriers chaque saison.
            </p>
            <button
              className="landing-btn landing-btn--ghost"
              onClick={() => navigate('/dashboard/establishment')}
            >
              Créer mon établissement
            </button>
          </div>
          <div className="landing-biz__visual" aria-hidden="true">
            <div className="landing-biz__map-preview">
              <img src="/NewMap.png" alt="" draggable="false" />
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER CTA ── */}
      <section className="landing-section landing-footer-cta">
        <div className="landing-container landing-footer-cta__inner">
          <h2 className="landing-footer-cta__title">Prêt pour l'aventure?</h2>
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
