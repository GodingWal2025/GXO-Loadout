import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { dbGetInspection } from '../shared';
import { useInspection, useInspectionMode, ViewEditToggle } from '../shared';
import { InspectorPicker } from '../shared';
import { MultiPhotoCapture } from '../shared';
import type { Inspection } from '../shared';

export function ReviewAndCompleteRoute() {
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
  return <ReviewInner initial={loaded} />;
}

function ReviewInner({ initial }: { initial: Inspection }) {
  const { inspection, dispatch } = useInspection(initial);
  const { locked, editing, readOnly, setEditing } = useInspectionMode(inspection);
  const navigate = useNavigate();
  const [confirmed, setConfirmed] = useState(false);
  const [completedBy, setCompletedBy] = useState(
    inspection.completedBy || inspection.startedBy || ''
  );

  const totalExpected = inspection.picklist.lineItems.reduce(
    (sum, li) => sum + (li.expectedQuantity.value || 0),
    0
  );
  const totalActual = inspection.picklist.lineItems.reduce(
    (sum, li) => sum + li.actualQuantity,
    0
  );
  const allFulfilled = inspection.type === 'returns' || inspection.picklist.lineItems.every((li) => li.fulfilled);

  const isReturns = inspection.type === 'returns';
  const returnsBol = inspection.returnsBol;
  
  let returnsActuals = {
    pallets: 0,
    seedPaks: 0,
    bagPallets: 0,
  };

  if (isReturns) {
    returnsActuals.pallets = inspection.pallets.length;
    returnsActuals.seedPaks = inspection.pallets.filter(p => p.palletType === 'Seedpak').length;
    returnsActuals.bagPallets = inspection.pallets.filter(p => p.palletType.includes('Bag Pallet')).length;
  }

  const [validationError, setValidationError] = useState('');

  const complete = () => {
    if (!completedBy) {
      setValidationError('Please select an inspector before completing.');
      return;
    }
    if (!confirmed) {
      setValidationError('You must verify the load and check the confirmation box.');
      return;
    }
    setValidationError('');
    dispatch({ type: 'SET_COMPLETED_BY', name: completedBy });
    dispatch({ type: 'MARK_COMPLETE' });
    setTimeout(() => navigate('/'), 100);
  };

  const loadNum = inspection.picklist.loadNumber.value || inspection.bol.loadNumber.value || inspection.id.slice(0, 8);

  return (
    <main>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            {readOnly ? <>Inspection <em>summary</em></> : <>Review &amp; <em>complete</em></>}
          </h1>
          <div className="page-head__sub">
            Load <span className="mono">#{loadNum}</span> ·{' '}
            {isReturns 
              ? `${inspection.pallets.length} total pallets returned`
              : totalExpected > 0
                ? `${totalActual} of ${totalExpected} bags · ${inspection.pallets.length} pallets · ${inspection.bol.deliveries.length} deliveries`
                : `${inspection.pallets.length} pallets · ${inspection.bol.deliveries.length} deliveries`
            }
          </div>
        </div>
        {locked && (
          <div className="page-head__actions">
            <ViewEditToggle editing={editing} onChange={setEditing} />
          </div>
        )}
      </div>

      {readOnly && (
        <div className="banner banner--info">
          <span className="banner__icon">👁</span>
          <div className="banner__body">
            Completed {inspection.completedAt ? new Date(inspection.completedAt).toLocaleString() : ''}
            {inspection.completedBy ? ` by ${inspection.completedBy}` : ''}. Open in{' '}
            <strong>view mode</strong> — switch to Edit in the corner to change anything.
          </div>
        </div>
      )}

      {!isReturns && totalExpected > 0 && (
        allFulfilled ? (
          <div className="banner banner--success">
            <span className="banner__icon">✓</span>
            <div className="banner__body">
              <strong>Picklist fulfilled.</strong> All {totalExpected} bags accounted for across{' '}
              {inspection.pallets.length} pallets.
            </div>
          </div>
        ) : (
          <div className="banner banner--warn">
            <span className="banner__icon">⚠</span>
            <div className="banner__body">
              <strong>Picklist not fulfilled.</strong> {totalActual} of {totalExpected} bags scanned.
              You can still complete the inspection with quality flags noting the discrepancy.
            </div>
          </div>
        )
      )}

      {isReturns && returnsBol && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">Returns <em>tally</em></h2>
            <span className="section__meta">Expected vs Scanned</span>
          </div>
          <div className="table-card">
            <table className="data">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="right">Actual Scanned</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="fw-500">Total Pallets</td>
                  <td className="right num fw-500">{returnsActuals.pallets}</td>
                </tr>
                <tr>
                  <td className="fw-500">Product SeedPaks</td>
                  <td className="right num fw-500">{returnsActuals.seedPaks}</td>
                </tr>
                <tr>
                  <td className="fw-500">Bagged Product (Pallets)</td>
                  <td className="right num fw-500">{returnsActuals.bagPallets}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!isReturns && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">Final <em>tally</em></h2>
            <span className="section__meta">All deliveries</span>
          </div>
          <div className="table-card">
            <table className="data">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Product</th>
                  <th>Delivery</th>
                  <th className="right">Expected</th>
                  <th className="right">Actual</th>
                  <th className="right">Status</th>
                </tr>
              </thead>
              <tbody>
                {inspection.picklist.lineItems.map((li) => {
                  const delivery = inspection.bol.deliveries.find(
                    (d) => d.id === li.deliveryId
                  );
                  return (
                    <tr key={li.id}>
                      <td className="mono">{li.batchCode.value || '—'}</td>
                      <td className="small soft">{li.productName.value || '—'}</td>
                      <td className="mono small">{delivery?.deliveryNumber || '—'}</td>
                      <td className="right num">
                        {li.expectedQuantity.value || 0} {li.uom}
                      </td>
                      <td className="right num fw-500">
                        {li.actualQuantity} {li.uom}
                      </td>
                      <td className="right">
                        {li.fulfilled ? (
                          <span className="pill pill--success">✓ match</span>
                        ) : (
                          <span className="pill pill--warn">short</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {inspection.flaggedItemsCount > 0 && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">
              <em>Flags</em>
            </h2>
            <span className="section__meta">{inspection.flaggedItemsCount} quality issue(s)</span>
          </div>
          {inspection.qualityFlag && (
            <div
              className="card"
              style={{ borderLeft: '3px solid var(--danger)', background: 'var(--danger-bg)' }}
            >
              <div className="small" style={{ color: 'var(--danger)' }}>
                ⚑ Inspection-level: {inspection.qualityFlag.reason}
                {inspection.qualityFlag.otherReason && <> — {inspection.qualityFlag.otherReason}</>}
              </div>
              {inspection.qualityFlag.notes && (
                <div className="xs" style={{ color: 'var(--danger)', marginTop: 4 }}>
                  {inspection.qualityFlag.notes}
                </div>
              )}
            </div>
          )}
          {inspection.pallets
            .filter((p) => p.qualityFlag)
            .map((p) => (
              <div
                key={p.palletNumber}
                className="card"
                style={{ borderLeft: '3px solid var(--danger)', background: 'var(--danger-bg)' }}
              >
                <div className="small" style={{ color: 'var(--danger)' }}>
                  ⚑ Pallet {p.palletNumber}: {p.qualityFlag!.reason}
                  {p.qualityFlag!.otherReason && <> — {p.qualityFlag!.otherReason}</>}
                </div>
                {p.qualityFlag!.notes && (
                  <div className="xs" style={{ color: 'var(--danger)', marginTop: 4 }}>
                    {p.qualityFlag!.notes}
                  </div>
                )}
              </div>
            ))}
        </section>
      )}

      {!isReturns && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">Packaging <em>used</em></h2>
            <span className="section__meta">Materials consumed for this load</span>
          </div>
          <fieldset className="readonly-fieldset card" disabled={readOnly}>
            <div className="field-row" style={{ marginBottom: 12 }}>
              <div className="field">
                <div className="field__label">40×40 pallets</div>
                <input
                  type="number"
                  min="0"
                  value={inspection.staging.pallets40x40Used ?? 0}
                  onChange={(e) =>
                    dispatch({ type: 'SET_STAGING', field: 'pallets40x40Used', value: Number(e.target.value) || 0 })
                  }
                  placeholder="0"
                />
              </div>
              <div className="field">
                <div className="field__label">48×40 pallets</div>
                <input
                  type="number"
                  min="0"
                  value={inspection.staging.pallets48x40Used ?? 0}
                  onChange={(e) =>
                    dispatch({ type: 'SET_STAGING', field: 'pallets48x40Used', value: Number(e.target.value) || 0 })
                  }
                  placeholder="0"
                />
              </div>
              <div className="field">
                <div className="field__label">Seedpaks</div>
                <input
                  type="number"
                  min="0"
                  value={inspection.staging.seedpaksUsed ?? 0}
                  onChange={(e) =>
                    dispatch({ type: 'SET_STAGING', field: 'seedpaksUsed', value: Number(e.target.value) || 0 })
                  }
                  placeholder="0"
                />
              </div>
            </div>
            <div className="field">
              <div className="field__label">Other packaging notes</div>
              <textarea
                rows={2}
                value={inspection.staging.otherPackagingNotes ?? ''}
                onChange={(e) =>
                  dispatch({ type: 'SET_STAGING', field: 'otherPackagingNotes', value: e.target.value })
                }
                placeholder={readOnly ? '—' : 'Any additional packaging details…'}
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>
          </fieldset>
        </section>
      )}

      {!isReturns && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">Final <em>staging lane</em> photos</h2>
            <span className="section__meta">
              {readOnly ? 'Tap a photo to enlarge' : 'Capture the finished staging lane with product'}
            </span>
          </div>
          <MultiPhotoCapture
            inspectionId={inspection.id}
            category="Staging_Final_Lane"
            existingPhotos={inspection.staging.finalLanePhotos || []}
            onPhotoAdded={(photo) =>
              dispatch({ type: 'ADD_STAGING_PHOTO', section: 'final-lane', photo })
            }
            onPhotoQualityFlag={(photoId, flag) =>
              dispatch({ type: 'SET_PHOTO_QUALITY_FLAG', photoId, flag })
            }
            label="Final staging lane"
            currentUser={inspection.currentInspector || inspection.startedBy || 'unknown'}
            readOnly={readOnly}
          />
        </section>
      )}

      {readOnly ? (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">Inspector <em>sign-off</em></h2>
          </div>
          <div className="card">
            <div className="xs soft">Completed by</div>
            <div className="fw-500" style={{ fontSize: 18 }}>
              {inspection.completedBy || inspection.startedBy || '—'}
            </div>
            {inspection.completedAt && (
              <div className="xs soft" style={{ marginTop: 4 }}>
                {new Date(inspection.completedAt).toLocaleString()}
              </div>
            )}
          </div>
        </section>
      ) : (
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Inspector <em>sign-off</em></h2>
        </div>
        <div className="banner banner--info">
          <span className="banner__icon">i</span>
          <div className="banner__body">
            <strong>You are completing this inspection.</strong> Your name will be recorded as the
            inspector who finalized this load.
            {inspection.startedBy && inspection.startedBy !== completedBy && (
              <span>
                {' '}This load was started by <strong>{inspection.startedBy}</strong>.
              </span>
            )}
          </div>
        </div>

        <div className="field">
          <div className="field__label">Completed by</div>
          <InspectorPicker
            siteId={inspection.siteId}
            value={completedBy}
            placeholder="Select your name…"
            onChange={setCompletedBy}
          />
        </div>

        <div className="field">
          <label className="flex gap-8" style={{ cursor: 'pointer', alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              style={{ marginTop: 4 }}
            />
            <span className="small">
              {isReturns 
                ? 'I have personally verified this return. All product photos, batch, and product have been reviewed and are accurate.'
                : 'I have personally verified this load against the BOL and final paperwork. All pallet photos, batch codes, and bag counts have been reviewed and are accurate.'
              }
            </span>
          </label>
        </div>
      </section>
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
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: '16px'
        }}
      >
        {validationError && (
          <div className="banner banner--danger" style={{ marginBottom: 0 }}>
            <span className="banner__icon">⚠</span>
            <div className="banner__body">{validationError}</div>
          </div>
        )}
        <div className="row-between">
          <button className="btn btn--ghost" onClick={() => navigate(`/inspection/${inspection.id}`)}>
            {readOnly ? '← Back to load' : '← Continue editing'}
          </button>
          {!readOnly && (
            <button
              className="btn btn--accent btn--lg"
              onClick={complete}
            >
              {inspection.flaggedItemsCount > 0 ? '⚑ Complete (flagged)' : '✓ Complete inspection'}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
