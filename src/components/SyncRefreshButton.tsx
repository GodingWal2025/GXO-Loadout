import { useEffect, useRef, useState } from 'react';
import { forceFullSync, syncInspectorsNow } from '../shared';
import type { ForceSyncResult } from '../shared';
import { pullSitesFromServer, pushAllLocalSitesToServer } from '../services/sites';
import { syncStagingLocationsNow } from '../services/stagingLocations';
import { useT } from '../shared/i18n/LanguageContext';

type State = 'idle' | 'syncing' | 'ok' | 'error';

const RESULT_TIMEOUT_MS = 8000;

/**
 * Ask the service worker to re-check for a new build. registerType:'autoUpdate'
 * only checks on page load, and a standalone PWA on a dock can stay "loaded"
 * for weeks — so a device that's been away is often still running old JS
 * against a newer API. Resolves true when a newer worker is installed and a
 * reload would pick it up.
 */
async function checkForAppUpdate(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return false;
    await registration.update();
    // autoUpdate skips the waiting phase, so a fresh worker shows up as
    // installing/installed rather than sitting in `waiting`.
    return Boolean(registration.waiting || registration.installing);
  } catch {
    return false; // update checks are best-effort; never block the sync result
  }
}

/**
 * Manual "sync now" for a device that has been off the network for a while.
 * The background loop gives up on entries that exhausted their retry cap and
 * can't see photos whose queue entry was lost, so an idle device can sit on
 * data that will never leave on its own. This is the escape hatch: it revives
 * everything, re-pulls the cloud, and reports what actually happened instead
 * of failing silently.
 */
export function SyncRefreshButton() {
  const t = useT();
  const [state, setState] = useState<State>('idle');
  const [result, setResult] = useState<ForceSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const dismissLater = () => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setState('idle'), RESULT_TIMEOUT_MS);
  };

  const handleClick = async () => {
    if (state === 'syncing') return;
    window.clearTimeout(timerRef.current);
    setState('syncing');
    setError(null);
    setResult(null);

    // Runs regardless of whether the sync itself succeeds — a stale build is
    // one of the reasons a returning device fails to sync in the first place.
    const updatePromise = checkForAppUpdate();

    try {
      const res = await forceFullSync();
      // Reference lists (sites, inspectors, staging lanes) live in
      // localStorage on their own loops — refresh them too, otherwise a
      // long-idle device still shows a stale site or inspector list.
      await Promise.allSettled([
        pushAllLocalSitesToServer().then(() => pullSitesFromServer()),
        syncInspectorsNow(),
        syncStagingLocationsNow(),
      ]);
      setResult(res);
      setState('ok');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
    const hasUpdate = await updatePromise;
    setUpdateReady(hasUpdate);
    // A pending app update needs a deliberate tap, so don't time it out.
    if (!hasUpdate) dismissLater();
  };

  return (
    <div className="sync-refresh">
      <button
        type="button"
        className={`sync-refresh__btn ${state === 'syncing' ? 'is-spinning' : ''}`}
        onClick={handleClick}
        disabled={state === 'syncing'}
        aria-label={t('shell.refresh', 'Refresh data')}
        title={t('shell.refresh', 'Refresh data')}
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

      {(state === 'ok' || state === 'error') && (
        <div className={`sync-refresh__popover ${state === 'error' ? 'is-error' : ''}`} role="status">
          {state === 'error' ? (
            <>
              <strong>{t('shell.refreshFailed', "Couldn't reach the server")}</strong>
              <span className="sync-refresh__detail">{error}</span>
              <span className="sync-refresh__detail">
                {t('shell.refreshFailedHint', 'Your work is saved on this device and will sync once you have a connection.')}
              </span>
            </>
          ) : (
            <>
              <strong>{t('shell.refreshDone', 'Refreshed')}</strong>
              <span className="sync-refresh__detail">
                {t('shell.refreshPulled', '{count} inspection(s) from the cloud', {
                  count: result?.pulled ?? 0,
                })}
              </span>
              {!!(result && (result.revived || result.photosRequeued)) && (
                <span className="sync-refresh__detail">
                  {t('shell.refreshRetried', '{count} stuck item(s) retried', {
                    count: (result.revived ?? 0) + (result.photosRequeued ?? 0),
                  })}
                </span>
              )}
              {!!result?.stillPending && (
                <span className="sync-refresh__detail">
                  {t('shell.refreshStillPending', '{count} item(s) still uploading', {
                    count: result.stillPending,
                  })}
                </span>
              )}
            </>
          )}
          {updateReady && (
            <span className="sync-refresh__detail sync-refresh__detail--update">
              {t('shell.updateReady', 'A newer version of the app is ready.')}
            </span>
          )}
          <button
            type="button"
            className={`sync-refresh__reload ${updateReady ? 'is-primary' : ''}`}
            onClick={() => window.location.reload()}
          >
            {updateReady
              ? t('shell.updateNow', 'Update & reload')
              : t('shell.reloadApp', 'Reload app')}
          </button>
        </div>
      )}
    </div>
  );
}
