import { useEffect } from 'react';
import {
  QUALITY_FLAG_REASONS,
  type InspectionFlagItem,
  type QualityFlagReason,
} from '../shared';
import { useT } from '../shared/i18n/LanguageContext';

interface Props {
  loadNumber: string;
  flags: InspectionFlagItem[];
  onClose: () => void;
}

export function InspectionFlagsModal({ loadNumber, flags, onClose }: Props) {
  const t = useT();

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const reasonLabels: Record<QualityFlagReason, string> = {
    damaged_product: t('quality.reasonDamagedProduct', QUALITY_FLAG_REASONS.damaged_product),
    wrong_or_missing_label: t('quality.reasonWrongLabel', QUALITY_FLAG_REASONS.wrong_or_missing_label),
    wrong_batch_or_product_info: t('quality.reasonWrongBatch', QUALITY_FLAG_REASONS.wrong_batch_or_product_info),
    quantity_discrepancy: t('quality.reasonQuantity', QUALITY_FLAG_REASONS.quantity_discrepancy),
    other: t('quality.reasonOther', QUALITY_FLAG_REASONS.other),
  };

  const titleFor = (flag: InspectionFlagItem): string => {
    switch (flag.source) {
      case 'inspection':
        return t('listCard.flagSourceInspection', 'Load-level flag');
      case 'unlisted_batch':
        return t('listCard.flagSourceUnlisted', 'Batch {batch} — not on original picklist', {
          batch: flag.batchCode || '—',
        });
      case 'pallet':
        return t('listCard.flagSourcePallet', 'Pallet {number}', {
          number: flag.palletNumber || '—',
        });
      case 'pallet_photo':
        return t('listCard.flagSourcePalletPhoto', 'Pallet {number} photo', {
          number: flag.palletNumber || '—',
        });
      case 'staging_photo':
        return t('listCard.flagSourceStagingPhoto', 'Staging photo');
      case 'quantity_overage':
        return t('listCard.flagSourceOverage', 'Batch {batch} — quantity overage', {
          batch: flag.batchCode || '—',
        });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal inspection-flags-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inspection-flags-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__head row-between">
          <div>
            <h2 id="inspection-flags-title" className="modal__title">
              {t('listCard.flagsTitle', 'Order flags')}
            </h2>
            <p className="modal__sub">
              {t('listCard.flagsSubtitle', 'Load #{load} · {count} issue(s)', {
                load: loadNumber,
                count: flags.length,
              })}
            </p>
          </div>
          <button
            className="btn btn--ghost btn--sm"
            onClick={onClose}
            aria-label={t('listCard.closeFlags', 'Close flag list')}
            autoFocus
          >
            ✕
          </button>
        </div>

        <div className="inspection-flags-modal__list">
          {flags.map((flag) => {
            const reason = flag.reason
              ? flag.reason === 'other' && flag.otherReason
                ? flag.otherReason
                : reasonLabels[flag.reason]
              : null;
            return (
              <article className="inspection-flags-modal__item" key={flag.id}>
                <div className="inspection-flags-modal__icon" aria-hidden="true">⚑</div>
                <div>
                  <div className="fw-500">{titleFor(flag)}</div>
                  {reason && <div className="small soft mt-8">{reason}</div>}
                  {flag.source === 'quantity_overage' && (
                    <div className="small soft mt-8">
                      {t('listCard.flagOverageDetail', '{actual} scanned · {expected} expected', {
                        actual: flag.actual || 0,
                        expected: flag.expected || 0,
                      })}
                    </div>
                  )}
                  {flag.photoCategory && (
                    <div className="small soft mt-8">{flag.photoCategory.replace(/_/g, ' ')}</div>
                  )}
                  {flag.notes && <div className="small mt-8">{flag.notes}</div>}
                  {flag.flaggedBy && (
                    <div className="xs faint mt-8">
                      {t('listCard.flaggedBy', 'Flagged by {name}', { name: flag.flaggedBy })}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <div className="modal__actions">
          <button className="btn btn--outline" onClick={onClose}>
            {t('listCard.close', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
}
