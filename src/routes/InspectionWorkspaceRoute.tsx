import { useEffect, useState, useMemo } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { dbGetInspection, dbArchiveInspection } from '../shared';
import { useInspection, useInspectionMode, ViewEditToggle } from '../shared';
import type { Inspection, PalletType, Delivery, PalletInspection } from '../shared';
import { PALLET_TYPES, expectedBags, actualCountInUom, actualCountUom, ConfirmModal, UndoToast, isPackagingLine, normalizeBatchCode, picklistHasOcr } from '../shared';
import { RunningTallyHeader } from '../components/RunningTallyHeader';
import { InspectorPicker } from '../shared';
import { InspectionProgressModal } from '../components/InspectionProgressModal';
import { AdjustOrderModal } from '../components/AdjustOrderModal';
import { useT } from '../shared/i18n/LanguageContext';
import {
  getInspectionWorkspaceRedirect,
  getPreviousInspectionStep,
} from './inspectionWorkspaceNavigation';

// Pallet types are persisted data, so the stored value stays English. This hook
// translates them only where they are displayed.
function usePalletTypeLabel(): (value: string) => string {
  const t = useT();
  const labels: Record<string, string> = {
    'Full Bag Pallet': t('pallet.typeFullBag', 'Full Bag Pallet'),
    'Partial Bag Pallet': t('pallet.typePartialBag', 'Partial Bag Pallet'),
    'Mixed Bag Pallet': t('pallet.typeMixedBag', 'Mixed Bag Pallet'),
    Seedpak: t('pallet.typeSeedpak', 'Seedpak'),
    Minibulk: t('pallet.typeMinibulk', 'Minibulk'),
  };
  return (value: string) => labels[value] ?? value;
}

export function InspectionWorkspaceRoute() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<Inspection | null>(null);

  useEffect(() => {
    if (!id) return;
    dbGetInspection(id).then((i) => {
      if (!i) navigate('/');
      else {
        const redirect = getInspectionWorkspaceRedirect(i);
        if (redirect) navigate(redirect, { replace: true });
        else setLoaded(i);
      }
    });
  }, [id, navigate]);

  if (!loaded) return null;
  return <WorkspaceInner initial={loaded} />;
}

