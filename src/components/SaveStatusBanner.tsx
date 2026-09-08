import { useEffect, useState } from 'react';
import { getSyncState, syncNow } from '../shared/services/sync';
import { getLocalSaveState, retryLocalSaves } from '../shared/services/localSave';
import { useT } from '../shared/i18n/LanguageContext';
import { SyncDetailsModal } from './SyncDetailsModal';

export function SaveStatusBanner() {
  const t = useT();
  const [sync, setSync] = useState(getSyncState);
  const [local, setLocal] = useState(getLocalSaveState);
  const [online, setOnline] = useState(navigator.onLine);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    const refresh = () => { setSync(getSyncState()); setLocal(getLocalSaveState()); setOnline(navigator.onLine); };
    const events = ['loadout-sync-status', 'loadout-local-save', 'online', 'offline'];
    events.forEach(event => window.addEventListener(event, refresh));
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const state = getLocalSaveState();
      if (state.pending || state.failed) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { events.forEach(event => window.removeEventListener(event, refresh)); window.removeEventListener('beforeunload', beforeUnload); };
  }, []);
  return <>
    <div className={`save-status ${local.failed ? 'save-status--error' : ''}`} role="status">
      <span>{local.failed ? t('ops.saveFailed', 'Device save failed. Keep this screen open and retry.')
        : local.pending ? t('ops.savingDevice', 'Saving to this device…')
        : !online ? t('ops.savedOffline', 'Offline • device saves complete; cloud status unavailable')
        : sync.pending || sync.syncing ? t('ops.savedPending', 'Saved on device • {count} uploads pending', { count: sync.pending })
        : sync.error || !sync.lastSyncedAt ? t('ops.syncUnconfirmed', 'Device saves complete • cloud confirmation pending')
        : t('ops.savedCloud', 'Saved on device and synced to cloud')}</span>
      <button className="btn btn--sm" onClick={() => setDetails(true)}>{t('ops.uploadDetails', 'Upload details')}</button>
      {(local.failed > 0 || (sync.failedItems?.length || 0) > 0) && <button className="btn btn--sm" onClick={() => void retryLocalSaves().then(() => syncNow({ forceRetry: true })).catch(() => {})}>{t('ops.retrySaves', 'Retry failed saves')}</button>}
    </div>
    {details && <SyncDetailsModal onClose={() => setDetails(false)} />}
  </>;
}
