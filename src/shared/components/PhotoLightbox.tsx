import { useEffect, useState, useRef, useCallback } from 'react';
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
 * Fullscreen photo viewer with interactive zoom, drag-to-pan, rotation,
 * and open-in-new-tab support.
 */
export function PhotoLightbox({ url, label, rotation = 0, onClose, onRetake, onRotate }: Props) {
  const t = useT();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);

  // Close on Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Reset pan and zoom if photo url or rotation changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [url, rotation]);

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(4, Math.round((z + 0.5) * 10) / 10));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => {
      const next = Math.max(1, Math.round((z - 0.5) * 10) / 10);
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (zoom > 1) {
        handleResetZoom();
      } else {
        setZoom(2.2);
      }
    },
    [zoom, handleResetZoom]
  );

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.002;
    setZoom((prevZoom) => {
      const next = Math.min(4, Math.max(1, Math.round((prevZoom + delta) * 100) / 100));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...pan };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || zoom <= 1) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: panStartRef.current.x + dx,
      y: panStartRef.current.y + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        // Ignore if already released
      }
    }
  };

  const handleOpenNewTab = () => {
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const isSwapped = rotation % 180 !== 0;

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      style={{
        zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.9)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        userSelect: 'none',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          maxWidth: '96vw',
          maxHeight: '96vh',
          width: '100%',
        }}
      >
        {/* Header bar with title and quick Open in new tab icon */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            maxWidth: isSwapped ? '70vh' : '90vw',
            padding: '0 4px',
          }}
        >
          <div
            className="fw-500"
            style={{ color: '#fff', fontSize: 16, letterSpacing: '0.02em' }}
          >
            {label || t('lightbox.photoAlt', 'Photo')}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {url && (
              <button
                type="button"
                className="btn btn--sm"
                onClick={handleOpenNewTab}
                title={t('lightbox.openNewTab', '↗ Open in new tab')}
                style={{
                  background: 'rgba(255, 255, 255, 0.15)',
                  color: '#fff',
                  border: '1px solid rgba(255, 255, 255, 0.25)',
                  padding: '4px 10px',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span>↗</span>
                <span>{t('lightbox.openNewTab', 'Open in new tab')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Photo Container with Zoom & Pan */}
        {url ? (
          <div
            onWheel={handleWheel}
            onDoubleClick={handleDoubleClick}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              maxWidth: isSwapped ? '70vh' : '92vw',
              maxHeight: isSwapped ? '70vw' : '72vh',
              width: isSwapped ? '70vh' : '92vw',
              height: isSwapped ? '70vw' : '72vh',
              borderRadius: 8,
              background: 'rgba(0, 0, 0, 0.4)',
              cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
              touchAction: 'none',
            }}
          >
            <img
              ref={imgRef}
              src={url}
              alt={label || t('lightbox.photoAlt', 'Photo')}
              draggable={false}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                borderRadius: 6,
                boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
                transform: `rotate(${rotation}deg) scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                transformOrigin: 'center center',
                transition: isDragging ? 'none' : 'transform 0.15s ease-out',
                pointerEvents: 'none',
              }}
            />

            {/* Floating Zoom Controls Bar */}
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                bottom: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(20, 20, 20, 0.85)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: 24,
                padding: '4px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                zIndex: 10,
              }}
            >
              <button
                type="button"
                onClick={handleZoomOut}
                disabled={zoom <= 1}
                title={t('lightbox.zoomOut', 'Zoom out')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: zoom <= 1 ? 'rgba(255,255,255,0.3)' : '#fff',
                  cursor: zoom <= 1 ? 'default' : 'pointer',
                  fontSize: 16,
                  fontWeight: 700,
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                −
              </button>

              <span
                style={{
                  color: '#fff',
                  fontSize: 12,
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: 600,
                  minWidth: 42,
                  textAlign: 'center',
                }}
              >
                {Math.round(zoom * 100)}%
              </span>

              <button
                type="button"
                onClick={handleZoomIn}
                disabled={zoom >= 4}
                title={t('lightbox.zoomIn', 'Zoom in')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: zoom >= 4 ? 'rgba(255,255,255,0.3)' : '#fff',
                  cursor: zoom >= 4 ? 'default' : 'pointer',
                  fontSize: 16,
                  fontWeight: 700,
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                +
              </button>

              {zoom > 1 && (
                <button
                  type="button"
                  onClick={handleResetZoom}
                  title={t('lightbox.resetZoom', 'Reset zoom')}
                  style={{
                    background: 'rgba(255,255,255,0.2)',
                    border: 'none',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 12,
                    marginLeft: 2,
                  }}
                >
                  {t('lightbox.resetZoom', 'Reset')}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ color: '#fff', padding: 40 }}>
            {t('lightbox.unavailable', 'Photo unavailable on this device')}
          </div>
        )}

        {/* Bottom Actions Bar */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
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
          {url && (
            <button
              className="btn"
              type="button"
              onClick={handleOpenNewTab}
              style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}
            >
              {t('lightbox.openNewTab', '↗ Open in new tab')}
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
