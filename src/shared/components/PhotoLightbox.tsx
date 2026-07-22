import { useEffect } from 'react';
import { useT } from '../i18n/LanguageContext';

interface Props {
  url?: string;
  label?: string;
  onClose: () => void;
  /** When provided, shows a "Retake photo" button (used by photo slots). */
  onRetake?: () => void;
}

/**
 * Fullscreen photo viewer. Tapping a captured photo opens this instead of
 * immediately re-opening the camera — retaking is now an explicit button.
 */
export function PhotoLightbox({ url, label, onClose, onRetake }: Props) {
  const t = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      style={{ zIndex: 1000, background: 'rgba(0,0,0,0.85)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          maxWidth: '95vw',
          maxHeight: '95vh',
        }}
      >
        {label && (
          <div
            className="fw-500"
            style={{ color: '#fff', fontSize: 15, letterSpacing: '0.02em' }}
          >
            {label}
          </div>
        )}
        {url ? (
          <img
            src={url}
            alt={label || t('lightbox.photoAlt', 'Photo')}
            style={{
              maxWidth: '95vw',
              maxHeight: '75vh',
              objectFit: 'contain',
              borderRadius: 8,
              boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
            }}
          />
        ) : (
          <div style={{ color: '#fff', padding: 40 }}>
            {t('lightbox.unavailable', 'Photo unavailable on this device')}
          </div>
        )}
        <div style={{ display: 'flex', gap: 12 }}>
          {onRetake && (
            <button
              className="btn btn--accent"
              onClick={() => {
                onClose();
                onRetake();
              }}
            >
              {t('lightbox.retake', '📷 Retake photo')}
            </button>
          )}
          <button className="btn" style={{ background: '#fff' }} onClick={onClose}>
            {t('lightbox.close', '✕ Close')}
          </button>
        </div>
      </div>
    </div>
  );
}
