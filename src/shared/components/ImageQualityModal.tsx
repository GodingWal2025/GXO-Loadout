import type { QualityIssue } from '../camera/imageQuality';
import { useT, type TranslateFn } from '../i18n/LanguageContext';

interface Props {
  previewUrl: string;
  issues: QualityIssue[];
  onRetake: () => void;
  onKeep: () => void;
}

/**
 * The issue text is produced by imageQuality.ts, which is not a component and
 * so cannot call the hook. Rather than shipping a key through the data, we
 * re-derive the copy here from the (type, severity) pair that already
 * identifies each issue. `issue.message` remains the fallback for any
 * combination not listed.
 */
function issueText(t: TranslateFn, issue: QualityIssue): string {
  const id = `${issue.type}:${issue.severity}`;
  switch (id) {
    case 'sideways:mild':
      return t(
        'imgQuality.msg.sideways',
        'This photo is wider than tall. If you held the device upright you can keep it; otherwise retake in portrait.'
      );
    case 'blurry:severe':
      return t(
        'imgQuality.msg.blurrySevere',
        'This photo looks very blurry. Make sure you held the camera steady.'
      );
    case 'blurry:mild':
      return t(
        'imgQuality.msg.blurryMild',
        'This photo may be slightly out of focus. Check that everything is sharp.'
      );
    case 'too_dark:severe':
      return t(
        'imgQuality.msg.tooDarkSevere',
        'The photo is very dark. Turn on more lights or use a flash.'
      );
    case 'too_dark:mild':
      return t('imgQuality.msg.tooDarkMild', 'The photo looks a little dark. More light would help.');
    case 'too_bright:severe':
      return t(
        'imgQuality.msg.tooBright',
        'The photo is overexposed. Try moving away from the light source.'
      );
    case 'low_contrast:mild':
      return t(
        'imgQuality.msg.lowContrast',
        'The photo has very low contrast. Make sure the subject is clearly visible.'
      );
    default:
      return issue.message;
  }
}

export function ImageQualityModal({ previewUrl, issues, onRetake, onKeep }: Props) {
  const t = useT();
  const hasSevere = issues.some((i) => i.severity === 'severe');
  const hasBlocking = issues.some((i) => i.blocking);

  return (
    <div className="modal-backdrop" onClick={onRetake}>
      <div className="modal modal--photo-check" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">
          {hasBlocking
            ? t('imgQuality.titleBlocking', '✋ Photo must be retaken')
            : hasSevere
            ? t('imgQuality.titleSevere', '⚠ Photo quality issue')
            : t('imgQuality.titleMinor', '⚠ Photo could be better')}
        </h3>
        <p className="modal__sub">
          {hasBlocking
            ? t('imgQuality.subBlocking', 'This photo does not meet the requirements and cannot be kept.')
            : hasSevere
            ? t('imgQuality.subSevere', 'The image has problems that will make it hard to read. Please retake.')
            : t('imgQuality.subMinor', "The image looks usable but isn't perfect. Retake if you can.")}
        </p>

        <div className="quality-preview">
          <img src={previewUrl} alt={t('imgQuality.previewAlt', 'Captured photo preview')} />
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
              <span className="quality-issue__text">{issueText(t, issue)}</span>
            </li>
          ))}
        </ul>

        {!hasBlocking && (
          <p className="modal__sub" style={{ fontSize: 11, marginTop: 12 }}>
            {t(
              'imgQuality.trainingNote',
              'If you keep this photo, it will be flagged for AI training so the model can learn from real-world image quality.'
            )}
          </p>
        )}

        <div className="modal__actions">
          {!hasBlocking && (
            <button className="btn btn--ghost" onClick={onKeep}>
              {t('imgQuality.keepAnyway', 'Keep anyway')}
            </button>
          )}
          <button className="btn btn--accent" onClick={onRetake} autoFocus>
            {t('imgQuality.retake', '📷 Retake photo')}
          </button>
        </div>
      </div>
    </div>
  );
}
