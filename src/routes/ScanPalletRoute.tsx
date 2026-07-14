import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { dbGetInspection, SlotPhotoCapture } from '../shared';
import { useInspection } from '../shared';
import { SuggestableField } from '../shared';
import { QualityFlagButton } from '../shared';
import type { Inspection, BatchSection } from '../shared';
import { PALLET_TYPES } from '../shared';
import { DynamicPhotoChecklist } from '../components/DynamicPhotoChecklist';

const FINDINGS_OPTIONS = [
  'Picked Short',
  'Picked Long',
  'Wrong LPN',
  'Missed Scan',
  'Not Taken through Inventory',
  'Staging Error (wrong location, stops mixed, etc)',
  'Poor Wrapping',
  'Bags DMG',
  'Pallet DMG / Bag',
  'Pallet Dirty',
  'Stacking Issue',
  'Tags Missing',
  'Damage / Reject - Date on tag',
  'Damage / Reject - Plot seed',
  'Other'
];

export function ScanPalletRoute() {
  const { id, palletIndex } = useParams<{ id: string; palletIndex: string }>();
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
  const idx = parseInt(palletIndex || '0', 10);
  if (idx < 0 || idx >= loaded.pallets.length) {
    navigate(`/inspection/${loaded.id}`);
    return null;
  }
  return <PalletInner initial={loaded} palletIndex={idx} />;
}

