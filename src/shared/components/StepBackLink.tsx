import { Link, useLocation } from 'react-router-dom';
import { useT } from '../i18n/LanguageContext';

/**
 * "← Back" control for the multi-step inspection flow.
 *
 * Always points at an explicit previous step rather than browser history, so
 * the destination is right no matter how the inspector reached the screen
 * (deep link, resumed inspection, refresh). The current path travels along in
 * router state so the step-1 editor can return the inspector to where they
 * were after saving.
 *
 * `btn btn--ghost` on purpose — this must never read as the primary action.
 * The base .btn is already 56px tall, well past the 44px tap target.
 */
export function StepBackLink({ to }: { to: string }) {
  const t = useT();
  const location = useLocation();

  return (
    <div className="mb-16">
      <Link to={to} state={{ from: location.pathname }} className="btn btn--ghost">
        {t('nav.back', '← Back')}
      </Link>
    </div>
  );
}
