import { useState, useEffect } from 'react';
import { getSyncState, syncNow, type SyncState } from '../shared/services/sync';
import { useT } from '../shared/i18n/LanguageContext';

interface Props {
  onClose: () => void;
}

export function SyncDetailsModal({ onClose }: Props) {
  const t = useT();
  const [syncState, setSyncState] = useState<SyncState>(() => getSyncState());
  const [isTriggering, setIsTriggering] = useState(false);

  useEffect(() => {
    const update = (event: Event) => {
      setSyncState((event as CustomEvent<SyncState>).detail);
    };
    window.addEventListener('loadout-sync-status', update);
    return () => window.removeEventListener('loadout-sync-status', update);
  }, []);

  const handleManualSync = async () => {
    setIsTriggering(true);
    try {
      await syncNow({ forceRetry: true });
    } finally {
      setIsTriggering(false);
    }
  };

  const formatTime = (iso?: string) => {
    if (!iso) return t('sync.never', 'Never');
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return iso;
    }
  };

  const getRelativeTime = (iso?: string) => {
    if (!iso) return '';
    try {
      const diffMs = Date.now() - new Date(iso).getTime();
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 10) return t('sync.justNow', 'Just now');
      if (diffSec < 60) return t('sync.secondsAgo', '{n}s ago', { n: diffSec });
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return t('sync.minutesAgo', '{n}m ago', { n: diffMin });
      const diffHr = Math.floor(diffMin / 60);
      return t('sync.hoursAgo', '{n}h ago', { n: diffHr });
    } catch {
      return '';
    }
  };

  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  const isBusy = syncState.syncing || isTriggering;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 540, width: '92%' }}
      >
        <div className="modal__head">
          <div>
            <h2 className="modal__title">
              {t('sync.titleLead', 'Cloud')} <em>{t('sync.titleEm', 'Synchronization')}</em>
            </h2>
            <div className="xs soft" style={{ marginTop: 2 }}>
              {t('sync.subtitle', 'Live sync status between this tablet and Azure server')}
            </div>
          </div>
          <button type="button" className="btn btn--sm btn--ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Device Safety Status Banner */}
          {syncState.isSafeToClose && isOnline ? (
            <div
              className="card"
              style={{
                background: 'var(--success-bg)',
                borderLeft: '4px solid var(--success)',
                padding: '12px 16px',
                margin: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22, color: 'var(--success)' }}>✓</span>
                <div>
                  <div className="fw-600" style={{ color: 'var(--success)', fontSize: 14 }}>
                    {t('sync.safeToClose', 'Safe to close app or switch devices')}
                  </div>
                  <div className="xs soft" style={{ marginTop: 2 }}>
                    {t(
                      'sync.allSaved',
                      'All inspection records, photos, and edits are fully saved to the cloud.'
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : isBusy ? (
            <div
              className="card"
              style={{
                background: 'var(--info-bg)',
                borderLeft: '4px solid var(--info)',
                padding: '12px 16px',
                margin: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>⏳</span>
                <div>
                  <div className="fw-600" style={{ color: 'var(--info)', fontSize: 14 }}>
                    {t('sync.syncingInProgress', 'Uploading changes to server…')}
                  </div>
                  <div className="xs soft" style={{ marginTop: 2 }}>
                    {t(
                      'sync.keepOpenWhileSyncing',
                      'Please keep the app open while uploads finish.'
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : !isOnline ? (
            <div
              className="card"
              style={{
                background: 'var(--warn-bg)',
                borderLeft: '4px solid var(--warn)',
                padding: '12px 16px',
                margin: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>📡</span>
                <div>
                  <div className="fw-600" style={{ color: 'var(--warn)', fontSize: 14 }}>
                    {t('sync.offlineTitle', 'Offline mode — local changes queued')}
                  </div>
                  <div className="xs soft" style={{ marginTop: 2 }}>
                    {t(
                      'sync.offlineDesc',
                      'All data is saved locally on this tablet and will automatically upload when network reconnects.'
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div
              className="card"
              style={{
                background: 'var(--warn-bg)',
                borderLeft: '4px solid var(--warn)',
                padding: '12px 16px',
                margin: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>⚠</span>
                <div>
                  <div className="fw-600" style={{ color: 'var(--warn)', fontSize: 14 }}>
                    {t('sync.pendingUploadsWarning', '{count} upload(s) pending', {
                      count: syncState.pending,
                    })}
                  </div>
                  <div className="xs soft" style={{ marginTop: 2 }}>
                    {t(
                      'sync.pendingDoNotClose',
                      'Do not change devices until pending uploads complete.'
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Sync Stats Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
            }}
          >
            <div className="card" style={{ margin: 0, padding: '12px 14px' }}>
              <div className="xs soft" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('sync.lastSyncedLabel', 'Last synced')}
              </div>
              <div className="fw-600" style={{ fontSize: 16, marginTop: 4 }}>
                {formatTime(syncState.lastSyncedAt)}
              </div>
              {syncState.lastSyncedAt && (
                <div className="xs soft" style={{ marginTop: 2 }}>
                  {getRelativeTime(syncState.lastSyncedAt)}
                </div>
              )}
            </div>

            <div className="card" style={{ margin: 0, padding: '12px 14px' }}>
              <div className="xs soft" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('sync.syncCadenceLabel', 'Sync cadence')}
              </div>
              <div className="fw-600" style={{ fontSize: 16, marginTop: 4 }}>
                {syncState.adaptiveIntervalSeconds
                  ? t('sync.everySeconds', 'Every {n}s', { n: syncState.adaptiveIntervalSeconds })
                  : 'Every 15s'}
              </div>
              <div className="xs soft" style={{ marginTop: 2 }}>
                {isOnline ? t('sync.onlineStatus', 'Network active') : t('sync.offlineStatus', 'Offline')}
              </div>
            </div>

            <div className="card" style={{ margin: 0, padding: '12px 14px' }}>
              <div className="xs soft" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('sync.pendingRecordsLabel', 'Inspection records')}
              </div>
              <div className="fw-600" style={{ fontSize: 18, marginTop: 4 }}>
                {syncState.pendingRecords > 0 ? (
                  <span style={{ color: 'var(--warn)' }}>{syncState.pendingRecords} {t('sync.pendingUnit', 'pending')}</span>
                ) : (
                  <span style={{ color: 'var(--success)' }}>✓ {t('sync.upToDate', 'Up to date')}</span>
                )}
              </div>
            </div>

            <div className="card" style={{ margin: 0, padding: '12px 14px' }}>
              <div className="xs soft" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('sync.pendingPhotosLabel', 'Photo uploads')}
              </div>
              <div className="fw-600" style={{ fontSize: 18, marginTop: 4 }}>
                {syncState.pendingPhotos > 0 ? (
                  <span style={{ color: 'var(--warn)' }}>{syncState.pendingPhotos} {t('sync.pendingUnit', 'pending')}</span>
                ) : (
                  <span style={{ color: 'var(--success)' }}>✓ {t('sync.allUploaded', 'All uploaded')}</span>
                )}
              </div>
            </div>
          </div>

          {/* Failed / Retrying list if any */}
          {syncState.failedItems && syncState.failedItems.length > 0 && (
            <div className="card" style={{ margin: 0, borderLeft: '3px solid var(--danger)' }}>
              <div className="xs fw-600" style={{ color: 'var(--danger)', marginBottom: 6 }}>
                {t('sync.retryListTitle', 'Items waiting for retry ({count})', { count: syncState.failedItems.length })}
              </div>
              <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {syncState.failedItems.map((item) => (
                  <div key={item.id} className="xs soft" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span className="mono">{item.type} ({item.id.slice(0, 8)}…)</span>
                    <span style={{ color: 'var(--danger)' }}>{item.error}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal__actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
          <button
            type="button"
            className="btn btn--accent"
            disabled={isBusy}
            onClick={handleManualSync}
          >
            {isBusy ? t('sync.syncingBtn', 'Syncing…') : t('sync.syncNowBtn', '⟳ Sync now / Retry all')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t('sync.closeBtn', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
}
