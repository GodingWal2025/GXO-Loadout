import { useEffect } from 'react';
import { useT } from '../i18n/LanguageContext';

export interface ConfirmModalProps {
  title: string;
  message: string | React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const t = useT();

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel} style={{ zIndex: 1100 }}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 440, width: '90%' }}
      >
        <div className="modal__head">
          <h2 className="modal__title" style={{ fontSize: 18, margin: 0 }}>
            {danger && <span style={{ color: 'var(--danger)', marginRight: 6 }}>⚠</span>}
            {title}
          </h2>
          <button type="button" className="btn btn--sm btn--ghost" onClick={onCancel}>
            ✕
          </button>
        </div>

        <div className="modal__body" style={{ color: 'var(--ink-soft)', lineHeight: 1.5, fontSize: 14 }}>
          {typeof message === 'string' ? <p style={{ margin: 0 }}>{message}</p> : message}
        </div>

        <div
          className="modal__actions"
          style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}
        >
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            {cancelLabel || t('common.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn--danger' : 'btn--accent'}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel || (danger ? t('common.delete', 'Delete') : t('common.confirm', 'Confirm'))}
          </button>
        </div>
      </div>
    </div>
  );
}