function WorkspaceInner({ initial }: { initial: Inspection }) {
  const { inspection, dispatch } = useInspection(initial);
  const { locked, editing, readOnly, setEditing } = useInspectionMode(inspection);
  const t = useT();
  const palletTypeLabel = usePalletTypeLabel();
  const navigate = useNavigate();
  const location = useLocation();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showHandoffModal, setShowHandoffModal] = useState(false);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string | React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  const [undoToast, setUndoToast] = useState<{
    message: string;
    onUndo: () => void;
  } | null>(null);

  const warnings = useMemo(() => {
    const list: string[] = [];
    if (inspection.type !== 'returns') return list;

    // 1. Check Full Bag Pallets
    for (const p of inspection.pallets) {
      if (p.palletType === 'Full Bag Pallet') {
        const totalActual = p.batchSections.reduce((sum, bs) => sum + (bs.actualBagCount.value || 0), 0);
        if (totalActual !== 60) {
          list.push(
            t(
              'workspace.warnFullBagCount',
              'Pallet #{pallet} is marked as a Full Bag Pallet but has {count} bags. It must contain exactly 60 bags.',
              { pallet: p.palletNumber, count: totalActual }
            )
          );
        }
      }
    }

    // 2. Check Partial Bag Pallet Batch Duplication
    const partialPalletsByBatch: Record<string, number[]> = {};
    for (const p of inspection.pallets) {
      if (p.palletType === 'Partial Bag Pallet') {
        for (const bs of p.batchSections) {
          const batchCode = bs.batchCode.value?.trim();
          if (batchCode) {
            if (!partialPalletsByBatch[batchCode]) {
              partialPalletsByBatch[batchCode] = [];
            }
            if (!partialPalletsByBatch[batchCode].includes(p.palletNumber)) {
              partialPalletsByBatch[batchCode].push(p.palletNumber);
            }
          }
        }
      }
    }

    for (const [batchCode, palletNums] of Object.entries(partialPalletsByBatch)) {
      if (palletNums.length > 1) {
        list.push(
          t(
            'workspace.warnSplitBatch',
            'Batch "{batch}" is split across multiple partial pallets (Pallets #{pallets}). We want only one partial pallet per batch code.',
            { batch: batchCode, pallets: palletNums.join(', ') }
          )
        );
      }
    }

    return list;
  }, [inspection.pallets, inspection.type, t]);

  // For outbound + OCR, packaging SKUs are excluded from completion counts.
  const excludePackaging =
    inspection.type === 'outbound' && picklistHasOcr(inspection.picklist);
  const productLineItems = excludePackaging
    ? inspection.picklist.lineItems.filter((li) => !isPackagingLine(li))
    : inspection.picklist.lineItems;

  const allFulfilled =
    inspection.type === 'returns'
      ? true // Returns are ad-hoc counts, we don't enforce exact picklist fulfillment
      : productLineItems.length === 0 ||
        productLineItems.every((li) => li.fulfilled);

  // Both sides of this comparison must be in BAGS. actualQuantity is a bag tally,
  // so the expected side needs the same UOM conversion the header uses — summing
  // raw expectedQuantity would compare bags against pallets/SeedPaks and report a
  // total that disagrees with the tally header on the very same screen.
  const totalExpected = productLineItems.reduce(
    (sum, li) => sum + expectedBags(li.uom, li.expectedQuantity.value, li.description.value),
    0
  );
  const totalActual = productLineItems.reduce((sum, li) => sum + li.actualQuantity, 0);
  // Floor at zero: an over-scan should never render as "-39 more bags to scan".
  const remaining = Math.max(0, totalExpected - totalActual);

  const loadNum =
    inspection.type === 'returns'
      ? inspection.returnsBol?.bolNumber?.value || inspection.id.slice(0, 8)
      : inspection.picklist.loadNumber.value ||
        inspection.bol.loadNumber.value ||
        inspection.id.slice(0, 8);

  // Group deliveries by stop number for the new "Stops → Deliveries → Pallets" hierarchy
  const stops: Record<string, Delivery[]> = {};
  for (const d of inspection.bol.deliveries) {
    const key = String(d.stopNumber ?? 'unassigned');
    if (!stops[key]) stops[key] = [];
    stops[key].push(d);
  }
  const stopKeys = Object.keys(stops).sort((a, b) => {
    if (a === 'unassigned') return 1;
    if (b === 'unassigned') return -1;
    return Number(a) - Number(b);
  });

  const palletsByDelivery: Record<string, PalletInspection[]> = {};
  for (const p of inspection.pallets) {
    if (!palletsByDelivery[p.deliveryId]) palletsByDelivery[p.deliveryId] = [];
    palletsByDelivery[p.deliveryId].push(p);
  }

  const addPallet = (palletType: PalletType, deliveryId: string, batchCount: 1 | 2 | 3) => {
    dispatch({
      type: 'ADD_PALLET',
      palletType,
      deliveryId,
      batchCount,
      scannedBy: inspection.currentInspector || inspection.startedBy,
    });
    setShowAddModal(false);
    setTimeout(() => {
      navigate(`/inspection/${inspection.id}/pallet/${inspection.pallets.length}`);
    }, 50);
  };

  const performHandoff = (newInspectorName: string) => {
    dispatch({ type: 'SET_CURRENT_INSPECTOR', name: newInspectorName });
    setShowHandoffModal(false);
  };

  const handleArchive = () => {
    setConfirmModal({
      title: t('workspace.archiveTitle', 'Archive this inspection?'),
      message: t(
        'workspace.confirmArchive',
        'Are you sure you want to archive this inspection? It will be hidden from the active list.'
      ),
      confirmLabel: t('workspace.archive', 'Archive'),
      danger: false,
      onConfirm: async () => {
        setConfirmModal(null);
        await dbArchiveInspection(inspection.id);
        navigate('/');
      },
    });
  };

  const requestDeletePallet = (palletNumber: number) => {
    const palletToDelete = inspection.pallets[palletNumber - 1];
    if (!palletToDelete) return;
    const bagCount = palletToDelete.batchSections.reduce(
      (sum, bs) => sum + (bs.actualBagCount.value || 0),
      0
    );
    const photoCount = palletToDelete.photos?.length || 0;

    setConfirmModal({
      title: t('workspace.deletePalletTitle', 'Delete Pallet #{number}?', { number: palletNumber }),
      message: t(
        'workspace.deletePalletMessage',
        'Are you sure you want to delete Pallet #{number}? {bags} bags and {photos} photos will be removed.',
        { number: palletNumber, bags: bagCount, photos: photoCount }
      ),
      confirmLabel: t('common.delete', 'Delete'),
      danger: true,
      onConfirm: () => {
        setConfirmModal(null);
        const savedPallet = { ...palletToDelete };
        const savedIndex = palletNumber - 1;
        dispatch({ type: 'REMOVE_PALLET', index: savedIndex });

        setUndoToast({
          message: t('workspace.palletDeletedToast', 'Pallet #{number} removed', { number: palletNumber }),
          onUndo: () => {
            dispatch({ type: 'RESTORE_PALLET', pallet: savedPallet, atIndex: savedIndex });
            setUndoToast(null);
          },
        });
      },
    });
  };

  return (
    <>
      {inspection.type === 'outbound' && (
        <RunningTallyHeader
          picklist={inspection.picklist}
          pallets={inspection.pallets}
          startedBy={inspection.startedBy}
          currentInspector={inspection.currentInspector}
          handoffLog={inspection.handoffLog}
          inspectionType={inspection.type}
        />
      )}
      <main>
        <div className="page-head">
          <div>
            <h1 className="page-head__title mono">#{loadNum}</h1>
            <div className="page-head__sub">
              {t('workspace.palletsCount', '{count} pallets', { count: inspection.pallets.length })} ·{' '}
              {inspection.bol.deliveries.length === 1
                ? t('workspace.deliveryCountOne', '{count} delivery', { count: 1 })
                : t('workspace.deliveryCountMany', '{count} deliveries', {
                    count: inspection.bol.deliveries.length,
                  })}
              {inspection.type !== 'returns' && (
                <>
                  {' '}·{' '}
                  {stopKeys.length === 1
                    ? t('workspace.stopCountOne', '{count} stop', { count: 1 })
                    : t('workspace.stopCountMany', '{count} stops', { count: stopKeys.length })}
                </>
              )}
              {inspection.stagingLocation && (
                <>
                  {' '}·{' '}
                  {t('workspace.staging', 'Staging: {location}', {
                    location: inspection.stagingLocation,
                  })}
                </>
              )}
            </div>
          </div>
          <div className="page-head__actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {locked && <ViewEditToggle editing={editing} onChange={setEditing} />}
            <Link
              to={getPreviousInspectionStep(inspection)}
              state={{ from: location.pathname }}
              className="btn btn--ghost"
            >
              {t('nav.back', '← Back')}
            </Link>
            <button className="btn btn--ghost" onClick={() => setShowProgressModal(true)}>
              {t('workspace.reviewProgress', 'Review progress')}
            </button>
            {!readOnly && inspection.type !== 'returns' && (
              <button className="btn btn--ghost" onClick={() => setShowAdjustModal(true)}>
                {t('workspace.adjustOrder', 'Adjust order')}
              </button>
            )}
            {!readOnly && (
              <button className="btn btn--ghost" onClick={handleArchive}>
                {t('workspace.archive', 'Archive')}
              </button>
            )}
            <Link to="/" className="btn btn--ghost">{t('workspace.home', '← Home')}</Link>
          </div>
        </div>

        {readOnly && (
          <div className="banner banner--info" style={{ marginBottom: 20 }}>
            <span className="banner__icon">👁</span>
            <div className="banner__body">
              {t('workspace.viewBannerPre', 'This inspection is complete and is open in')}{' '}
              <strong>{t('workspace.viewBannerMode', 'view mode')}</strong>
              {t(
                'workspace.viewBannerPost',
                '. Tap a pallet to review it, or switch to Edit in the corner to make changes.'
              )}
            </div>
          </div>
        )}

        {/* Handoff bar */}
        <div className="handoff-bar">
          <div>
            <div className="xs soft" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {t('workspace.scanningAs', 'Scanning as')}
            </div>
            <div className="fw-500" style={{ fontSize: 16, marginTop: 2 }}>
              {inspection.currentInspector ||
                inspection.startedBy ||
                t('workspace.unknownInspector', 'Unknown')}
            </div>
            {inspection.handoffLog && inspection.handoffLog.length > 0 && (
              <div className="xs soft" style={{ marginTop: 4 }}>
                {inspection.handoffLog.length === 1
                  ? t('workspace.handoffCountOne', '{count} handoff this load', { count: 1 })
                  : t('workspace.handoffCountMany', '{count} handoffs this load', {
                      count: inspection.handoffLog.length,
                    })}
              </div>
            )}
          </div>
          {!readOnly && (
            <button className="btn btn--sm" onClick={() => setShowHandoffModal(true)}>
              {t('workspace.handoffButton', '⇄ Hand off to another inspector')}
            </button>
          )}
        </div>

        {inspection.handoffLog && inspection.handoffLog.length > 0 && (
          <details className="handoff-history">
            <summary>{t('workspace.handoffHistory', 'Handoff history')}</summary>
            <ul>
              {inspection.handoffLog.map((entry, i) => (
                <li key={i}>
                  <strong>{entry.fromInspector || t('workspace.handoffStarted', 'started')}</strong> →{' '}
                  <strong>{entry.toInspector}</strong>{' '}
                  <span className="xs soft">
                    ({new Date(entry.at).toLocaleString()})
                    {entry.palletsCompletedByPrevious.length > 0 && (
                      <>
                        {' '}·{' '}
                        {t('workspace.handoffCompleted', '{name} completed pallets {pallets}', {
                          name: entry.fromInspector ?? '',
                          pallets: entry.palletsCompletedByPrevious.join(', '),
                        })}
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {!readOnly && (
          <button
            className="btn btn--accent btn--hero"
            onClick={() => setShowAddModal(true)}
            style={{ marginBottom: 32 }}
          >
            <span className="btn--hero__icon">＋</span>
            <span className="btn--hero__body">
              <div className="btn--hero__title">{t('workspace.scanNextPallet', 'Scan next pallet')}</div>
              <div className="btn--hero__sub">
                {inspection.type === 'returns'
                  ? t('workspace.pickDeliveryType', 'Pick delivery and pallet type')
                  : t('workspace.pickStopDeliveryType', 'Pick stop, delivery, and pallet type')}
              </div>
            </span>
            <span className="btn--hero__arrow">→</span>
          </button>
        )}

        {showAddModal && (
          <AddPalletModal
            stops={stops}
            stopKeys={stopKeys}
            deliveries={inspection.bol.deliveries}
            isReturns={inspection.type === 'returns'}
            onAdd={addPallet}
            onClose={() => setShowAddModal(false)}
          />
        )}

        {showHandoffModal && (
          <HandoffModal
            currentInspector={inspection.currentInspector || inspection.startedBy || ''}
            siteId={inspection.siteId}
            onSubmit={performHandoff}
            onClose={() => setShowHandoffModal(false)}
          />
        )}

        {showProgressModal && (
          <InspectionProgressModal
            inspection={inspection}
            onClose={() => setShowProgressModal(false)}
          />
        )}

        {showAdjustModal && (
          <AdjustOrderModal
            inspection={inspection}
            onClose={() => setShowAdjustModal(false)}
            onAdjustLine={(index, patch, reason) => {
              const inspectorName =
                inspection.currentInspector || inspection.startedBy || 'unknown';
              dispatch({
                type: 'ADJUST_PICKLIST_LINE',
                index,
                patch,
                adjustedBy: inspectorName,
                reason,
              });
            }}
            onAddLine={(line) => {
              dispatch({ type: 'ADD_PICKLIST_LINE', line });
            }}
          />
        )}

        {inspection.bol.deliveries.length === 0 ? (
          <div className="empty">
            <div className="empty__title">
              {t('workspace.noDeliveriesTitle', 'No deliveries on this load')}
            </div>
            <div className="empty__sub">
              {t(
                'workspace.noDeliveriesSub',
                'Go back to verify the BOL and add at least one delivery before scanning pallets.'
              )}
            </div>
            <Link
              to={`/inspection/${inspection.id}/verify`}
              className="btn btn--accent"
              style={{ marginTop: 12 }}
            >
              {t('workspace.backToVerify', 'Back to verify')}
            </Link>
          </div>
        ) : inspection.type === 'returns' ? (
          <section className="stop-section">
            <div className="stop-section__head">
              <h2 className="stop-section__title">
                {t('workspace.returnedPallets', 'Returned Pallets')}
              </h2>
              <span className="stop-section__meta">
                {inspection.pallets.length === 1
                  ? t('workspace.palletCountOne', '{count} pallet', { count: 1 })
                  : t('workspace.palletsCount', '{count} pallets', {
                      count: inspection.pallets.length,
                    })}
              </span>
            </div>
            {inspection.pallets.length === 0 ? (
              <div className="empty" style={{ padding: 16 }}>
                <div className="empty__sub">
                  {t('workspace.noPalletsYet', 'No pallets scanned yet.')}
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: 8,
                }}
              >
                {inspection.pallets.map((p) => (
                  <Link
                    key={p.palletNumber}
                    to={`/inspection/${inspection.id}/pallet/${p.palletNumber - 1}`}
                    className="card"
                    style={{
                      textDecoration: 'none',
                      color: 'inherit',
                      margin: 0,
                      borderLeft: p.qualityFlag ? '3px solid var(--danger)' : undefined,
                    }}
                  >
                    <div className="row-between">
                      <div
                        className="xs soft"
                        style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
                      >
                        {t('workspace.palletLabel', 'Pallet {number}', {
                          number: p.palletNumber,
                        })}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {p.scannedBy && (
                          <div
                            className="xs soft"
                            title={t('workspace.scannedBy', 'Scanned by {name}', {
                              name: p.scannedBy,
                            })}
                            style={{ fontFamily: 'JetBrains Mono, monospace' }}
                          >
                            {p.scannedBy.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                          </div>
                        )}
                        {!readOnly && (
                          <button
                            type="button"
                            title={t('workspace.deletePallet', 'Delete pallet')}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              requestDeletePallet(p.palletNumber);
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--ink-soft)',
                              cursor: 'pointer',
                              padding: '2px 4px',
                              fontSize: 14,
                              lineHeight: 1,
                            }}
                          >
                            🗑
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="fw-500" style={{ fontSize: 20, marginTop: 4 }}>
                      {p.batchSections.reduce(
                        (sum: number, bs) => sum + (bs.actualBagCount.value || 0),
                        0
                      ) || '—'}
                      <span className="xs soft fw-500" style={{ marginLeft: 4 }}>
                        {t('workspace.bagsUnit', 'bags')}
                      </span>
                    </div>
                    {p.batchSections.map((bs) => (
                      <div key={bs.id} className="xs mono faint" style={{ marginTop: 2, textTransform: 'uppercase' }}>
                        {bs.batchCode.value || '—'}
                        {bs.actualBagCount.value !== null && (
                          <span style={{ color: 'var(--ink-soft)' }}>
                            {' '}· {bs.actualBagCount.value}
                          </span>
                        )}
                      </div>
                    ))}
                    <div className="xs soft" style={{ marginTop: 4 }}>
                      {palletTypeLabel(p.palletType)}
                    </div>
                    {p.qualityFlag && (
                      <div className="xs" style={{ color: 'var(--danger)', marginTop: 4 }}>
                        {t('workspace.flagged', '⚑ Flagged')}
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </section>

        ) : (
          stopKeys.map((stopKey) => (
            <StopSection
              key={stopKey}
              stopKey={stopKey}
              deliveries={stops[stopKey]}
              palletsByDelivery={palletsByDelivery}
              inspectionId={inspection.id}
              readOnly={readOnly}
              dispatch={dispatch}
              lineItems={inspection.picklist.lineItems}
              onDeletePallet={requestDeletePallet}
            />
          ))
        )}

        {warnings.length > 0 && (
          <div className="banner banner--warn" style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' }}>
            <div className="row-start gap-8" style={{ fontWeight: 600, fontSize: '15px' }}>
              <span className="banner__icon">⚠️</span>
              {t('workspace.attentionRequired', 'Attention Required')}
            </div>
            <ul style={{ listStyleType: 'disc', paddingLeft: '20px', margin: 0 }}>
              {warnings.map((w, i) => (
                <li key={i} className="small" style={{ lineHeight: '1.4' }}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <div
          className="row-between"
          style={{
            position: 'sticky',
            bottom: 0,
            background: 'var(--paper)',
            borderTop: '1px solid var(--rule-soft)',
            padding: '16px 0',
            marginTop: 24,
          }}
        >
          <button className="btn" onClick={() => navigate('/')}>
            {t('workspace.saveAndExit', 'Save & exit')}
          </button>
          <button
            className={`btn btn--lg ${
              readOnly || inspection.type === 'returns' || allFulfilled ? 'btn--accent' : 'btn--ghost'
            }`}
            onClick={() =>
              readOnly || inspection.type === 'returns' || allFulfilled
                ? navigate(`/inspection/${inspection.id}/complete`)
                : setShowProgressModal(true)
            }
          >
            {readOnly
              ? t('workspace.viewSummary', 'View summary →')
              : inspection.type === 'returns' || allFulfilled
              ? t('workspace.completeInspection', 'Complete inspection →')
              : remaining === 1
              ? t('workspace.moreBagsOne', '{count} more bag to scan', { count: 1 })
              : t('workspace.moreBagsMany', '{count} more bags to scan', { count: remaining })}
          </button>
        </div>
      </main>

      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          cancelLabel={confirmModal.cancelLabel}
          danger={confirmModal.danger}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {undoToast && (
        <UndoToast
          message={undoToast.message}
          onUndo={undoToast.onUndo}
          onDismiss={() => setUndoToast(null)}
        />
      )}
    </>
  );
}

function StopSection({
  stopKey,
  deliveries,
  palletsByDelivery,
  inspectionId,
  readOnly,
  dispatch,
  lineItems,
  onDeletePallet,
}: {
  stopKey: string;
  deliveries: Delivery[];
  palletsByDelivery: Record<string, PalletInspection[]>;
  inspectionId: string;
  readOnly?: boolean;
  dispatch?: any;
  lineItems?: any[];
  onDeletePallet?: (palletNumber: number) => void;
}) {
  const t = useT();
  const allPallets = deliveries.flatMap((d) => palletsByDelivery[d.id] || []);
  const stopLabel =
    stopKey === 'unassigned'
      ? t('workspace.unassigned', 'Unassigned')
      : t('workspace.stopLabel', 'Stop {number}', { number: stopKey });

  return (
    <section className="stop-section">
      <div className="stop-section__head">
        <h2 className="stop-section__title">{stopLabel}</h2>
        <span className="stop-section__meta">
          {deliveries.length === 1
            ? t('workspace.deliveryCountOne', '{count} delivery', { count: 1 })
            : t('workspace.deliveryCountMany', '{count} deliveries', { count: deliveries.length })}{' '}
          · {t('workspace.palletsCount', '{count} pallets', { count: allPallets.length })}
        </span>
      </div>

      {deliveries.map((delivery) => (
        <DeliveryGroup
          key={delivery.id}
          delivery={delivery}
          pallets={palletsByDelivery[delivery.id] || []}
          inspectionId={inspectionId}
          readOnly={readOnly}
          dispatch={dispatch}
          lineItems={lineItems}
          onDeletePallet={onDeletePallet}
        />
      ))}
    </section>
  );
}

function DeliveryGroup({
  delivery,
  pallets,
  inspectionId,
  readOnly,
  dispatch,
  lineItems,
  onDeletePallet,
}: {
  delivery: Delivery;
  pallets: PalletInspection[];
  inspectionId: string;
  readOnly?: boolean;
  dispatch?: any;
  lineItems?: any[];
  onDeletePallet?: (palletNumber: number) => void;
}) {
  const t = useT();
  const palletTypeLabel = usePalletTypeLabel();

  return (
    <div className="delivery-group">
      <div className="delivery-group__head">
        <div className="delivery-group__num mono">
          {t('workspace.deliveryLabel', 'Delivery {number}', { number: delivery.deliveryNumber })}
        </div>
        <div className="delivery-group__meta">
          {pallets.length === 1
            ? t('workspace.palletCountOne', '{count} pallet', { count: 1 })
            : t('workspace.palletsCount', '{count} pallets', { count: pallets.length })}
        </div>
      </div>

      {pallets.length === 0 ? (
        <div className="empty" style={{ padding: 16 }}>
          <div className="empty__sub">
            {t('workspace.noPalletsForDelivery', 'No pallets scanned for this delivery yet.')}
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 8,
          }}
        >
          {pallets.map((p) => (
            <Link
              key={p.palletNumber}
              to={`/inspection/${inspectionId}/pallet/${p.palletNumber - 1}`}
              className="card"
              style={{
                textDecoration: 'none',
                color: 'inherit',
                margin: 0,
                borderLeft: p.qualityFlag ? '3px solid var(--danger)' : undefined,
                position: 'relative',
              }}
            >
              <div className="row-between">
                <div
                  className="xs soft"
                  style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
                >
                  {t('workspace.palletLabel', 'Pallet {number}', { number: p.palletNumber })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {p.scannedBy && (
                    <div
                      className="xs soft"
                      title={t('workspace.scannedBy', 'Scanned by {name}', { name: p.scannedBy })}
                      style={{ fontFamily: 'JetBrains Mono, monospace' }}
                    >
                      {p.scannedBy.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                    </div>
                  )}
                  {!readOnly && (
                    <button
                      type="button"
                      title={t('workspace.deletePallet', 'Delete pallet')}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (onDeletePallet) {
                          onDeletePallet(p.palletNumber);
                        } else {
                          dispatch({ type: 'REMOVE_PALLET', index: p.palletNumber - 1 });
                        }
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--ink-soft)',
                        cursor: 'pointer',
                        padding: '2px 4px',
                        fontSize: 14,
                        lineHeight: 1,
                      }}
                    >
                      🗑
                    </button>
                  )}
                </div>
              </div>
              {(() => {
                let uomCode = 'BG';
                if (p.palletType === 'Seedpak') uomCode = 'SP';
                else if (p.palletType === 'Minibulk') uomCode = 'MB';
                else {
                  for (const bs of p.batchSections) {
                    if (bs.batchCode.value) {
                      const batchCode = normalizeBatchCode(bs.batchCode.value);
                      const li = lineItems?.find(
                        (item: any) => normalizeBatchCode(item.batchCode.value) === batchCode
                      );
                      if (li?.uom) {
                        uomCode = li.uom;
                        break;
                      }
                    }
                  }
                }
                const total = p.batchSections.reduce((sum: number, bs) => {
                  const batchCode = normalizeBatchCode(bs.batchCode.value);
                  const li = lineItems?.find(
                    (item: any) => normalizeBatchCode(item.batchCode.value) === batchCode
                  );
                  return (
                    sum +
                    actualCountInUom(
                      li?.uom || uomCode,
                      bs.actualBagCount.value,
                      li?.description.value
                    )
                  );
                }, 0);
                const formattedUnit =
                  uomCode === 'SP' || uomCode === 'SEEDPAK'
                    ? 'SP'
                    : uomCode === 'MB' || uomCode === 'MINIBULK'
                    ? 'MB'
                    : uomCode === 'PL'
                    ? actualCountUom(uomCode)
                    : uomCode === 'C62'
                    ? 'C62'
                    : t('workspace.bagsUnit', 'bags');

                return (
                  <div className="fw-500" style={{ fontSize: 20, marginTop: 4 }}>
                    {total || '—'}
                    <span className="xs soft fw-500" style={{ marginLeft: 4 }}>
                      {formattedUnit}
                    </span>
                  </div>
                );
              })()}
              {p.batchSections.map((bs) => (
                <div key={bs.id} className="xs mono faint" style={{ marginTop: 2, textTransform: 'uppercase' }}>
                  {bs.batchCode.value || '—'}
                  {bs.actualBagCount.value !== null && (
                    <span style={{ color: 'var(--ink-soft)' }}>
                      {' '}· {bs.actualBagCount.value}
                    </span>
                  )}
                </div>
              ))}
              <div className="xs soft" style={{ marginTop: 4 }}>
                {palletTypeLabel(p.palletType)}
              </div>
              {p.qualityFlag && (
                <div className="xs" style={{ color: 'var(--danger)', marginTop: 4 }}>
                  {t('workspace.flagged', '⚑ Flagged')}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function AddPalletModal({
  stops,
  stopKeys,
  deliveries,
  isReturns,
  onAdd,
  onClose,
}: {
  stops: Record<string, Delivery[]>;
  stopKeys: string[];
  deliveries: Delivery[];
  isReturns: boolean;
  onAdd: (palletType: PalletType, deliveryId: string, batchCount: 1 | 2 | 3) => void;
  onClose: () => void;
}) {
  const t = useT();
  const palletTypeLabel = usePalletTypeLabel();
  const [stopKey, setStopKey] = useState(stopKeys[0] || '');
  const [deliveryId, setDeliveryId] = useState(() => {
    if (isReturns) return deliveries[0]?.id || '';
    const deliveriesForStop = stops[stopKeys[0] || ''] || [];
    return deliveriesForStop[0]?.id || '';
  });
  const [palletType, setPalletType] = useState<PalletType | ''>('');
  const [batchCount, setBatchCount] = useState<1 | 2 | 3>(1);

  // Reset delivery when stop changes
  const handleStopChange = (newStopKey: string) => {
    setStopKey(newStopKey);
    const newDeliveries = stops[newStopKey] || [];
    setDeliveryId(newDeliveries[0]?.id || '');
  };

  const needsBatchCount = palletType === 'Mixed Bag Pallet';
  const canSubmit = palletType && deliveryId && (!needsBatchCount || batchCount);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">{t('workspace.scanNextPallet', 'Scan next pallet')}</h3>
        <p className="modal__sub">
          {t('workspace.modalSub', 'Pick stop, delivery, and pallet type.')}
        </p>

        {!isReturns && (
          <div className="modal__field">
            <label>{t('workspace.stopFieldLabel', 'Stop')}</label>
            <select value={stopKey} onChange={(e) => handleStopChange(e.target.value)}>
              {stopKeys.map((k) => (
                <option key={k} value={k}>
                  {k === 'unassigned'
                    ? t('workspace.unassigned', 'Unassigned')
                    : t('workspace.stopLabel', 'Stop {number}', { number: k })}
                </option>
              ))}
            </select>
          </div>
        )}

        {!isReturns && (
          <div className="modal__field">
            <label>{t('workspace.deliveryFieldLabel', 'Delivery')}</label>
            <select value={deliveryId} onChange={(e) => setDeliveryId(e.target.value)}>
              {(stops[stopKey] || []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.deliveryNumber}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="modal__field">
          <label>{t('pallet.typeLabel', 'Pallet type')}</label>
          <div className="flex-col gap-8">
            {(isReturns
              ? PALLET_TYPES.filter(pt => pt !== 'Mixed Bag Pallet' && pt !== 'Minibulk')
              : PALLET_TYPES
            ).map((pt) => (
              <button
                key={pt}
                type="button"
                className={`btn ${palletType === pt ? 'btn--accent' : ''}`}
                onClick={() => setPalletType(pt)}
                style={{ justifyContent: 'flex-start' }}
              >
                {palletTypeLabel(pt)}
              </button>
            ))}
          </div>
        </div>

        {needsBatchCount && (
          <div className="modal__field">
            <label>{t('workspace.howManyBatches', 'How many batches on this pallet?')}</label>
            <div className="flex gap-8">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`btn ${batchCount === n ? 'btn--accent' : ''}`}
                  onClick={() => setBatchCount(n as 1 | 2 | 3)}
                  style={{ flex: 1 }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>
            {t('workspace.cancel', 'Cancel')}
          </button>
          <button
            className="btn btn--accent"
            disabled={!canSubmit}
            onClick={() => {
              if (palletType && deliveryId) {
                onAdd(palletType, deliveryId, batchCount);
              }
            }}
          >
            {t('workspace.startScanning', 'Start scanning →')}
          </button>
        </div>
      </div>
    </div>
  );
}

function HandoffModal({
  currentInspector,
  siteId,
  onSubmit,
  onClose,
}: {
  currentInspector: string;
  siteId: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [newName, setNewName] = useState('');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">
          {t('workspace.handoffTitle', 'Hand off to another inspector')}
        </h3>
        <p className="modal__sub">
          {t(
            'workspace.handoffSubPre',
            'From this point forward, new pallets will be tagged to the new inspector. Previous pallets stay attributed to'
          )}{' '}
          <strong>{currentInspector}</strong>.
        </p>

        <div className="modal__field">
          <label>{t('workspace.newInspector', 'New inspector')}</label>
          <InspectorPicker
            siteId={siteId}
            value={newName}
            placeholder={t('workspace.selectInspector', 'Select inspector…')}
            onChange={setNewName}
          />
        </div>

        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>
            {t('workspace.cancel', 'Cancel')}
          </button>
          <button
            className="btn btn--accent"
            disabled={!newName || newName === currentInspector}
            onClick={() => onSubmit(newName)}
          >
            {t('workspace.confirmHandoff', 'Confirm handoff')}
          </button>
        </div>
      </div>
    </div>
  );
}
