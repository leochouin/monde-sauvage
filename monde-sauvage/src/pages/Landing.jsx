import { useNavigate } from 'react-router-dom'
import { LODGINGS } from '../data/lodgings.js'
import { PARTNERS } from '../data/partners.js'
import { useScrollReveal } from '../hooks/useScrollReveal.js'
import './Landing.css'

/* ── Inline SVG icons (no external icon dependency) ── */
const IconArrowRight = (props) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M5 12h14" /><path d="m13 6 6 6-6 6" />
  </svg>
)
const IconArrowUpRight = (props) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M7 17 17 7" /><path d="M7 7h10v10" />
  </svg>
)

export default function Landing() {
  const navigate = useNavigate()
  useScrollReveal()

  const scrollToLodging = () => {
    document.getElementById('hebergements')?.scrollIntoView({ behavior: 'smooth' })
  }

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

        <img
          src="/logo-mondesauvage.png"
          alt="Monde Sauvage"
          className="landing-hero__mark"
          draggable="false"
        />

        <div className="landing-hero__content">
          <h1 className="landing-hero__title">
            Bienvenue dans le<br />Monde Sauvage
          </h1>
          <p className="landing-hero__tagline">
            Hébergements en pleine nature, guides locaux et pourvoiries d'exception —
            votre prochaine aventure en Gaspésie commence ici.
          </p>
          <div className="landing-hero__ctas">
            <button
              className="landing-btn landing-btn--primary"
              onClick={() => navigate('/map')}
            >
              Explorer la carte
              <IconArrowRight />
            </button>
            <button
              className="landing-btn landing-btn--ghost"
              onClick={scrollToLodging}
            >
              Voir nos hébergements
            </button>
          </div>
        </div>

        <div className="landing-hero__scroll-hint" aria-hidden="true">
          <span />
        </div>
      </section>

      {/* ── DESTINATIONS VEDETTES — bandeaux plein écran parallax ── */}
      {PARTNERS.map((p, i) => (
        <section
          key={p.slug}
          className={`landing-band parallax ${i % 2 === 1 ? 'landing-band--right' : ''}`}
          style={{ backgroundImage: `url(${p.hero})` }}
        >
          <div className="landing-band__overlay" />
          <div className="landing-container landing-band__inner" data-reveal>
            <p className="landing-band__eyebrow">Destination vedette</p>
            <h2 className="landing-band__title">{p.name}</h2>
            <p className="landing-band__desc">{p.short}</p>
            <button
              className="landing-btn landing-btn--light"
              onClick={() => navigate('/destinations')}
            >
              Découvrir
              <IconArrowUpRight />
            </button>
          </div>
        </section>
      ))}

      {/* ── HÉBERGEMENTS (directement sur la homepage) ── */}
      <section id="hebergements" className="landing-section landing-lodging">
        <div className="landing-container">
          <p className="landing-section__eyebrow" data-reveal>Nos hébergements</p>
          <h2 className="landing-section__title" data-reveal>
            Dormez au cœur de la nature
          </h2>
          <p className="landing-section__lead" data-reveal>
            Chalets au bord de l'eau, refuges en forêt et camps de pêche gérés
            directement par Monde Sauvage, choisis pour leur emplacement et leur
            accès aux plus beaux sites.
          </p>

          <div className="landing-lodging__grid">
            {LODGINGS.map((l, i) => (
              <article
                key={l.slug}
                className="landing-lodging__card"
                data-reveal
                style={{ transitionDelay: `${i * 90}ms` }}
              >
                <div className="landing-lodging__media">
                  <img
                    className="landing-lodging__img"
                    src={l.img}
                    alt={l.title}
                    loading="lazy"
                    draggable="false"
                  />
                  <span className="landing-lodging__tag">{l.tag}</span>
                </div>
                <div className="landing-lodging__body">
                  <h3 className="landing-lodging__card-title">{l.title}</h3>
                  <p className="landing-lodging__card-desc">{l.short}</p>
                  <button
                    className="landing-link"
                    onClick={() => navigate('/map')}
                  >
                    Voir sur la carte <IconArrowRight />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── TEASER CARTE INTERACTIVE ── */}
      <section className="landing-section landing-teaser parallax">
        <div className="landing-teaser__overlay" />
        <div className="landing-container landing-teaser__inner" data-reveal>
          <p className="landing-section__eyebrow landing-section__eyebrow--light">
            Carte interactive
          </p>
          <h2 className="landing-teaser__title">
            Trouvez l'emplacement exact de votre prochaine aventure
          </h2>
          <p className="landing-teaser__lead">
            Explorez notre carte illustrée de la Gaspésie : repérez les hébergements,
            les guides et les pourvoiries, puis réservez en quelques clics.
          </p>
          <button
            className="landing-btn landing-btn--primary landing-btn--lg"
            onClick={() => navigate('/map')}
          >
            Ouvrir la carte
            <IconArrowRight />
          </button>
        </div>
      </section>
    </div>
  )
}
