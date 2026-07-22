import { useState } from 'react';
import type { QualityFlag, QualityFlagReason } from '../types/inspection';
import { QUALITY_FLAG_REASONS } from '../types/inspection';
import { useT } from '../i18n/LanguageContext';

interface Props {
  flag?: QualityFlag;
  level: 'photo' | 'pallet' | 'inspection';
  onFlag: (flag: QualityFlag) => void;
  onUnflag: () => void;
  currentUser: string;
}

export function QualityFlagButton({ flag, level, onFlag, onUnflag, currentUser }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<QualityFlagReason | ''>(flag?.reason || '');
  const [otherReason, setOtherReason] = useState(flag?.otherReason || '');
  const [notes, setNotes] = useState(flag?.notes || '');

  const isFlagged = !!flag;

  const openModal = () => {
    setReason(flag?.reason || '');
    setOtherReason(flag?.otherReason || '');
    setNotes(flag?.notes || '');
    setOpen(true);
  };

  const submit = () => {
    if (!reason) return;
    if (reason === 'other' && !otherReason.trim()) return;
    onFlag({
      flaggedAt: new Date().toISOString(),
      flaggedBy: currentUser || 'unknown',
      reason,
      otherReason: reason === 'other' ? otherReason.trim() : undefined,
      notes: notes.trim() || undefined,
    });
    setOpen(false);
  };

  if (level === 'photo') {
    return (
      <>
        <button
          className={`photo-tile__flag-btn ${isFlagged ? 'photo-tile__flag-btn--active' : ''}`}
          onClick={(e) => { e.stopPropagation(); openModal(); }}
          aria-label={t('quality.flagIssueAria', 'Flag quality issue')}
        >
          ⚑
        </button>
        {open && (
          <FlagModal
            level={level}
            reason={reason}
            otherReason={otherReason}
            notes={notes}
            setReason={setReason}
            setOtherReason={setOtherReason}
            setNotes={setNotes}
            isFlagged={isFlagged}
            onSubmit={submit}
            onCancel={() => setOpen(false)}
            onUnflag={() => { onUnflag(); setOpen(false); }}
          />
        )}
      </>
    );
  }

  const buttonLabel = isFlagged
    ? t('quality.flagged', '⚑ Flagged')
    : t('quality.flagIssue', '⚑ Flag issue');
  const buttonClass = `btn btn--sm ${isFlagged ? 'btn--danger' : ''}`;

  return (
    <>
      <button className={buttonClass} onClick={openModal}>
        {buttonLabel}
      </button>
      {open && (
        <FlagModal
          level={level}
          reason={reason}
          otherReason={otherReason}
          notes={notes}
          setReason={setReason}
          setOtherReason={setOtherReason}
          setNotes={setNotes}
          isFlagged={isFlagged}
          onSubmit={submit}
          onCancel={() => setOpen(false)}
          onUnflag={() => { onUnflag(); setOpen(false); }}
        />
      )}
    </>
  );
}

interface ModalProps {
  level: 'photo' | 'pallet' | 'inspection';
  reason: QualityFlagReason | '';
  otherReason: string;
  notes: string;
  setReason: (r: QualityFlagReason) => void;
  setOtherReason: (s: string) => void;
  setNotes: (s: string) => void;
  isFlagged: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  onUnflag: () => void;
}

function FlagModal({
  level, reason, otherReason, notes,
  setReason, setOtherReason, setNotes,
  isFlagged, onSubmit, onCancel, onUnflag,
}: ModalProps) {
  const t = useT();

  // Labels only — the keys stay exactly as stored/synced.
  const reasonLabels: Record<QualityFlagReason, string> = {
    damaged_product: t('quality.reasonDamagedProduct', QUALITY_FLAG_REASONS.damaged_product),
    wrong_or_missing_label: t('quality.reasonWrongLabel', QUALITY_FLAG_REASONS.wrong_or_missing_label),
    wrong_batch_or_product_info: t('quality.reasonWrongBatch', QUALITY_FLAG_REASONS.wrong_batch_or_product_info),
    quantity_discrepancy: t('quality.reasonQuantity', QUALITY_FLAG_REASONS.quantity_discrepancy),
    other: t('quality.reasonOther', QUALITY_FLAG_REASONS.other),
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">
          {isFlagged
            ? t('quality.editTitle', 'Edit quality flag')
            : t('quality.flagTitle', 'Flag quality issue')}
        </h3>
        <p className="modal__sub">
          {level === 'photo' && t('quality.subPhoto', 'Flag this specific photo as a quality concern.')}
          {level === 'pallet' && t('quality.subPallet', 'Flag this entire pallet as a quality concern.')}
          {level === 'inspection' && t('quality.subInspection', 'Flag this entire load as a quality concern.')}
        </p>

        <fieldset className="modal__field modal__field--radio">
          <legend>{t('quality.reasonLegend', 'Reason (required)')}</legend>
          {Object.keys(QUALITY_FLAG_REASONS).map((key) => (
            <label key={key} className="modal__radio">
              <input
                type="radio"
                name="reason"
                checked={reason === key}
                onChange={() => setReason(key as QualityFlagReason)}
              />
              {reasonLabels[key as QualityFlagReason]}
            </label>
          ))}
        </fieldset>

        {reason === 'other' && (
          <div className="modal__field">
            <label>{t('quality.specifyLabel', 'Please specify (required)')}</label>
            <input
              value={otherReason}
              onChange={(e) => setOtherReason(e.target.value)}
              placeholder={t('quality.specifyPlaceholder', 'Describe the issue')}
              autoFocus
            />
          </div>
        )}

        <div className="modal__field">
          <label>{t('quality.notesLabel', 'Notes (optional)')}</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('quality.notesPlaceholder', 'Additional context...')}
            rows={3}
          />
        </div>

        <div className="modal__actions">
          {isFlagged && (
            <button className="btn btn--ghost" onClick={onUnflag}>
              {t('quality.removeFlag', 'Remove flag')}
            </button>
          )}
          <button className="btn" onClick={onCancel}>{t('quality.cancel', 'Cancel')}</button>
          <button
            className="btn btn--primary"
            onClick={onSubmit}
            disabled={!reason || (reason === 'other' && !otherReason.trim())}
          >
            {isFlagged ? t('quality.updateFlag', 'Update flag') : t('quality.saveFlag', 'Save flag')}
          </button>
        </div>
      </div>
    </div>
  );
}
