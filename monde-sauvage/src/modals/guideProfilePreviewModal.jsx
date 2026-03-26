import { createPortal } from 'react-dom';
import AvatarImage from '../components/AvatarImage.jsx';
import './guideProfilePreviewModal.css';

const toArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

export default function GuideProfilePreviewModal({
  guide,
  isOpen,
  onClose,
  onReserve,
}) {
  if (!isOpen || !guide) return null;

  const fishTypes = toArray(guide.fish_types);
  const modalMarkup = (
    <div className="guide-profile-preview-overlay" onClick={onClose}>
      <div className="guide-profile-preview-modal" onClick={(event) => event.stopPropagation()}>
        <header className="guide-profile-preview-header">
          <div className="guide-profile-preview-identity">
            <AvatarImage
              src={guide.avatarSrc}
              name={guide.name || 'Guide'}
              alt={guide.name || 'Guide'}
              className="guide-profile-preview-avatar"
              fallbackClassName="guide-profile-preview-avatar-fallback"
              fallback="GU"
            />

            <div>
            <p className="guide-profile-preview-eyebrow">Profil du guide</p>
            <h2>{guide.name || 'Guide'}</h2>
            </div>
          </div>
          <button type="button" className="guide-profile-preview-close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="guide-profile-preview-content">
          <section>
            <h3>A propos</h3>
            <p>{guide.bio || 'Aucune biographie disponible pour le moment.'}</p>
          </section>

          {guide.experience && (
            <section>
              <h3>Experience</h3>
              <p>{guide.experience}</p>
            </section>
          )}

          {fishTypes.length > 0 && (
            <section>
              <h3>Specialites de peche</h3>
              <div className="guide-profile-preview-chips">
                {fishTypes.map((fishType) => (
                  <span key={fishType} className="guide-profile-preview-chip">{fishType}</span>
                ))}
              </div>
            </section>
          )}

          <section className="guide-profile-preview-grid">
            <article>
              <h4>Tarif horaire</h4>
              <p>{guide.hourly_rate ? `${guide.hourly_rate}$ / h` : 'Non specifie'}</p>
            </article>
            <article>
              <h4>Contact</h4>
              <p>{guide.email || guide.phone || 'Information non disponible'}</p>
            </article>
          </section>
        </div>

        <footer className="guide-profile-preview-actions">
          <button type="button" className="guide-profile-preview-secondary" onClick={onClose}>
            Fermer
          </button>
          <button type="button" className="guide-profile-preview-primary" onClick={onReserve}>
            Reserver avec ce guide
          </button>
        </footer>
      </div>
    </div>
  );

  return createPortal(modalMarkup, document.body);
}
