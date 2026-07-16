import type { QualityIssue } from '../camera/imageQuality';

interface Props {
  previewUrl: string;
  issues: QualityIssue[];
  onRetake: () => void;
  onKeep: () => void;
}

export function ImageQualityModal({ previewUrl, issues, onRetake, onKeep }: Props) {
  const hasSevere = issues.some((i) => i.severity === 'severe');
  const hasBlocking = issues.some((i) => i.blocking);

  return (
    <div className="modal-backdrop" onClick={onRetake}>
      <div className="modal modal--photo-check" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">
          {hasBlocking ? '✋ Photo must be retaken' : hasSevere ? '⚠ Photo quality issue' : '⚠ Photo could be better'}
        </h3>
        <p className="modal__sub">
          {hasBlocking
            ? 'This photo does not meet the requirements and cannot be kept.'
            : hasSevere
            ? 'The image has problems that will make it hard to read. Please retake.'
            : "The image looks usable but isn't perfect. Retake if you can."}
        </p>

        <div className="quality-preview">
          <img src={previewUrl} alt="Captured photo preview" />
        </div>

        <ul className="quality-issues">
          {issues.map((issue, idx) => (
            <li
              key={idx}
              className={`quality-issue quality-issue--${issue.severity}`}
            >
              <span className="quality-issue__icon">
                {issue.severity === 'severe' ? '⚠' : 'i'}
              </span>
              <span className="quality-issue__text">{issue.message}</span>
            </li>
          ))}
        </ul>

        {!hasBlocking && (
          <p className="modal__sub" style={{ fontSize: 11, marginTop: 12 }}>
            If you keep this photo, it will be flagged for AI training so the model
            can learn from real-world image quality.
          </p>
        )}

        <div className="modal__actions">
          {!hasBlocking && (
            <button className="btn btn--ghost" onClick={onKeep}>
              Keep anyway
            </button>
          )}
          <button className="btn btn--accent" onClick={onRetake} autoFocus>
            📷 Retake photo
          </button>
        </div>
      </div>
    </div>
  );
}
