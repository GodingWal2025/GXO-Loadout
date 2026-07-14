import { useState } from 'react';
import type { QualityFlag, QualityFlagReason } from '../types/inspection';
import { QUALITY_FLAG_REASONS } from '../types/inspection';

interface Props {
  flag?: QualityFlag;
  level: 'photo' | 'pallet' | 'inspection';
  onFlag: (flag: QualityFlag) => void;
  onUnflag: () => void;
  currentUser: string;
}

export function QualityFlagButton({ flag, level, onFlag, onUnflag, currentUser }: Props) {
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
          aria-label="Flag quality issue"
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

  const buttonLabel = isFlagged ? '⚑ Flagged' : '⚑ Flag issue';
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
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">{isFlagged ? 'Edit quality flag' : 'Flag quality issue'}</h3>
        <p className="modal__sub">
          {level === 'photo' && 'Flag this specific photo as a quality concern.'}
          {level === 'pallet' && 'Flag this entire pallet as a quality concern.'}
          {level === 'inspection' && 'Flag this entire load as a quality concern.'}
        </p>

        <fieldset className="modal__field modal__field--radio">
          <legend>Reason (required)</legend>
          {Object.entries(QUALITY_FLAG_REASONS).map(([key, label]) => (
            <label key={key} className="modal__radio">
              <input
                type="radio"
                name="reason"
                checked={reason === key}
                onChange={() => setReason(key as QualityFlagReason)}
              />
              {label}
            </label>
          ))}
        </fieldset>

        {reason === 'other' && (
          <div className="modal__field">
            <label>Please specify (required)</label>
            <input
              value={otherReason}
              onChange={(e) => setOtherReason(e.target.value)}
              placeholder="Describe the issue"
              autoFocus
            />
          </div>
        )}

        <div className="modal__field">
          <label>Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Additional context..."
            rows={3}
          />
        </div>

        <div className="modal__actions">
          {isFlagged && (
            <button className="btn btn--ghost" onClick={onUnflag}>Remove flag</button>
          )}
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={onSubmit}
            disabled={!reason || (reason === 'other' && !otherReason.trim())}
          >
            {isFlagged ? 'Update flag' : 'Save flag'}
          </button>
        </div>
      </div>
    </div>
  );
}