function PalletInner({ initial, palletIndex }: { initial: Inspection; palletIndex: number }) {
  const { inspection, dispatch } = useInspection(initial);
  const navigate = useNavigate();
  const pallet = inspection.pallets[palletIndex];

  const currentFindings = useMemo(() => {
    if (!pallet?.findings) return [];
    return pallet.findings.split(',').map(f => f.trim()).filter(Boolean);
  }, [pallet?.findings]);

  const [validationError, setValidationError] = useState('');

  const handleAdd = () => {
    if (!pallet.lpnNumber && inspection.type !== 'returns') {
      setValidationError('LPN number is required.');
      return;
    }
    const missingBatch = pallet.batchSections.some(s => !s.batchCode?.value);
    if (missingBatch) {
      setValidationError('All batch sections must have a batch code.');
      return;
    }
    setValidationError('');
    navigate(`/inspection/${inspection.id}`);
  };

  const toggleFinding = (finding: string) => {
    let updated: string[];
    if (currentFindings.includes(finding)) {
      updated = currentFindings.filter(f => f !== finding);
    } else {
      updated = [...currentFindings, finding];
    }
    dispatch({
      type: 'UPDATE_PALLET',
      index: palletIndex,
      patch: { findings: updated.join(', ') },
    });
  };

  if (!pallet) {
    navigate(`/inspection/${inspection.id}`);
    return null;
  }



  // Expected batches for this pallet — pulled from picklist line items
  // assigned to the same delivery, plus any batches already entered manually
  // in this pallet's batchSections. Passed to OCR so it can match Tesseract's


  const removePallet = () => {
    if (!window.confirm('Remove this pallet? Photos and data will be lost.')) return;
    dispatch({ type: 'REMOVE_PALLET', index: palletIndex });
    navigate(`/inspection/${inspection.id}`);
  };

  const delivery = inspection.bol.deliveries.find((d) => d.id === pallet.deliveryId);

  const totalActualOnPallet = pallet.batchSections.reduce(
    (sum, bs) => sum + (bs.actualBagCount.value || 0),
    0
  );

  // For each section, compute how much more is "available" (i.e., remaining on picklist)
  const remainingForBatch = (batchCode: string | null) => {
    if (!batchCode) return null;
    const lineItem = inspection.picklist.lineItems.find((li) => li.batchCode.value === batchCode);
    if (!lineItem) return null;
    const expected = lineItem.expectedQuantity.value || 0;
    // Total already counted across all pallets except this one
    let countedElsewhere = 0;
    inspection.pallets.forEach((p, idx) => {
      if (idx === palletIndex) return;
      p.batchSections.forEach((bs) => {
        if (bs.batchCode.value === batchCode) {
          countedElsewhere += bs.actualBagCount.value || 0;
        }
      });
    });
    return Math.max(0, expected - countedElsewhere);
  };

  const isReturns = inspection.type === 'returns';
  const showReturnPalletTypeWarning = isReturns && (pallet.palletType === 'Full Bag Pallet' || pallet.palletType === 'Partial Bag Pallet');
  const returnPalletTypeWarning = (() => {
    if (!showReturnPalletTypeWarning) return null;
    if (pallet.palletType === 'Full Bag Pallet' && totalActualOnPallet < 60) {
      return `Full bag pallets must contain exactly 60 bags. Since this pallet has less than 60 bags (${totalActualOnPallet}), it should be marked as a Partial Bag Pallet.`;
    }
    if (pallet.palletType === 'Partial Bag Pallet' && totalActualOnPallet >= 60) {
      return `A partial bag pallet should contain less than 60 bags. Since this pallet has 60 or more bags (${totalActualOnPallet}), it should be marked as a Full Bag Pallet.`;
    }
    return null;
  })();

  const returnDuplicateBatchWarning = (() => {
    if (!isReturns || totalActualOnPallet >= 60) return null;
    for (const bs of pallet.batchSections) {
      const batchCode = bs.batchCode.value;
      if (!batchCode) continue;

      for (let otherIdx = 0; otherIdx < inspection.pallets.length; otherIdx++) {
        if (otherIdx === palletIndex) continue;
        const otherPallet = inspection.pallets[otherIdx];

        const otherPalletTotal = otherPallet.batchSections.reduce(
          (sum, obs) => sum + (obs.actualBagCount.value || 0),
          0
        );

        if (otherPalletTotal < 60) {
          const hasSameBatch = otherPallet.batchSections.some(
            (obs) => obs.batchCode.value === batchCode
          );
          if (hasSameBatch) {
            return `There is another pallet (Pallet ${otherPallet.palletNumber}) containing batch ${batchCode} that is also under 60 bags (${otherPalletTotal} bags). Consider consolidating them.`;
          }
        }
      }
    }
    return null;
  })();

  return (
    <main>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            Pallet <em>{pallet.palletNumber}</em>
          </h1>
          <div className="page-head__sub">
            {pallet.palletType}
            {!isReturns && delivery && (
              <>
                {' '}· Delivery <span className="mono">{delivery.deliveryNumber}</span>
                {delivery.stopNumber !== undefined && <> (Stop {delivery.stopNumber})</>}
              </>
            )}
          </div>
        </div>
        <div className="page-head__actions">
          <QualityFlagButton
            flag={pallet.qualityFlag}
            level="pallet"
            currentUser={inspection.startedBy || 'unknown'}
            onFlag={(flag) =>
              dispatch({ type: 'SET_PALLET_QUALITY_FLAG', index: palletIndex, flag })
            }
            onUnflag={() =>
              dispatch({ type: 'SET_PALLET_QUALITY_FLAG', index: palletIndex, flag: undefined })
            }
          />
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => navigate(`/inspection/${inspection.id}`)}
          >
            ← Back
          </button>
        </div>
      </div>

      {returnPalletTypeWarning && (
        <div className="banner banner--warn" style={{ marginBottom: 20 }}>
          <span className="banner__icon">⚠</span>
          <div className="banner__body">
            {returnPalletTypeWarning}
          </div>
        </div>
      )}

      {returnDuplicateBatchWarning && (
        <div className="banner banner--info" style={{ marginBottom: 20 }}>
          <span className="banner__icon">i</span>
          <div className="banner__body">
            {returnDuplicateBatchWarning}
          </div>
        </div>
      )}

      {/* Pallet type / change */}
      <section className="section">
        <div className="field">
          <div className="field__label">Pallet type</div>
          <select
            value={pallet.palletType}
            onChange={(e) =>
              dispatch({
                type: 'UPDATE_PALLET',
                index: palletIndex,
                patch: { palletType: e.target.value as any },
              })
            }
          >
            {(inspection.type === 'returns'
              ? PALLET_TYPES.filter(t => t !== 'Mixed Bag Pallet' && t !== 'Minibulk' && t !== 'Paper Bag')
              : PALLET_TYPES
            ).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </section>

      {/* Photo slots — handled by Semantic Photo Dictionary */}
      <section className="section">
        <DynamicPhotoChecklist 
          palletType={pallet.palletType}
          inspectionId={inspection.id}
          palletIndex={palletIndex}
          isReturns={inspection.type === 'returns'}
          currentUser={inspection.startedBy || 'unknown'}
          photos={pallet.photos}
          onCaptured={(slotKey: any, photo: any) =>
            dispatch({
              type: 'REPLACE_PALLET_PHOTO',
              palletIndex,
              slotKey,
              photo,
            })
          }
          onQualityFlag={(photoId: any, flag: any) =>
            dispatch({ type: 'SET_PHOTO_QUALITY_FLAG', photoId, flag })
          }
        />
      </section>

      {/* Batch sections - one per batch on this pallet */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            Batch <em>{pallet.batchSections.length === 1 ? 'data' : 'sections'}</em>
          </h2>
          {pallet.batchSections.length > 1 && (
            <span className="section__meta">{pallet.batchSections.length} batches on this pallet</span>
          )}
        </div>

        {pallet.batchSections.map((section, sectionIdx) => (
          <BatchSectionRow
            key={section.id}
            section={section}
            sectionNumber={sectionIdx + 1}
            isMultiple={pallet.batchSections.length > 1}
            isReturns={isReturns}
            remainingAvailable={remainingForBatch(section.batchCode.value)}
            onUpdate={(patch) =>
              dispatch({
                type: 'UPDATE_BATCH_SECTION',
                palletIndex,
                sectionId: section.id,
                patch,
              })
            }
          />
        ))}
      </section>

      {/* Inspection result */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            {isReturns ? 'Damage' : <>Order <em>Verification</em></>}
          </h2>
        </div>
        
        <div className="field-row">
          <div className="field">
            <div className="field__label">
              {isReturns 
                ? '* Was anything damaged (Mouse holes, unfilled Seedpaks/bags, or overly damaged bags/boxes)?' 
                : '* Does the Bag Pallet pass inspection with no findings? (No damage, all info matches, all labels applied)'}
            </div>
            <div className="toggle-group">
              <button
                className={pallet.passInspection === 'Pass' ? 'active' : ''}
                onClick={() =>
                  dispatch({
                    type: 'UPDATE_PALLET',
                    index: palletIndex,
                    patch: { passInspection: 'Pass' },
                  })
                }
              >
                {isReturns ? 'No' : 'Pass'}
              </button>
              <button
                className={pallet.passInspection === 'Fail' ? 'active danger' : ''}
                onClick={() =>
                  dispatch({
                    type: 'UPDATE_PALLET',
                    index: palletIndex,
                    patch: { passInspection: 'Fail' },
                  })
                }
              >
                {isReturns ? 'Yes' : 'Fail'}
              </button>
            </div>
          </div>
          
          {inspection.type !== 'returns' && (
            <div className="field">
              <div className="field__label">* What is the LPN number?</div>
              <input
                type="text"
                value={pallet.lpnNumber || ''}
                onChange={(e) =>
                  dispatch({
                    type: 'UPDATE_PALLET',
                    index: palletIndex,
                    patch: { lpnNumber: e.target.value },
                  })
                }
                placeholder="Enter LPN number..."
                className="mono"
              />
            </div>
          )}

          {inspection.type !== 'returns' && (
            <div className="field">
              <div className="field__label">* Is there an accuracy verification label attached?</div>
              <div className="toggle-group">
                {(['Yes', 'No', 'N/A'] as const).map((v) => (
                  <button
                    key={v}
                    className={pallet.accuracyLabelAttached === v ? 'active' : ''}
                    onClick={() =>
                      dispatch({
                        type: 'UPDATE_PALLET',
                        index: palletIndex,
                        patch: { accuracyLabelAttached: v },
                      })
                    }
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {pallet.passInspection === 'Fail' && (
          <div className="flex-col gap-16" style={{ marginTop: 16 }}>
            {isReturns && (
              <div className="field">
                 <div className="field__label">* Photograph the damage</div>
                 <div className="photo-slot-grid">
                   <SlotPhotoCapture
                      inspectionId={inspection.id}
                      category="Returns_Damage_Assessment"
                      slotKey="RETURNS_DAMAGE"
                      slotLabel="Damage Photo"
                      palletIndex={palletIndex}
                      existingPhoto={pallet.photos.find((p: any) => p.slotKey === 'RETURNS_DAMAGE')}
                      currentUser={inspection.startedBy || 'unknown'}
                      onCaptured={(photo: any) => dispatch({ type: 'REPLACE_PALLET_PHOTO', palletIndex, slotKey: 'RETURNS_DAMAGE', photo })}
                      onQualityFlag={(photoId: string, flag: any) => dispatch({ type: 'SET_PHOTO_QUALITY_FLAG', photoId, flag })}
                   />
                 </div>
              </div>
            )}
            <div className="field">
              <div className="field__label">* Select all {pallet.palletType} findings</div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 8,
                border: '1px solid var(--rule-soft)',
                padding: 12,
                borderRadius: 6,
                background: 'var(--surface)',
                maxHeight: 240,
                overflowY: 'auto'
              }}>
                {FINDINGS_OPTIONS.map(opt => {
                  const isChecked = currentFindings.includes(opt);
                  return (
                    <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }} className="small font-medium">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleFinding(opt)}
                        style={{ cursor: 'pointer', width: 16, height: 16 }}
                      />
                      {opt}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="field">
              <div className="field__label">Rejected Bags (how many bags are rejected)</div>
              <input
                type="number"
                value={pallet.rejectedBagCount === undefined ? '' : String(pallet.rejectedBagCount)}
                onChange={(e) =>
                  dispatch({
                    type: 'UPDATE_PALLET',
                    index: palletIndex,
                    patch: {
                      rejectedBagCount: e.target.value === '' ? undefined : Number(e.target.value),
                    },
                  })
                }
                placeholder="0"
              />
            </div>
            <div className="field">
              <div className="field__label">Notes / Reasoning for rejection</div>
              <textarea
                value={pallet.rejectedNotes || ''}
                onChange={(e) =>
                  dispatch({
                    type: 'UPDATE_PALLET',
                    index: palletIndex,
                    patch: { rejectedNotes: e.target.value },
                  })
                }
                rows={3}
                placeholder="Describe why these bags were rejected (e.g. forklift damage, mouse holes, water damage)..."
              />
            </div>
          </div>
        )}
      </section>

      <div className="card" style={{ background: 'var(--surface-tint)', marginTop: 16 }}>
        <div className="row-between">
          <div>
            <div className="xs soft" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Total on this pallet
            </div>
            <div className="fw-500" style={{ fontSize: 24 }}>{totalActualOnPallet} bags</div>
          </div>
        </div>
      </div>

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
          <button className="btn btn--danger btn--ghost" onClick={removePallet}>
            Remove pallet
          </button>
          <button
            className="btn btn--accent btn--lg"
            onClick={handleAdd}
          >
            ✓ Add to load
          </button>
        </div>
      </div>
    </main>
  );
}

function BatchSectionRow({
  section,
  sectionNumber,
  isMultiple,
  isReturns,
  remainingAvailable,
  onUpdate,
}: {
  section: BatchSection;
  sectionNumber: number;
  isMultiple: boolean;
  isReturns: boolean;
  remainingAvailable: number | null;
  onUpdate: (patch: Partial<BatchSection>) => void;
}) {
  const actual = section.actualBagCount.value;
  const expected = section.expectedBagCount;
  const mismatch = expected > 0 && actual !== null && actual !== expected;

  return (
    <div className="card">
      {isMultiple && (
        <div
          className="xs soft fw-500"
          style={{ textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}
        >
          Batch {sectionNumber}
        </div>
      )}
      <div className="field-row">
        <SuggestableField
          label="Batch code"
          field={section.batchCode}
          mono
          hideCamera={true}
          placeholder="P18GY43M8"
          onChange={(field) => onUpdate({ batchCode: field })}
        />
        {!isReturns && (
          <div className="field">
            <div className="field__label">Expected bag count</div>
            <input
              type="number"
              value={expected || ''}
              readOnly
              disabled
              placeholder="—"
              style={{ background: 'var(--surface-tint)', cursor: 'not-allowed' }}
            />
            <div className="field__hint">
              {section.batchCode.value
                ? `From picklist line for ${section.batchCode.value}`
                : 'Enter batch code first'}
            </div>
          </div>
        )}
        <SuggestableField
          label="Actual bag count (confirm)"
          field={section.actualBagCount}
          type="number"
          hideCamera={true}
          placeholder={remainingAvailable !== null ? String(remainingAvailable) : '0'}
          onChange={(field) => onUpdate({ actualBagCount: field })}
        />
      </div>

      {remainingAvailable !== null && remainingAvailable > 0 && (
        <div className="small soft mt-8">
          {remainingAvailable} bags remaining on picklist for this batch (already scanned on other pallets)
        </div>
      )}

      {mismatch && (
        <div className="banner banner--warn" style={{ marginTop: 8, marginBottom: 0 }}>
          <span className="banner__icon">⚠</span>
          <div className="banner__body">
            Count mismatch: expected <strong>{expected}</strong>, you entered <strong>{actual}</strong>
            {actual !== null && expected !== 0 && (
              <> (difference {(actual - expected) > 0 ? '+' : ''}{actual - expected})</>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
