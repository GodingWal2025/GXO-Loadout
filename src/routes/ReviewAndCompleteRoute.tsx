import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { dbGetInspection, dbGetPhotoBlob, computeCrossReference, PhotoLightbox } from '../shared';
import { useInspection, useInspectionMode, ViewEditToggle } from '../shared';
import { InspectorPicker } from '../shared';
import { MultiPhotoCapture } from '../shared';
import { isPackagingLine, picklistHasOcr } from '../shared';
import type { Inspection } from '../shared';
import { CapturedPageThumb } from '../components/CapturedPageThumb';
import { downloadInspectionPdf } from '../lib/inspectionPdf';
import { useT } from '../shared/i18n/LanguageContext';

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
  const t = useT();
  const navigate = useNavigate();
  const [confirmed, setConfirmed] = useState(false);
  const [completedBy, setCompletedBy] = useState(
    inspection.completedBy || inspection.startedBy || ''
  );

  // For outbound + OCR, packaging SKUs are excluded from completion counts.
  const excludePackaging =
    inspection.type === 'outbound' && picklistHasOcr(inspection.picklist);
  const productLineItems = excludePackaging
    ? inspection.picklist.lineItems.filter((li) => !isPackagingLine(li))
    : inspection.picklist.lineItems;

  const totalExpected = productLineItems.reduce(
    (sum, li) => sum + (li.expectedQuantity.value || 0),
    0
  );
  const totalActual = productLineItems.reduce(
    (sum, li) => sum + li.actualQuantity,
    0
  );
  const allFulfilled = inspection.type === 'returns' || productLineItems.every((li) => li.fulfilled);

  const isReturns = inspection.type === 'returns';
  const isInbound = inspection.type === 'inbound';
  const returnsBol = inspection.returnsBol;
  const inbound = inspection.inbound;
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const openLightbox = async (photoId: string) => {
    const blob = await dbGetPhotoBlob(photoId);
    if (blob) setLightboxUrl(URL.createObjectURL(blob));
  };

  // Cross-reference the picklist against the BOL (SKU totals + header fields).
  // Only meaningful for outbound loads that actually captured BOL line items.
  const hasBolLines = !isReturns && !isInbound && (inspection.bol.lineItems?.length ?? 0) > 0;
  const crossRef = useMemo(
    () => (hasBolLines ? computeCrossReference(inspection) : null),
    // Recompute only when the compared values change — not on every tally
    // rebuild — so the persist-effect below can't loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      hasBolLines,
      JSON.stringify(
        inspection.picklist.lineItems.map((li) => [li.sku.value, li.expectedQuantity.value])
      ),
      JSON.stringify(
        (inspection.bol.lineItems ?? []).map((li) => [li.sku.value, li.quantity.value])
      ),
      inspection.picklist.loadNumber.value,
      inspection.bol.loadNumber.value,
      inspection.picklist.shipDate.value,
      inspection.bol.shipDate.value,
    ]
  );

  // Persist the computed result onto the record (shown in admin). Keyed on the
  // memoized crossRef, whose identity is stable across tally recomputes.
  useEffect(() => {
    if (readOnly || !crossRef) return;
    dispatch({ type: 'SET_CROSS_REFERENCE', result: crossRef });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossRef, readOnly]);
  
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
      setValidationError(
        t('review.errNoInspector', 'Please select an inspector before completing.')
      );
      return;
    }
    if (!confirmed) {
      setValidationError(
        t('review.errNotConfirmed', 'You must verify the load and check the confirmation box.')
      );
      return;
    }
    setValidationError('');
    dispatch({ type: 'SET_COMPLETED_BY', name: completedBy });
    dispatch({ type: 'MARK_COMPLETE' });
    setTimeout(() => navigate('/'), 100);
  };

  const loadNum =
    inspection.inbound?.bolNumber.value ||
    inspection.picklist.loadNumber.value ||
    inspection.bol.loadNumber.value ||
    inspection.returnsBol?.bolNumber.value ||
    inspection.id.slice(0, 8);

  const inboundLines = inbound?.lineItems || [];
  const inboundTotalReceived = inboundLines.reduce(
    (sum, li) => sum + (Number(li.qtyReceived?.value) || 0),
    0
  );
  const inboundTotalDamaged = inboundLines.reduce(
    (sum, li) => sum + (Number(li.qtyDamaged?.value) || 0),
    0
  );
  const inboundDamagePhotos = inboundLines.flatMap((li) => li.damagePhotoIds || []);

  return (
    <main>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            {readOnly ? (
              <>
                {t('review.summaryLead', 'Inspection')} <em>{t('review.summaryEm', 'summary')}</em>
              </>
            ) : (
              <>
                {t('review.titleLead', 'Review &')} <em>{t('review.titleEm', 'complete')}</em>
              </>
            )}
          </h1>
          <div className="page-head__sub">
            {t('review.load', 'Load')} <span className="mono">#{loadNum}</span> ·{' '}
            {isInbound
              ? t('review.subInbound', '{count} items logged · Inbound Verification Log', {
                  count: inboundLines.length,
                })
              : isReturns
              ? t('review.subReturns', '{pallets} total pallets returned', {
                  pallets: inspection.pallets.length,
                })
              : totalExpected > 0
                ? t(
                    'review.subWithBags',
                    '{actual} of {expected} bags · {pallets} pallets · {deliveries} deliveries',
                    {
                      actual: totalActual,
                      expected: totalExpected,
                      pallets: inspection.pallets.length,
                      deliveries: inspection.bol.deliveries.length,
                    }
                  )
                : t('review.subNoBags', '{pallets} pallets · {deliveries} deliveries', {
                    pallets: inspection.pallets.length,
                    deliveries: inspection.bol.deliveries.length,
                  })}
          </div>
        </div>
        <div className="page-head__actions" style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={() => downloadInspectionPdf(inspection)}
            title="Download PDF report"
          >
            ⤓ PDF
          </button>
          {locked && <ViewEditToggle editing={editing} onChange={setEditing} />}
        </div>
      </div>

      {readOnly && (
        <div className="banner banner--info">
          <span className="banner__icon">👁</span>
          <div className="banner__body">
            {t('review.completedOn', 'Completed {when}', {
              when: inspection.completedAt
                ? new Date(inspection.completedAt).toLocaleString()
                : '',
            })}
            {inspection.completedBy
              ? t('review.completedBy', ' by {name}', { name: inspection.completedBy })
              : ''}
            {t('review.openInPrefix', '. Open in')} <strong>{t('review.viewMode', 'view mode')}</strong>{' '}
            {t('review.viewModeHint', '— switch to Edit in the corner to change anything.')}
          </div>
        </div>
      )}

      {!isReturns && !isInbound && totalExpected > 0 && (
        allFulfilled ? (
          <div className="banner banner--success">
            <span className="banner__icon">✓</span>
            <div className="banner__body">
              <strong>{t('review.fulfilledTitle', 'Picklist fulfilled.')}</strong>{' '}
              {t('review.fulfilledBody', 'All {expected} bags accounted for across {pallets} pallets.', {
                expected: totalExpected,
                pallets: inspection.pallets.length,
              })}
            </div>
          </div>
        ) : (
          <div className="banner banner--warn">
            <span className="banner__icon">⚠</span>
            <div className="banner__body">
              <strong>{t('review.notFulfilledTitle', 'Picklist not fulfilled.')}</strong>{' '}
              {t('review.notFulfilledBody', '{actual} of {expected} bags scanned. You can still complete the inspection with quality flags noting the discrepancy.', {
                actual: totalActual,
                expected: totalExpected,
              })}
            </div>
          </div>
        )
      )}

      {/* ===== Inbound Review View ===== */}
      {isInbound && inbound && (
        <>
          {/* Header Card */}
          <section className="section">
            <div className="section__head">
              <h2 className="section__title">
                {t('verifyInbound.titleLead', 'Inbound')} <em>{t('verifyInbound.titleEm', 'Verification Log')}</em>
              </h2>
            </div>
            <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <div>
                <div className="xs soft">{t('verifyInbound.bolNumber', 'BoL Number / Load #')}</div>
                <div className="mono fw-600" style={{ fontSize: 16 }}>{inbound.bolNumber?.value || '—'}</div>
              </div>
              <div>
                <div className="xs soft">{t('verifyInbound.deliveryNumber', 'Delivery Number')}</div>
                <div className="mono fw-600" style={{ fontSize: 16 }}>{inbound.deliveryNumber?.value || '—'}</div>
              </div>
              <div>
                <div className="xs soft">{t('verifyInbound.stagingLanes', 'Staging Lane(s)')}</div>
                <div className="fw-500">{inbound.stagingLane?.value || inspection.stagingLocation || '—'}</div>
              </div>
              <div>
                <div className="xs soft">{t('verifyInbound.verifier', 'Verifier')}</div>
                <div className="fw-500">{inbound.verifier?.value || inspection.startedBy || '—'}</div>
              </div>
              <div>
                <div className="xs soft">{t('verifyInbound.dateReceived', 'Date Received')}</div>
                <div>{inbound.dateReceived?.value || '—'}</div>
              </div>
              <div>
                <div className="xs soft">{t('verifyInbound.dateVerified', 'Date Verified')}</div>
                <div>{inbound.dateVerified?.value || '—'}</div>
              </div>
            </div>
          </section>

          {/* Metrics summary */}
          <div
            className="card"
            style={{
              display: 'flex',
              justifyContent: 'space-around',
              alignItems: 'center',
              padding: 16,
              background: 'var(--surface-tint)',
              marginBottom: 24,
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div className="small soft">{t('verifyInbound.summaryLines', 'Items Logged')}</div>
              <div className="mono fw-600" style={{ fontSize: 22 }}>{inboundLines.length}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div className="small soft">{t('verifyInbound.summaryReceived', 'Total Received')}</div>
              <div className="mono fw-600" style={{ fontSize: 22, color: 'var(--accent)' }}>{inboundTotalReceived}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div className="small soft">{t('verifyInbound.summaryDamaged', 'Total Damaged')}</div>
              <div className="mono fw-600" style={{ fontSize: 22, color: inboundTotalDamaged > 0 ? 'var(--danger)' : 'var(--ink)' }}>
                {inboundTotalDamaged}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div className="small soft">{t('verifyInbound.summaryBolPhotos', 'BOL Photos')}</div>
              <div className="mono fw-600" style={{ fontSize: 22 }}>{inbound.photoIds?.length || 0}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div className="small soft">{t('verifyInbound.damagePhotos', 'Damage Photos')}</div>
              <div className="mono fw-600" style={{ fontSize: 22, color: inboundDamagePhotos.length > 0 ? 'var(--danger)' : 'var(--ink)' }}>
                {inboundDamagePhotos.length}
              </div>
            </div>
          </div>

          {/* Received Line Items Table */}
          <section className="section">
            <div className="section__head">
              <h2 className="section__title">
                {t('verifyInbound.lineItemsLead', 'Received')} <em>{t('verifyInbound.lineItemsEm', 'products')}</em>
              </h2>
            </div>
            <div className="table-card">
              <table className="data">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('verifyInbound.colBatch', 'Batch')}</th>
                    <th>{t('verifyInbound.colMaterial', 'Material / SKU')}</th>
                    <th>{t('verifyInbound.colDesc', 'Description')}</th>
                    <th>{t('verifyInbound.colUom', 'Package')}</th>
                    <th>{t('verifyInbound.colLoc', 'LOC')}</th>
                    <th className="right">{t('verifyInbound.colQtyReceived', 'Qty Received')}</th>
                    <th className="right">{t('verifyInbound.colQtyDamaged', 'Qty Damaged')}</th>
                    <th className="center">{t('verifyInbound.colOnBol', 'On BOL?')}</th>
                    <th>{t('verifyInbound.damagePhotos', 'Damage Photos')}</th>
                  </tr>
                </thead>
                <tbody>
                  {inboundLines.map((li, idx) => (
                    <tr key={li.id}>
                      <td className="fw-600">{li.itemNumber || idx + 1}</td>
                      <td className="mono">{li.batch?.value || '—'}</td>
                      <td className="mono small">{li.materialNumber?.value || '—'}</td>
                      <td className="small soft">{li.materialDescription?.value || '—'}</td>
                      <td>
                        <span className="pill pill--neutral">{li.uom}</span>
                      </td>
                      <td className="mono small">{li.location?.value || '—'}</td>
                      <td className="right num fw-600">{li.qtyReceived?.value ?? 0}</td>
                      <td className="right num" style={{ color: (Number(li.qtyDamaged?.value) || 0) > 0 ? 'var(--danger)' : undefined }}>
                        {li.qtyDamaged?.value ?? 0}
                      </td>
                      <td className="center">
                        {li.onBol ? (
                          <span className="pill pill--success">{t('verifyInbound.yes', 'Yes')}</span>
                        ) : (
                          <span className="pill pill--warn">{t('verifyInbound.no', 'No')}</span>
                        )}
                      </td>
                      <td>
                        {(li.damagePhotoIds || []).length > 0 ? (
                          <div style={{ display: 'flex', gap: 4 }}>
                            {(li.damagePhotoIds || []).map((pid) => (
                              <div
                                key={pid}
                                onClick={() => openLightbox(pid)}
                                style={{ cursor: 'pointer' }}
                              >
                                <CapturedPageThumb
                                  photoId={pid}
                                  inspectionId={inspection.id}
                                  label="Damage"
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="soft xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Inbound BOL photos gallery */}
          {(inbound.photoIds || []).length > 0 && (
            <section className="section">
              <div className="section__head">
                <h2 className="section__title">
                  {t('inboundBol.titleLead', 'Inbound')} <em>{t('inboundBol.titleEm', 'BOL Documents')}</em>
                </h2>
                <span className="section__meta">{t('inboundBol.pagesMany', '{count} pages captured', { count: inbound.photoIds.length })}</span>
              </div>
              <div className="photo-grid">
                {inbound.photoIds.map((pid, i) => (
                  <div key={pid} onClick={() => openLightbox(pid)} style={{ cursor: 'pointer' }}>
                    <CapturedPageThumb
                      photoId={pid}
                      inspectionId={inspection.id}
                      label={t('inboundBol.pageLabel', 'Page {n}', { n: i + 1 })}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {isReturns && returnsBol && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">
              {t('review.returnsTallyLead', 'Returns')} <em>{t('review.returnsTallyEm', 'tally')}</em>
            </h2>
            <span className="section__meta">{t('review.expectedVsScanned', 'Expected vs Scanned')}</span>
          </div>
          <div className="table-card">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('review.colCategory', 'Category')}</th>
                  <th className="right">{t('review.colActualScanned', 'Actual Scanned')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="fw-500">{t('review.totalPallets', 'Total Pallets')}</td>
                  <td className="right num fw-500">{returnsActuals.pallets}</td>
                </tr>
                <tr>
                  <td className="fw-500">{t('review.productSeedPaks', 'Product SeedPaks')}</td>
                  <td className="right num fw-500">{returnsActuals.seedPaks}</td>
                </tr>
                <tr>
                  <td className="fw-500">{t('review.baggedProduct', 'Bagged Product (Pallets)')}</td>
                  <td className="right num fw-500">{returnsActuals.bagPallets}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {crossRef && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">
              {t('review.xrefLead', 'Picklist vs')} <em>{t('review.xrefEm', 'BOL')}</em>
            </h2>
            <span className="section__meta">{t('review.xrefMeta', 'Matched on SKU')}</span>
          </div>

          {crossRef.matches ? (
            <div className="banner banner--success">
              <span className="banner__icon">✓</span>
              <div className="banner__body">
                <strong>{t('review.xrefMatchTitle', 'Picklist and BOL match.')}</strong>{' '}
                {t('review.xrefMatchBody', 'Every SKU total agrees and the header fields line up.')}
              </div>
            </div>
          ) : (
            <div className="banner banner--warn">
              <span className="banner__icon">⚠</span>
              <div className="banner__body">
                <strong>
                  {crossRef.lineItemDiscrepancies.length === 1
                    ? t('review.xrefDiffTitleOne', '{count} SKU does not match.', {
                        count: crossRef.lineItemDiscrepancies.length,
                      })
                    : t('review.xrefDiffTitle', '{count} SKUs do not match.', {
                        count: crossRef.lineItemDiscrepancies.length,
                      })}
                </strong>{' '}
                {t('review.xrefDiffBody', 'Review the differences below before completing.')}
                {!crossRef.loadNumberMatches && (
                  <> {t('review.xrefLoadMismatch', 'Load # differs between picklist and BOL.')}</>
                )}
                {!crossRef.shipDateMatches && (
                  <> {t('review.xrefDateMismatch', 'Ship date differs between picklist and BOL.')}</>
                )}
              </div>
            </div>
          )}

          {crossRef.lineItemDiscrepancies.length > 0 && (
            <div className="table-card">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('review.colSku', 'SKU')}</th>
                    <th>{t('review.colDescription', 'Description')}</th>
                    <th className="right">{t('review.xrefColPicklist', 'Picklist')}</th>
                    <th className="right">{t('review.xrefColBol', 'BOL')}</th>
                    <th className="right">{t('review.colStatus', 'Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {crossRef.lineItemDiscrepancies.map((d) => (
                    <tr key={d.sku}>
                      <td className="mono small">{d.sku}</td>
                      <td className="small soft">{d.description || '—'}</td>
                      <td className="right num">{d.picklistQty ?? '—'}</td>
                      <td className="right num">{d.bolQty ?? '—'}</td>
                      <td className="right">
                        {d.kind === 'qty-mismatch' ? (
                          <span className="pill pill--warn">{t('review.xrefQty', 'qty differs')}</span>
                        ) : d.kind === 'missing-on-bol' ? (
                          <span className="pill pill--warn">{t('review.xrefNotOnBol', 'not on BOL')}</span>
                        ) : (
                          <span className="pill pill--warn">{t('review.xrefNotOnPicklist', 'not on picklist')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!isReturns && !isInbound && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">
              {t('review.finalTallyLead', 'Final')} <em>{t('review.finalTallyEm', 'tally')}</em>
            </h2>
            <span className="section__meta">{t('review.allDeliveries', 'All deliveries')}</span>
          </div>
          <div className="table-card">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('review.colBatch', 'Batch')}</th>
                  <th>{t('review.colSku', 'SKU')}</th>
                  <th>{t('review.colDescription', 'Description')}</th>
                  <th>{t('review.colDelivery', 'Delivery')}</th>
                  <th className="right">{t('review.colExpected', 'Expected')}</th>
                  <th className="right">{t('review.colActual', 'Actual')}</th>
                  <th className="right">{t('review.colStatus', 'Status')}</th>
                </tr>
              </thead>
              <tbody>
                {inspection.picklist.lineItems.map((li) => {
                  const delivery = inspection.bol.deliveries.find(
                    (d) => d.id === li.deliveryId
                  );
                  const isExcludedPackaging = excludePackaging && isPackagingLine(li);
                  return (
                    <tr key={li.id} style={isExcludedPackaging ? { opacity: 0.45 } : undefined}>
                      <td className="mono">{li.batchCode.value || '—'}</td>
                      <td className="mono small">{li.sku.value || '—'}</td>
                      <td className="small soft">{li.description.value || '—'}</td>
                      <td className="mono small">{delivery?.deliveryNumber || '—'}</td>
                      <td className="right num">
                        {li.expectedQuantity.value || 0} {li.uom}
                      </td>
                      <td className="right num fw-500">
                        {li.actualQuantity} {li.uom}
                      </td>
                      <td className="right">
                        {isExcludedPackaging ? (
                          <span className="pill pill--neutral" style={{ fontSize: 10 }}>
                            {t('review.statusPackaging', 'Packaging — excluded')}
                          </span>
                        ) : li.fulfilled ? (
                          <span className="pill pill--success">{t('review.statusMatch', '✓ match')}</span>
                        ) : (
                          <span className="pill pill--warn">{t('review.statusShort', 'short')}</span>
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
              <em>{t('review.flags', 'Flags')}</em>
            </h2>
            <span className="section__meta">
              {t('review.qualityIssues', '{count} quality issue(s)', {
                count: inspection.flaggedItemsCount,
              })}
            </span>
          </div>
          {inspection.qualityFlag && (
            <div
              className="card"
              style={{ borderLeft: '3px solid var(--danger)', background: 'var(--danger-bg)' }}
            >
              <div className="small" style={{ color: 'var(--danger)' }}>
                {t('review.inspectionLevelFlag', '⚑ Inspection-level:')} {inspection.qualityFlag.reason}
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
                  {t('review.palletFlag', '⚑ Pallet {n}:', { n: p.palletNumber })}{' '}
                  {p.qualityFlag!.reason}
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

      {!isReturns && !isInbound && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">
              {t('review.packagingLead', 'Packaging')} <em>{t('review.packagingEm', 'used')}</em>
            </h2>
            <span className="section__meta">
              {t('review.packagingMeta', 'Materials consumed for this load')}
            </span>
          </div>
          <fieldset className="readonly-fieldset card" disabled={readOnly}>
            <div className="field-row" style={{ marginBottom: 12 }}>
              <div className="field">
                <div className="field__label">{t('review.pallets40x40', '40×40 pallets')}</div>
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
                <div className="field__label">{t('review.pallets48x40', '48×40 pallets')}</div>
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
                <div className="field__label">{t('review.seedpaks', 'Seedpaks')}</div>
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
              <div className="field__label">
                {t('review.otherPackagingNotes', 'Other packaging notes')}
              </div>
              <textarea
                rows={2}
                value={inspection.staging.otherPackagingNotes ?? ''}
                onChange={(e) =>
                  dispatch({ type: 'SET_STAGING', field: 'otherPackagingNotes', value: e.target.value })
                }
                placeholder={
                  readOnly
                    ? '—'
                    : t('review.packagingNotesPlaceholder', 'Any additional packaging details…')
                }
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>
          </fieldset>
        </section>
      )}

      {!isReturns && !isInbound && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">
              {t('review.stagingLead', 'Staging')} <em>{t('review.stagingEm', 'checklist')}</em>
            </h2>
          </div>

          {[
            {
              field: 'stagedCorrectly',
              label: t('review.qStagedCorrectly', '* Is the load staged correctly on the dock?'),
              options: ['Yes', 'No'] as const
            },
            {
              field: 'paperBagsProperlyStacked',
              label: t('review.qBagsStacked', '* Are all bag pallets properly stacked, securely wrapped with no breaks or gaps in the wrapping, and not leaning more than 5 inches?'),
              options: ['Yes', 'No', 'N/A'] as const
            },
            {
              field: 'ltlPalletsSecured',
              label: t('review.qLtlSecured', '* Are all LTL pallets secured with cardboard?'),
              options: ['Yes', 'No', 'N/A'] as const
            },
            {
              field: 'mixedPalletsLabeled',
              label: t('review.qMixedLabeled', '* Do all mixed pallets have proper labels?'),
              options: ['Yes', 'No', 'N/A'] as const
            },
            {
              field: 'multiStopStickersAttached',
              label: t('review.qMultiStopStickers', '* Are all multi-stop stickers attached to the first pallet of each stop?'),
              options: ['Yes', 'No', 'N/A'] as const
            },
            {
              field: 'palletQuantityMatchesBOL',
              label: t('review.qPalletQtyMatchesBol', '* Does the quantity of pallets and physical product staged for the order match the final BOL?'),
              options: ['Yes', 'No'] as const
            }
          ].map((q) => (
            <div key={q.field} className="card" style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 16, fontWeight: 500 }}>{q.label}</div>
              <div className="row-start gap-8">
                {q.options.map((opt) => {
                  const currentValue = (inspection.staging as any)[q.field];
                  let btnClass = 'btn--ghost';
                  let btnStyle = {};
                  if (currentValue === opt) {
                    btnClass = 'btn--accent';
                    if (opt === 'Yes') btnStyle = { backgroundColor: 'var(--success)', color: 'white' };
                    if (opt === 'No') btnStyle = { backgroundColor: 'var(--danger)', color: 'white' };
                    if (opt === 'N/A') btnStyle = { backgroundColor: 'var(--surface-tint)', color: 'var(--text)' };
                  }
                  return (
                    <button
                      key={opt}
                      disabled={readOnly}
                      className={`btn btn--lg flex-1 ${btnClass}`}
                      style={btnStyle}
                      onClick={() =>
                        dispatch({ type: 'SET_STAGING', field: q.field as any, value: opt })
                      }
                    >
                      {opt === 'Yes'
                        ? t('review.yes', 'Yes')
                        : opt === 'No'
                          ? t('review.no', 'No')
                          : t('review.na', 'N/A')}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}

      {isReturns && (
        <>
          <section className="section">
            <div className="section__head">
              <h2 className="section__title">
                {t('review.returnsStagingLead', 'Returns')} <em>{t('review.returnsStagingEm', 'staging lane photos')}</em>
              </h2>
              <span className="section__meta">
                {readOnly
                  ? t('review.finalLaneMetaView', 'Tap a photo to enlarge')
                  : t('review.finalLaneMeta', 'Capture the finished staging lane with product')}
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
              label={t('returnsStaging.tabStagingLane', 'Staging Lane')}
              currentUser={inspection.currentInspector || inspection.startedBy || 'unknown'}
              readOnly={readOnly}
            />
          </section>

          <section className="section">
            <div className="section__head">
              <h2 className="section__title">
                {t('review.returnsPalletsPackagingLead', 'Packaging:')} <em>{t('review.returnsPalletsPackagingEm', 'Wooden Pallets photos')}</em>
              </h2>
              <span className="section__meta">
                {readOnly
                  ? t('review.finalLaneMetaView', 'Tap a photo to enlarge')
                  : t('returnsStaging.palletsHint', 'Photograph the condition of the wooden pallets.')}
              </span>
            </div>
            <MultiPhotoCapture
              inspectionId={inspection.id}
              category="Returns_Packaging_Pallets"
              existingPhotos={inspection.staging.palletsPackagingPhotos || []}
              onPhotoAdded={(photo) =>
                dispatch({ type: 'ADD_STAGING_PHOTO', section: 'returns-pallets', photo })
              }
              onPhotoQualityFlag={(photoId, flag) =>
                dispatch({ type: 'SET_PHOTO_QUALITY_FLAG', photoId, flag })
              }
              label={t('returnsStaging.tabPallets', 'Wooden Pallets')}
              currentUser={inspection.currentInspector || inspection.startedBy || 'unknown'}
              readOnly={readOnly}
            />
          </section>

          <section className="section">
            <div className="section__head">
              <h2 className="section__title">
                {t('review.returnsSeedpaksPackagingLead', 'Packaging:')} <em>{t('review.returnsSeedpaksPackagingEm', 'SeedPaks photos')}</em>
              </h2>
              <span className="section__meta">
                {readOnly
                  ? t('review.finalLaneMetaView', 'Tap a photo to enlarge')
                  : t('returnsStaging.seedpaksHint', 'Photograph the condition of the SeedPak packaging.')}
              </span>
            </div>
            <MultiPhotoCapture
              inspectionId={inspection.id}
              category="Returns_Packaging_Seedpaks"
              existingPhotos={inspection.staging.seedpaksPackagingPhotos || []}
              onPhotoAdded={(photo) =>
                dispatch({ type: 'ADD_STAGING_PHOTO', section: 'returns-seedpaks', photo })
              }
              onPhotoQualityFlag={(photoId, flag) =>
                dispatch({ type: 'SET_PHOTO_QUALITY_FLAG', photoId, flag })
              }
              label={t('returnsStaging.tabSeedpaks', 'SeedPaks')}
              currentUser={inspection.currentInspector || inspection.startedBy || 'unknown'}
              readOnly={readOnly}
            />
          </section>
        </>
      )}

      {!isReturns && !isInbound && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">
              {t('review.finalLaneLead', 'Final')}{' '}
              <em>{t('review.finalLaneEm', 'staging lane')}</em>{' '}
              {t('review.finalLaneTail', 'photos')}
            </h2>
            <span className="section__meta">
              {readOnly
                ? t('review.finalLaneMetaView', 'Tap a photo to enlarge')
                : t('review.finalLaneMeta', 'Capture the finished staging lane with product')}
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
            label={t('review.finalLaneLabel', 'Final staging lane')}
            currentUser={inspection.currentInspector || inspection.startedBy || 'unknown'}
            readOnly={readOnly}
          />
        </section>
      )}

      {readOnly ? (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">
              {t('review.signOffLead', 'Inspector')} <em>{t('review.signOffEm', 'sign-off')}</em>
            </h2>
          </div>
          <div className="card">
            <div className="xs soft">{t('review.completedByLabel', 'Completed by')}</div>
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
            <strong>{t('review.signOffTitle', 'You are completing this inspection.')}</strong>{' '}
            {t(
              'review.signOffBody',
              'Your name will be recorded as the inspector who finalized this load.'
            )}
            {inspection.startedBy && inspection.startedBy !== completedBy && (
              <span>
                {' '}
                {t('review.startedByPrefix', 'This load was started by')}{' '}
                <strong>{inspection.startedBy}</strong>.
              </span>
            )}
          </div>
        </div>

        <div className="field">
          <div className="field__label">{t('review.completedByLabel', 'Completed by')}</div>
          <InspectorPicker
            siteId={inspection.siteId}
            value={completedBy}
            placeholder={t('review.selectName', 'Select your name…')}
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
              {isInbound
                ? t(
                    'review.attestInbound',
                    'I have personally verified this inbound load against the BOL and paperwork. All received product counts, batches, and damages are accurately recorded.'
                  )
                : isReturns
                ? t(
                    'review.attestReturns',
                    'I have personally verified this return. All product photos, batch, and product have been reviewed and are accurate.'
                  )
                : t(
                    'review.attestLoad',
                    'I have personally verified this load against the BOL and final paperwork. All pallet photos, batch codes, and bag counts have been reviewed and are accurate.'
                  )}
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
          <button
            className="btn btn--ghost"
            onClick={() =>
              isInbound
                ? navigate(`/inspection/${inspection.id}/verify-inbound`)
                : navigate(`/inspection/${inspection.id}`)
            }
          >
            {readOnly
              ? t('review.backToLoad', '← Back to load')
              : t('review.continueEditing', '← Continue editing')}
          </button>
          {!readOnly && (
            <button
              className="btn btn--accent btn--lg"
              onClick={complete}
            >
              {inspection.flaggedItemsCount > 0
                ? t('review.completeFlagged', '⚑ Complete (flagged)')
                : t('review.complete', '✓ Complete inspection')}
            </button>
          )}
        </div>
      </div>

      {lightboxUrl && (
        <PhotoLightbox
          url={lightboxUrl}
          onClose={() => {
            URL.revokeObjectURL(lightboxUrl);
            setLightboxUrl(null);
          }}
        />
      )}
    </main>
  );
}
