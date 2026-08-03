import { useEffect, useRef, useState } from 'react';
import { useT } from '../shared/i18n/LanguageContext';
import { syncNow } from '../shared/services/sync';

type State = 'idle' | 'checking' | 'done';
const RESULT_TIMEOUT_MS = 5000;

async function checkForAppUpdate(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return false;
    await registration.update();
    return Boolean(registration.waiting || registration.installing);
  } catch {
    return false;
  }
}

/** Pushes pending work, pulls shared records, and checks for an app update. */
export function SyncRefreshButton() {
  const t = useT();
  const [state, setState] = useState<State>('idle');
  const [updateReady, setUpdateReady] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const handleClick = async () => {
    if (state === 'checking') return;
    window.clearTimeout(timerRef.current);
    setState('checking');
    await syncNow();
    const ready = await checkForAppUpdate();
    setUpdateReady(ready);
    window.dispatchEvent(new CustomEvent('loadout-data-updated'));
    setState('done');
    if (!ready) {
      timerRef.current = window.setTimeout(() => setState('idle'), RESULT_TIMEOUT_MS);
    }
  };

  return (
    <div className="sync-refresh">
      <button
        type="button"
        className={`sync-refresh__btn ${state === 'checking' ? 'is-spinning' : ''}`}
        onClick={handleClick}
        disabled={state === 'checking'}
        aria-label={t('shell.refresh', 'Sync shared data')}
        title={t('shell.refresh', 'Sync shared data')}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4"
          />
        </svg>
      </button>

      {state === 'done' && (
        <div className="sync-refresh__popover" role="status">
          <strong>
            {updateReady
              ? t('shell.updateReady', 'A newer version is ready')
              : t('shell.localRefreshed', 'Shared data synchronized')}
          </strong>
          <span className="sync-refresh__detail">
            {t('shell.localOnlyHint', 'Inspections and photos are shared with every device.')}
          </span>
          <button
            type="button"
            className={`sync-refresh__reload ${updateReady ? 'is-primary' : ''}`}
            onClick={() => window.location.reload()}
          >
            {updateReady ? t('shell.updateNow', 'Update & reload') : t('shell.reloadApp', 'Reload app')}
          </button>
        </div>
      )}
    </div>
  );
}
