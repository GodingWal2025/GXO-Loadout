import { useState, useEffect } from 'react';
import { useT } from '../i18n/LanguageContext';

export interface UndoToastProps {
  message: string;
  durationSeconds?: number;
  onUndo: () => void;
  onDismiss: () => void;
}

export function UndoToast({
  message,
  durationSeconds = 6,
  onUndo,
  onDismiss,
}: UndoToastProps) {
  const t = useT();
  const [remaining, setRemaining] = useState(durationSeconds);

  useEffect(() => {
    if (remaining <= 0) {
      onDismiss();
      return;
    }
    const timer = setInterval(() => {
      setRemaining((r) => r - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [remaining, onDismiss]);

  const progressPct = ((durationSeconds - remaining) / durationSeconds) * 100;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1200,
        minWidth: 320,
        maxWidth: '90vw',
        background: '#1c1917',
        color: '#ffffff',
        borderRadius: 8,
        boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
        overflow: 'hidden',
        animation: 'slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          gap: 16,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 500 }}>{message}</span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="btn btn--sm"
            onClick={onUndo}
            style={{
              background: 'var(--accent)',
              color: '#ffffff',
              border: 'none',
              fontWeight: 600,
              padding: '4px 12px',
              fontSize: 13,
              borderRadius: 4,
            }}
          >
            {t('toast.undoWithSec', '↺ Undo ({sec}s)', { sec: remaining })}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              fontSize: 14,
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Progress countdown bar */}
      <div
        style={{
          height: 3,
          background: 'rgba(255, 255, 255, 0.15)',
          width: '100%',
        }}
      >
        <div
          style={{
            height: '100%',
            background: 'var(--accent)',
            width: `${100 - progressPct}%`,
            transition: 'width 1s linear',
          }}
        />
      </div>
    </div>
  );
}
