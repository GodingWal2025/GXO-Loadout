import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  dbGetInspection,
  dbSaveInspection,
  dbSavePhotoBlob,
  dbGetPhotoBlob,
  dbListInventoryItems,
  generateId,
  compressPhoto,
  checkImageQuality,
  parsePackInfo,
  useInspection,
  useCameraCapture,
  emptySuggestable,
  SuggestableField,
  StepBackLink,
  ImageQualityModal,
  PhotoLightbox,
} from '../shared';
import type {
  Inspection,
  InboundData,
  InboundLineItem,
  InspectionPhoto,
  QualityIssue,
} from '../shared';
import type { InventoryItem } from '../shared/types/inventory';
import { CapturedPageThumb } from '../components/CapturedPageThumb';
import { useT } from '../shared/i18n/LanguageContext';

export function VerifyInboundRoute() {
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

  return (
    <VerifyInboundInner
      initial={loaded}
      onFinished={() => navigate(`/inspection/${id}/review`)}
    />
  );
}

function VerifyInboundInner({
  initial,
  onFinished,
}: {
  initial: Inspection;
  onFinished: () => void;
}) {
  const { inspection, dispatch } = useInspection(initial);
  const t = useT();
  const navigate = useNavigate();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [activeDamageLineIndex, setActiveDamageLineIndex] = useState<number | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
  const [pendingDamage, setPendingDamage] = useState<{
    blob: Blob;
    previewUrl: string;
    issues: QualityIssue[];
    lineIndex: number;
  } | null>(null);

  useEffect(() => {
    dbListInventoryItems()
      .then(setInventory)
      .catch(() => {});
  }, []);

  const inbound: InboundData = useMemo(() => {
    return (
      inspection.inbound || {
        photoIds: [],
        bolNumber: emptySuggestable(),
        deliveryNumber: emptySuggestable(),
        stagingLane: { value: inspection.stagingLocation || null, source: 'manual' },
        dateReceived: { value: new Date().toISOString().split('T')[0], source: 'manual' },
        dateVerified: { value: new Date().toISOString().split('T')[0], source: 'manual' },
        verifier: { value: inspection.startedBy || null, source: 'manual' },
        lineItems: [],
      }
    );
  }, [inspection.inbound, inspection.stagingLocation, inspection.startedBy]);

  // Map inventory for fast batch lookup
  const inventoryByBatch = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    for (const item of inventory) {
      if (item.batch) {
        map.set(item.batch.trim().toUpperCase(), item);
      }
    }
    return map;
  }, [inventory]);

  // Damage photo camera hook
  const captureDamage = useCameraCapture(async (blob) => {
    if (activeDamageLineIndex === null) return;
    const quality = await checkImageQuality(blob, { allowLandscape: true });
    if (!quality.passed) {
      const previewUrl = URL.createObjectURL(blob);
      setPendingDamage({
        blob,
        previewUrl,
        issues: quality.issues,
        lineIndex: activeDamageLineIndex,
      });
      return;
    }
    await processDamagePhoto(blob, activeDamageLineIndex);
  });

  async function processDamagePhoto(blob: Blob, lineIndex: number) {
    try {
      const compressed = await compressPhoto(blob);
      const bitmap = await createImageBitmap(compressed);
      const photo: InspectionPhoto = {
        id: generateId(),
        capturedAt: new Date().toISOString(),
        capturedBy: inspection.startedBy || 'unknown',
        category: 'Inbound_Damage',
        localBlobUrl: URL.createObjectURL(compressed),
        metadata: {
          deviceModel: navigator.userAgent.includes('iPad') ? 'iPad' : 'web',
          orientation: bitmap.width > bitmap.height ? 'landscape' : 'portrait',
          originalWidth: bitmap.width,
          originalHeight: bitmap.height,
          fileSizeBytes: compressed.size,
        },
      };

      await dbSavePhotoBlob(photo.id, inspection.id, compressed);
      dispatch({ type: 'ADD_INBOUND_DAMAGE_PHOTO', lineIndex, photoId: photo.id });
    } catch (err) {
      console.error('Failed to save damage photo:', err);
    }
  }

  const updateHeader = (patch: Partial<InboundData>) => {
    dispatch({ type: 'SET_INBOUND', patch });
  };

  const addLine = () => {
    const currentLength = inbound.lineItems?.length || 0;
    const nextItemNumber = currentLength + 1;
    const newLine: InboundLineItem = {
      id: generateId(),
      itemNumber: nextItemNumber,
      materialNumber: emptySuggestable(),
      materialDescription: emptySuggestable(),
      batch: emptySuggestable(),
      uom: 'BG',
      location: { value: inbound.stagingLane.value || null, source: 'manual' },
      qtyReceived: emptySuggestable(),
      qtyDamaged: { value: 0, source: 'manual' },
      onBol: true,
      damagePhotoIds: [],
    };
    dispatch({ type: 'ADD_INBOUND_LINE', line: newLine });
    // Automatically collapse previous item and expand the newly added item
    setExpandedIndex(currentLength);
  };

  const updateLine = (index: number, patch: Partial<InboundLineItem>) => {
    dispatch({ type: 'UPDATE_INBOUND_LINE', index, patch });
  };

  const removeLine = (index: number) => {
    dispatch({ type: 'REMOVE_INBOUND_LINE', index });
  };

  const handleBatchChange = (index: number, rawBatch: string) => {
    const batchUpper = rawBatch.trim().toUpperCase();
    const invMatch = inventoryByBatch.get(batchUpper);

    if (invMatch) {
      // Auto-detect UOM from description (MB for Jumbo/Minibulk, SP for SeedPak, BG for Bag)
      const pack = parsePackInfo(invMatch.description);
      const uom: 'SP' | 'BG' | 'MB' =
        pack?.kind === 'MB' ? 'MB' : pack?.kind === 'SP' ? 'SP' : 'BG';

      updateLine(index, {
        batch: { value: rawBatch, source: 'manual' },
        materialNumber: { value: invMatch.sku, source: 'manual' },
        materialDescription: { value: invMatch.description, source: 'manual' },
        uom,
      });
    } else {
      updateLine(index, {
        batch: { value: rawBatch, source: 'manual' },
      });
    }
  };

  const startDamageCapture = (lineIndex: number) => {
    setActiveDamageLineIndex(lineIndex);
    setTimeout(() => captureDamage(), 50);
  };

  const handleRetakeDamage = () => {
    if (pendingDamage) URL.revokeObjectURL(pendingDamage.previewUrl);
    const lineIndex = pendingDamage?.lineIndex ?? activeDamageLineIndex;
    setPendingDamage(null);
    if (lineIndex !== null) {
      setActiveDamageLineIndex(lineIndex);
      setTimeout(() => captureDamage(), 50);
    }
  };

  const handleKeepDamage = async () => {
    if (!pendingDamage) return;
    const { blob, previewUrl, lineIndex } = pendingDamage;
    URL.revokeObjectURL(previewUrl);
    setPendingDamage(null);
    await processDamagePhoto(blob, lineIndex);
  };

  const lines = inbound.lineItems || [];
  const totalReceived = lines.reduce(
    (sum, li) => sum + (Number(li.qtyReceived?.value) || 0),
    0
  );
  const totalDamaged = lines.reduce(
    (sum, li) => sum + (Number(li.qtyDamaged?.value) || 0),
    0
  );

  const confirmAndFinish = async () => {
    dispatch({
      type: 'VERIFY_INBOUND',
      verifiedBy: inbound.verifier.value || inspection.startedBy || 'unknown',
    });
    // Update top-level staging and load numbers for cross-app consistency
    const updatedInspection: Inspection = {
      ...inspection,
      inbound: {
        ...inbound,
        verifiedAt: new Date().toISOString(),
        verifiedBy: inbound.verifier.value || inspection.startedBy || 'unknown',
      },
      bol: {
        ...inspection.bol,
        loadNumber: inbound.bolNumber.value ? inbound.bolNumber : inspection.bol.loadNumber,
      },
      lastEditedAt: new Date().toISOString(),
    };
    await dbSaveInspection(updatedInspection);
    onFinished();
  };

  return (
    <main style={{ maxWidth: 960 }}>
      <StepBackLink to={`/inspection/${inspection.id}/capture-inbound-bol`} />

      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            {t('verifyInbound.titleLead', 'Inbound')} <em>{t('verifyInbound.titleEm', 'Verification Log')}</em>
          </h1>
          <div className="page-head__sub">
            {t('verifyInbound.subtitle', 'Step 3 of 3 · Verify received items, quantities, damages, and locations')}
          </div>
        </div>
      </div>

      {/* ===== Header details section matching paper log ===== */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            {t('verifyInbound.headerDetailsLead', 'Log')} <em>{t('verifyInbound.headerDetailsEm', 'header')}</em>
          </h2>
          <span className="pill pill--info">Inbound</span>
        </div>

        <div className="card">
          <div className="field-row">
            <SuggestableField
              label={t('verifyInbound.bolNumber', 'BoL Number / Load #')}
              field={inbound.bolNumber}
              mono
              hideCamera
              placeholder="e.g. 835008894"
              onChange={(field) => updateHeader({ bolNumber: field })}
            />
            <SuggestableField
              label={t('verifyInbound.deliveryNumber', 'Delivery Number')}
              field={inbound.deliveryNumber}
              mono
              hideCamera
              placeholder="e.g. 40188921"
              onChange={(field) => updateHeader({ deliveryNumber: field })}
            />
          </div>

          <div className="field-row" style={{ marginTop: 12 }}>
            <div className="field">
              <div className="field__label">{t('verifyInbound.stagingLanes', 'Staging Lane(s)')}</div>
              <input
                type="text"
                placeholder="e.g. STW15, STW16"
                value={inbound.stagingLane.value || ''}
                onChange={(e) =>
                  updateHeader({
                    stagingLane: { value: e.target.value || null, source: 'manual' },
                  })
                }
              />
            </div>
            <div className="field">
              <div className="field__label">{t('verifyInbound.verifier', 'Verifier')}</div>
              <input
                type="text"
                placeholder="Inspector name"
                value={inbound.verifier.value || ''}
                onChange={(e) =>
                  updateHeader({
                    verifier: { value: e.target.value || null, source: 'manual' },
                  })
                }
              />
            </div>
          </div>

          <div className="field-row" style={{ marginTop: 12 }}>
            <div className="field">
              <div className="field__label">{t('verifyInbound.dateReceived', 'Date Received')}</div>
              <input
                type="date"
                value={inbound.dateReceived.value || ''}
                onChange={(e) =>
                  updateHeader({
                    dateReceived: { value: e.target.value || null, source: 'manual' },
                  })
                }
              />
            </div>
            <div className="field">
              <div className="field__label">{t('verifyInbound.dateVerified', 'Date Verified')}</div>
              <input
                type="date"
                value={inbound.dateVerified.value || ''}
                onChange={(e) =>
                  updateHeader({
                    dateVerified: { value: e.target.value || null, source: 'manual' },
                  })
                }
              />
            </div>
          </div>
        </div>
      </section>

      {/* ===== Line Items section ===== */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            {t('verifyInbound.lineItemsLead', 'Received')} <em>{t('verifyInbound.lineItemsEm', 'products')}</em>{' '}
            <span className="soft xs">({lines.length})</span>
          </h2>
          <button className="btn btn--sm btn--accent" onClick={addLine}>
            + {t('verifyInbound.addItem', 'Add Item')}
          </button>
        </div>

        {lines.length === 0 ? (
          <div className="empty">
            <div className="empty__title">{t('verifyInbound.noItems', 'No product rows added yet')}</div>
            <div className="empty__sub">
              {t('verifyInbound.noItemsHint', 'Tap "+ Add Item" to log received batches.')}
            </div>
            <button className="btn btn--accent mt-16" onClick={addLine}>
              + {t('verifyInbound.addItem', 'Add Item')}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {lines.map((li, index) => {
              const batchCode = (li.batch.value || '').trim().toUpperCase();
              const hasDamage = (Number(li.qtyDamaged.value) || 0) > 0;
              const inInv = inventoryByBatch.has(batchCode);
              const damagePhotoIds = li.damagePhotoIds || [];
              const isExpanded = expandedIndex === index;

              if (!isExpanded) {
                // Collapsed compact row
                return (
                  <div
                    key={li.id}
                    className="card"
                    style={{
                      borderLeft: hasDamage ? '4px solid var(--danger)' : inInv ? '4px solid var(--success)' : '4px solid var(--rule)',
                      padding: '10px 14px',
                      cursor: 'pointer',
                    }}
                    onClick={() => setExpandedIndex(index)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span className="pill pill--neutral" style={{ fontWeight: 700 }}>
                          #{li.itemNumber || index + 1}
                        </span>
                        <span className="mono fw-600" style={{ fontSize: 13 }}>
                          {li.batch.value || <span className="soft">—</span>}
                        </span>
                        {li.materialNumber?.value && (
                          <span className="mono small soft">({li.materialNumber.value})</span>
                        )}
                        <span className="pill pill--info" style={{ fontSize: 11 }}>
                          {li.qtyReceived.value ?? 0} {li.uom}
                        </span>
                        {hasDamage && (
                          <span className="pill pill--danger" style={{ fontSize: 11 }}>
                            ⚑ {li.qtyDamaged.value} Damaged ({damagePhotoIds.length} 📷)
                          </span>
                        )}
                        {li.location?.value && (
                          <span className="small soft">📍 {li.location.value}</span>
                        )}
                        <span className={`pill ${li.onBol ? 'pill--success' : 'pill--warn'}`} style={{ fontSize: 10 }}>
                          BOL: {li.onBol ? 'Yes' : 'No'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn--outline btn--sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedIndex(index);
                          }}
                          style={{ fontSize: 12, padding: '2px 8px' }}
                        >
                          ▼ Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeLine(index);
                          }}
                          title={t('verifyInbound.removeLine', 'Remove row')}
                          style={{ color: 'var(--danger)', padding: '2px 6px' }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              // Expanded full editable card
              return (
                <div
                  key={li.id}
                  className="card"
                  style={{
                    borderLeft: hasDamage ? '4px solid var(--danger)' : inInv ? '4px solid var(--success)' : '4px solid var(--rule)',
                    padding: 16,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="pill pill--neutral" style={{ fontWeight: 700 }}>
                        #{li.itemNumber || index + 1}
                      </span>
                      {batchCode && inInv && (
                        <span className="pill pill--success" style={{ fontSize: 11 }}>
                          ✓ {t('verifyInbound.inInventory', 'In Inventory')}
                        </span>
                      )}
                      {batchCode && !inInv && inventory.length > 0 && (
                        <span className="pill pill--warn" style={{ fontSize: 11 }}>
                          ⚠ {t('verifyInbound.manualBatch', 'Not in inventory')}
                        </span>
                      )}
                      {hasDamage && (
                        <span className="pill pill--danger" style={{ fontSize: 11 }}>
                          ⚑ {t('verifyInbound.damagedBadge', '{count} Damaged', { count: li.qtyDamaged.value || 0 })}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setExpandedIndex(null)}
                        style={{ fontSize: 12 }}
                      >
                        ▲ Collapse
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => removeLine(index)}
                        title={t('verifyInbound.removeLine', 'Remove row')}
                        style={{ color: 'var(--danger)', padding: '4px 8px' }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Grid fields */}
                  <div className="field-row" style={{ marginBottom: 12 }}>
                    <div className="field" style={{ flex: 1.1 }}>
                      <div className="field__label">{t('verifyInbound.colBatch', 'Batch')} *</div>
                      <input
                        type="text"
                        className="mono"
                        placeholder="e.g. H21YA13JX"
                        value={li.batch.value || ''}
                        onChange={(e) => handleBatchChange(index, e.target.value)}
                        style={{ textTransform: 'uppercase' }}
                      />
                    </div>

                    <div className="field" style={{ flex: 1.1 }}>
                      <div className="field__label">{t('verifyInbound.colMaterial', 'Material / SKU')}</div>
                      <input
                        type="text"
                        className="mono"
                        placeholder="e.g. 87674223"
                        value={li.materialNumber.value || ''}
                        onChange={(e) =>
                          updateLine(index, {
                            materialNumber: { value: e.target.value || null, source: 'manual' },
                          })
                        }
                      />
                    </div>

                    <div className="field" style={{ flex: 1.2 }}>
                      <div className="field__label">{t('verifyInbound.colUom', 'Package / UOM')}</div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                        <button
                          type="button"
                          className={`btn btn--sm ${li.uom === 'SP' ? 'btn--accent' : 'btn--outline'}`}
                          onClick={() => updateLine(index, { uom: 'SP' })}
                          style={{ flex: 1, padding: '6px 2px', fontSize: 11 }}
                        >
                          SP (SeedPak)
                        </button>
                        <button
                          type="button"
                          className={`btn btn--sm ${li.uom === 'BG' ? 'btn--accent' : 'btn--outline'}`}
                          onClick={() => updateLine(index, { uom: 'BG' })}
                          style={{ flex: 1, padding: '6px 2px', fontSize: 11 }}
                        >
                          BG (Bag)
                        </button>
                        <button
                          type="button"
                          className={`btn btn--sm ${li.uom === 'MB' ? 'btn--accent' : 'btn--outline'}`}
                          onClick={() => updateLine(index, { uom: 'MB' })}
                          style={{ flex: 1, padding: '6px 2px', fontSize: 11 }}
                        >
                          MB (Jumbo)
                        </button>
                      </div>
                    </div>
                  </div>

                  {li.materialDescription?.value && (
                    <div className="small soft" style={{ marginBottom: 12, marginTop: -4 }}>
                      <strong>{t('verifyInbound.colDesc', 'Description')}:</strong> {li.materialDescription.value}
                    </div>
                  )}

                  <div className="field-row">
                    <div className="field">
                      <div className="field__label">{t('verifyInbound.colLoc', 'LOC (Location)')}</div>
                      <input
                        type="text"
                        placeholder="e.g. STW15 / A01"
                        value={li.location?.value || ''}
                        onChange={(e) =>
                          updateLine(index, {
                            location: { value: e.target.value || null, source: 'manual' },
                          })
                        }
                      />
                    </div>

                    <div className="field">
                      <div className="field__label">{t('verifyInbound.colQtyReceived', 'Qty Received')} *</div>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={li.qtyReceived.value === null ? '' : String(li.qtyReceived.value)}
                        onChange={(e) =>
                          updateLine(index, {
                            qtyReceived: {
                              value: e.target.value === '' ? null : Number(e.target.value),
                              source: 'manual',
                            },
                          })
                        }
                      />
                    </div>

                    <div className="field">
                      <div className="field__label" style={{ color: hasDamage ? 'var(--danger)' : undefined }}>
                        {t('verifyInbound.colQtyDamaged', 'Qty Damaged')}
                      </div>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={li.qtyDamaged.value === null ? '' : String(li.qtyDamaged.value)}
                        onChange={(e) =>
                          updateLine(index, {
                            qtyDamaged: {
                              value: e.target.value === '' ? 0 : Number(e.target.value),
                              source: 'manual',
                            },
                          })
                        }
                        style={hasDamage ? { borderColor: 'var(--danger)' } : undefined}
                      />
                    </div>

                    <div className="field" style={{ flex: 0.8 }}>
                      <div className="field__label">{t('verifyInbound.colOnBol', 'On BOL?')}</div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <button
                          type="button"
                          className={`btn btn--sm ${li.onBol ? 'btn--accent' : 'btn--outline'}`}
                          onClick={() => updateLine(index, { onBol: true })}
                          style={{ flex: 1, padding: '6px 0' }}
                        >
                          {t('verifyInbound.yes', 'Yes')}
                        </button>
                        <button
                          type="button"
                          className={`btn btn--sm ${!li.onBol ? 'btn--warn' : 'btn--outline'}`}
                          onClick={() => updateLine(index, { onBol: false })}
                          style={{ flex: 1, padding: '6px 0' }}
                        >
                          {t('verifyInbound.no', 'No')}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* ===== Damage Photos capture area if damage > 0 ===== */}
                  {hasDamage && (
                    <div
                      style={{
                        marginTop: 16,
                        padding: 12,
                        background: 'rgba(239, 68, 68, 0.05)',
                        border: '1px dashed var(--danger)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 8,
                        }}
                      >
                        <div className="small" style={{ color: 'var(--danger)', fontWeight: 600 }}>
                          📷 {t('verifyInbound.damagePhotosTitle', 'Damage Photos ({count})', { count: damagePhotoIds.length })}
                        </div>
                        <button
                          type="button"
                          className="btn btn--sm btn--outline"
                          onClick={() => startDamageCapture(index)}
                          style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                        >
                          📷 {t('verifyInbound.takeDamagePhoto', 'Take damage photo')}
                        </button>
                      </div>

                      {damagePhotoIds.length === 0 ? (
                        <div className="xs soft" style={{ color: 'var(--danger)' }}>
                          {t('verifyInbound.damagePhotoHint', 'Please photograph the damaged units / packaging.')}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {damagePhotoIds.map((pid) => (
                            <div key={pid} style={{ position: 'relative' }}>
                              <div
                                onClick={async () => {
                                  const blob = await dbGetPhotoBlob(pid);
                                  if (blob) setLightboxUrl(URL.createObjectURL(blob));
                                }}
                                style={{ cursor: 'pointer' }}
                              >
                                <CapturedPageThumb
                                  photoId={pid}
                                  inspectionId={inspection.id}
                                  label={t('verifyInbound.damageThumb', 'Damage')}
                                />
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  dispatch({
                                    type: 'REMOVE_INBOUND_DAMAGE_PHOTO',
                                    lineIndex: index,
                                    photoId: pid,
                                  });
                                }}
                                style={{
                                  position: 'absolute',
                                  top: -6,
                                  right: -6,
                                  background: 'var(--danger)',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: '50%',
                                  width: 20,
                                  height: 20,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 11,
                                  fontWeight: 'bold',
                                }}
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ===== Summary bar ===== */}
      <div
        className="card"
        style={{
          display: 'flex',
          justifyContent: 'space-around',
          alignItems: 'center',
          marginTop: 24,
          padding: 16,
          background: 'var(--surface-tint)',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div className="small soft">{t('verifyInbound.summaryLines', 'Items Logged')}</div>
          <div className="mono fw-600" style={{ fontSize: 20 }}>
            {lines.length}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div className="small soft">{t('verifyInbound.summaryReceived', 'Total Received')}</div>
          <div className="mono fw-600" style={{ fontSize: 20, color: 'var(--accent)' }}>
            {totalReceived}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div className="small soft">{t('verifyInbound.summaryDamaged', 'Total Damaged')}</div>
          <div
            className="mono fw-600"
            style={{ fontSize: 20, color: totalDamaged > 0 ? 'var(--danger)' : 'var(--ink)' }}
          >
            {totalDamaged}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div className="small soft">{t('verifyInbound.summaryBolPhotos', 'BOL Photos')}</div>
          <div className="mono fw-600" style={{ fontSize: 20 }}>
            {inbound.photoIds?.length || 0}
          </div>
        </div>
      </div>

      {/* ===== Bottom Actions ===== */}
      <div className="flex gap-8 mt-24" style={{ justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => navigate(`/inspection/${inspection.id}/capture-inbound-bol`)}
        >
          {t('verifyInbound.backToBol', '← Back to BOL photo')}
        </button>
        <button
          type="button"
          className="btn btn--accent btn--lg"
          onClick={confirmAndFinish}
          disabled={lines.length === 0}
        >
          {t('verifyInbound.continueReview', '✓ Review & Complete Inspection')}
        </button>
      </div>

      {/* Lightbox for damage photos */}
      {lightboxUrl && (
        <PhotoLightbox
          url={lightboxUrl}
          label={t('verifyInbound.damageThumb', 'Damage')}
          onClose={() => {
            URL.revokeObjectURL(lightboxUrl);
            setLightboxUrl(null);
          }}
        />
      )}

      {/* Quality check modal */}
      {pendingDamage && (
        <ImageQualityModal
          previewUrl={pendingDamage.previewUrl}
          issues={pendingDamage.issues}
          onRetake={handleRetakeDamage}
          onKeep={handleKeepDamage}
        />
      )}
    </main>
  );
}
