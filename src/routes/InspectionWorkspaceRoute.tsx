import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { dbGetInspection, dbArchiveInspection } from '../shared';
import { useInspection, useInspectionMode, ViewEditToggle } from '../shared';
import type { Inspection, PalletType, Delivery, PalletInspection } from '../shared';
import { PALLET_TYPES } from '../shared';
import { RunningTallyHeader } from '../components/RunningTallyHeader';
import { InspectorPicker } from '../shared';
import { InspectionProgressModal } from '../components/InspectionProgressModal';

export function InspectionWorkspaceRoute() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<Inspection | null>(null);

  useEffect(() => {
    if (!id) return;
    dbGetInspection(id).then((i) => {
      if (!i) navigate('/');
      else setLoaded(i);
    });
  }, [id, navigate]);

  if (!loaded) return null;
  return <WorkspaceInner initial={loaded} />;
}

function WorkspaceInner({ initial }: { initial: Inspection }) {
  const { inspection, dispatch } = useInspection(initial);
  const { locked, editing, readOnly, setEditing } = useInspectionMode(inspection);
  const navigate = useNavigate();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showHandoffModal, setShowHandoffModal] = useState(false);
  const [showProgressModal, setShowProgressModal] = useState(false);

  const warnings = useMemo(() => {
    const list: string[] = [];
    if (inspection.type !== 'returns') return list;

    // 1. Check Full Bag Pallets
    for (const p of inspection.pallets) {
      if (p.palletType === 'Full Bag Pallet') {
        const totalActual = p.batchSections.reduce((sum, bs) => sum + (bs.actualBagCount.value || 0), 0);
        if (totalActual !== 60) {
          list.push(
            `Pallet #${p.palletNumber} is marked as a Full Bag Pallet but has ${totalActual} bags. It must contain exactly 60 bags.`
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
          `Batch "${batchCode}" is split across multiple partial pallets (Pallets #${palletNums.join(', ')}). We want only one partial pallet per batch code.`
        );
      }
    }

    return list;
  }, [inspection.pallets, inspection.type]);

  const allFulfilled =
    inspection.type === 'returns'
      ? true // Returns are ad-hoc counts, we don't enforce exact picklist fulfillment
      : inspection.picklist.lineItems.length === 0 ||
        inspection.picklist.lineItems.every((li) => li.fulfilled);

  const totalExpected = inspection.picklist.lineItems.reduce(
    (sum, li) => sum + (li.expectedQuantity.value || 0),
    0
  );
  const totalActual = inspection.picklist.lineItems.reduce((sum, li) => sum + li.actualQuantity, 0);
  const remaining = totalExpected - totalActual;

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

  const handleArchive = async () => {
    if (window.confirm('Are you sure you want to archive this inspection? It will be hidden from the active list.')) {
      await dbArchiveInspection(inspection.id);
      navigate('/');
    }
  };

  return (
    <>
      {inspection.type === 'outbound' && <RunningTallyHeader picklist={inspection.picklist} />}
      <main>
        <div className="page-head">
          <div>
            <h1 className="page-head__title mono">#{loadNum}</h1>
            <div className="page-head__sub">
              {inspection.pallets.length} pallets · {inspection.bol.deliveries.length}{' '}
              {inspection.bol.deliveries.length === 1 ? 'delivery' : 'deliveries'}
              {inspection.type !== 'returns' && <> · {stopKeys.length} {stopKeys.length === 1 ? 'stop' : 'stops'}</>}
              {inspection.stagingLocation && <> · Staging: {inspection.stagingLocation}</>}
            </div>
          </div>
          <div className="page-head__actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {locked && <ViewEditToggle editing={editing} onChange={setEditing} />}
            <button className="btn btn--ghost" onClick={() => setShowProgressModal(true)}>Review progress</button>
            {!readOnly && (
              <button className="btn btn--ghost" onClick={handleArchive}>Archive</button>
            )}
            <Link to="/" className="btn btn--ghost">← Home</Link>
          </div>
        </div>

        {readOnly && (
          <div className="banner banner--info" style={{ marginBottom: 20 }}>
            <span className="banner__icon">👁</span>
            <div className="banner__body">
              This inspection is complete and is open in <strong>view mode</strong>. Tap a pallet
              to review it, or switch to Edit in the corner to make changes.
            </div>
          </div>
        )}

        {/* Handoff bar */}
        <div className="handoff-bar">
          <div>
            <div className="xs soft" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Scanning as
            </div>
            <div className="fw-500" style={{ fontSize: 16, marginTop: 2 }}>
              {inspection.currentInspector || inspection.startedBy || 'Unknown'}
            </div>
            {inspection.handoffLog && inspection.handoffLog.length > 0 && (
              <div className="xs soft" style={{ marginTop: 4 }}>
                {inspection.handoffLog.length} handoff
                {inspection.handoffLog.length === 1 ? '' : 's'} this load
              </div>
            )}
          </div>
          {!readOnly && (
            <button className="btn btn--sm" onClick={() => setShowHandoffModal(true)}>
              ⇄ Hand off to another inspector
            </button>
          )}
        </div>

        {inspection.handoffLog && inspection.handoffLog.length > 0 && (
          <details className="handoff-history">
            <summary>Handoff history</summary>
            <ul>
              {inspection.handoffLog.map((entry, i) => (
                <li key={i}>
                  <strong>{entry.fromInspector || 'started'}</strong> →{' '}
                  <strong>{entry.toInspector}</strong>{' '}
                  <span className="xs soft">
                    ({new Date(entry.at).toLocaleString()})
                    {entry.palletsCompletedByPrevious.length > 0 && (
                      <> · {entry.fromInspector} completed pallets{' '}
                      {entry.palletsCompletedByPrevious.join(', ')}</>
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
              <div className="btn--hero__title">Scan next pallet</div>
              <div className="btn--hero__sub">
                {inspection.type === 'returns' ? 'Pick delivery and pallet type' : 'Pick stop, delivery, and pallet type'}
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

        {inspection.bol.deliveries.length === 0 ? (
          <div className="empty">
            <div className="empty__title">No deliveries on this load</div>
            <div className="empty__sub">
              Go back to verify the BOL and add at least one delivery before scanning pallets.
            </div>
            <Link
              to={`/inspection/${inspection.id}/verify`}
              className="btn btn--accent"
              style={{ marginTop: 12 }}
            >
              Back to verify
            </Link>
          </div>
        ) : inspection.type === 'returns' ? (
          <section className="stop-section">
            <div className="stop-section__head">
              <h2 className="stop-section__title">Returned Pallets</h2>
              <span className="stop-section__meta">
                {inspection.pallets.length} {inspection.pallets.length === 1 ? 'pallet' : 'pallets'}
              </span>
            </div>
            {inspection.pallets.length === 0 ? (
              <div className="empty" style={{ padding: 16 }}>
                <div className="empty__sub">No pallets scanned yet.</div>
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
                        Pallet {p.palletNumber}
                      </div>
                      {p.scannedBy && (
                        <div
                          className="xs soft"
                          title={`Scanned by ${p.scannedBy}`}
                          style={{ fontFamily: 'JetBrains Mono, monospace' }}
                        >
                          {p.scannedBy.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                        </div>
                      )}
                    </div>
                    <div className="fw-500" style={{ fontSize: 20, marginTop: 4 }}>
                      {p.batchSections.reduce(
                        (sum: number, bs) => sum + (bs.actualBagCount.value || 0),
                        0
                      ) || '—'}
                      <span className="xs soft fw-500" style={{ marginLeft: 4 }}>bags</span>
                    </div>
                    {p.batchSections.map((bs) => (
                      <div key={bs.id} className="xs mono faint" style={{ marginTop: 2 }}>
                        {bs.batchCode.value || '—'}
                        {bs.actualBagCount.value !== null && (
                          <span style={{ color: 'var(--ink-soft)' }}>
                            {' '}· {bs.actualBagCount.value}
                          </span>
                        )}
                      </div>
                    ))}
                    <div className="xs soft" style={{ marginTop: 4 }}>{p.palletType}</div>
                    {p.qualityFlag && (
                      <div className="xs" style={{ color: 'var(--danger)', marginTop: 4 }}>
                        ⚑ Flagged
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
            />
          ))
        )}

        {warnings.length > 0 && (
          <div className="banner banner--warn" style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' }}>
            <div className="row-start gap-8" style={{ fontWeight: 600, fontSize: '15px' }}>
              <span className="banner__icon">⚠️</span>
              Attention Required
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
          <Link to="/" className="btn btn--ghost">{readOnly ? '← Back' : 'Save & exit'}</Link>
          <button
            className="btn btn--accent btn--lg"
            disabled={!readOnly && !allFulfilled}
            onClick={() => navigate(`/inspection/${inspection.id}/review`)}
          >
            {readOnly
              ? 'View summary →'
              : inspection.type === 'returns' || allFulfilled
              ? 'Complete inspection →'
              : `${remaining} more bag${remaining === 1 ? '' : 's'} to scan`}
          </button>
        </div>
      </main>
    </>
  );
}

function StopSection({
  stopKey,
  deliveries,
  palletsByDelivery,
  inspectionId,
}: {
  stopKey: string;
  deliveries: Delivery[];
  palletsByDelivery: Record<string, PalletInspection[]>;
  inspectionId: string;
}) {
  const allPallets = deliveries.flatMap((d) => palletsByDelivery[d.id] || []);
  const stopLabel = stopKey === 'unassigned' ? 'Unassigned' : `Stop ${stopKey}`;

  return (
    <section className="stop-section">
      <div className="stop-section__head">
        <h2 className="stop-section__title">{stopLabel}</h2>
        <span className="stop-section__meta">
          {deliveries.length} {deliveries.length === 1 ? 'delivery' : 'deliveries'} ·{' '}
          {allPallets.length} pallets
        </span>
      </div>

      {deliveries.map((delivery) => (
        <DeliveryGroup
          key={delivery.id}
          delivery={delivery}
          pallets={palletsByDelivery[delivery.id] || []}
          inspectionId={inspectionId}
        />
      ))}
    </section>
  );
}

function DeliveryGroup({
  delivery,
  pallets,
  inspectionId,
}: {
  delivery: Delivery;
  pallets: PalletInspection[];
  inspectionId: string;
}) {
  return (
    <div className="delivery-group">
      <div className="delivery-group__head">
        <div className="delivery-group__num mono">
          Delivery {delivery.deliveryNumber}
        </div>
        <div className="delivery-group__meta">
          {pallets.length} {pallets.length === 1 ? 'pallet' : 'pallets'}
        </div>
      </div>

      {pallets.length === 0 ? (
        <div className="empty" style={{ padding: 16 }}>
          <div className="empty__sub">No pallets scanned for this delivery yet.</div>
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
              }}
            >
              <div className="row-between">
                <div
                  className="xs soft"
                  style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
                >
                  Pallet {p.palletNumber}
                </div>
                {p.scannedBy && (
                  <div
                    className="xs soft"
                    title={`Scanned by ${p.scannedBy}`}
                    style={{ fontFamily: 'JetBrains Mono, monospace' }}
                  >
                    {p.scannedBy.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                  </div>
                )}
              </div>
              <div className="fw-500" style={{ fontSize: 20, marginTop: 4 }}>
                {p.batchSections.reduce(
                  (sum: number, bs) => sum + (bs.actualBagCount.value || 0),
                  0
                ) || '—'}
                <span className="xs soft fw-500" style={{ marginLeft: 4 }}>bags</span>
              </div>
              {p.batchSections.map((bs) => (
                <div key={bs.id} className="xs mono faint" style={{ marginTop: 2 }}>
                  {bs.batchCode.value || '—'}
                  {bs.actualBagCount.value !== null && (
                    <span style={{ color: 'var(--ink-soft)' }}>
                      {' '}· {bs.actualBagCount.value}
                    </span>
                  )}
                </div>
              ))}
              <div className="xs soft" style={{ marginTop: 4 }}>{p.palletType}</div>
              {p.qualityFlag && (
                <div className="xs" style={{ color: 'var(--danger)', marginTop: 4 }}>
                  ⚑ Flagged
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
        <h3 className="modal__title">Scan next pallet</h3>
        <p className="modal__sub">Pick stop, delivery, and pallet type.</p>

        {!isReturns && (
          <div className="modal__field">
            <label>Stop</label>
            <select value={stopKey} onChange={(e) => handleStopChange(e.target.value)}>
              {stopKeys.map((k) => (
                <option key={k} value={k}>
                  {k === 'unassigned' ? 'Unassigned' : `Stop ${k}`}
                </option>
              ))}
            </select>
          </div>
        )}

        {!isReturns && (
          <div className="modal__field">
            <label>Delivery</label>
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
          <label>Pallet type</label>
          <div className="flex-col gap-8">
            {(isReturns
              ? PALLET_TYPES.filter(t => t !== 'Mixed Bag Pallet' && t !== 'Minibulk' && t !== 'Paper Bag')
              : PALLET_TYPES
            ).map((t) => (
              <button
                key={t}
                type="button"
                className={`btn ${palletType === t ? 'btn--accent' : ''}`}
                onClick={() => setPalletType(t)}
                style={{ justifyContent: 'flex-start' }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {needsBatchCount && (
          <div className="modal__field">
            <label>How many batches on this pallet?</label>
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
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn--accent"
            disabled={!canSubmit}
            onClick={() => {
              if (palletType && deliveryId) {
                onAdd(palletType, deliveryId, batchCount);
              }
            }}
          >
            Start scanning →
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
  const [newName, setNewName] = useState('');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">Hand off to another inspector</h3>
        <p className="modal__sub">
          From this point forward, new pallets will be tagged to the new inspector.
          Previous pallets stay attributed to <strong>{currentInspector}</strong>.
        </p>

        <div className="modal__field">
          <label>New inspector</label>
          <InspectorPicker
            siteId={siteId}
            value={newName}
            placeholder="Select inspector…"
            onChange={setNewName}
          />
        </div>

        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn--accent"
            disabled={!newName || newName === currentInspector}
            onClick={() => onSubmit(newName)}
          >
            Confirm handoff
          </button>
        </div>
      </div>
    </div>
  );
}
