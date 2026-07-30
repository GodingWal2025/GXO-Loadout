import { useEffect } from 'react';
import { useT } from '../i18n/LanguageContext';

interface Props {
  url?: string;
  label?: string;
  rotation?: number;
  onClose: () => void;
  /** When provided, shows a "Retake photo" button (used by photo slots). */
  onRetake?: () => void;
  /** When provided, shows a "Rotate photo" button. */
  onRotate?: () => void;
}

/**
 * Fullscreen photo viewer. Tapping a captured photo opens this instead of
 * immediately re-opening the camera — retaking is now an explicit button.
 */
export function PhotoLightbox({ url, label, rotation = 0, onClose, onRetake, onRotate }: Props) {
  const t = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isSwapped = rotation % 180 !== 0;

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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <img
              src={url}
              alt={label || t('lightbox.photoAlt', 'Photo')}
              style={{
                maxWidth: isSwapped ? '65vh' : '95vw',
                maxHeight: isSwapped ? '65vw' : '75vh',
                objectFit: 'contain',
                borderRadius: 8,
                boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
                transform: `rotate(${rotation}deg)`,
                transition: 'transform 0.2s ease',
              }}
            />
          </div>
        ) : (
          <div style={{ color: '#fff', padding: 40 }}>
            {t('lightbox.unavailable', 'Photo unavailable on this device')}
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          {onRotate && (
            <button
              className="btn"
              type="button"
              style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}
              onClick={onRotate}
            >
              {t('lightbox.rotate', '↻ Rotate photo')}
            </button>
          )}
          {onRetake && (
            <button
              className="btn btn--accent"
              type="button"
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
