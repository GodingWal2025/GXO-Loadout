import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { dbGetInspection, SlotPhotoCapture } from '../shared';
import { useInspection, useInspectionMode } from '../shared';
import { AlphanumericInput, SuggestableField } from '../shared';
import { QualityFlagButton } from '../shared';
import { ViewEditToggle } from '../shared';
import type { Inspection, BatchSection, PalletType } from '../shared';
import { PALLET_TYPES, ConfirmModal, actualCountInUom, actualCountUom, isBatchNotOnOriginalPicklist, normalizeBatchCode } from '../shared';
import { DynamicPhotoChecklist } from '../components/DynamicPhotoChecklist';
import { useT } from '../shared/i18n/LanguageContext';

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

// The findings and pallet-type values above are persisted data, so they stay in
// English. These hooks translate them only at the point of display.
function useFindingLabel(): (value: string) => string {
  const t = useT();
  const labels: Record<string, string> = {
    'Picked Short': t('pallet.findingPickedShort', 'Picked Short'),
    'Picked Long': t('pallet.findingPickedLong', 'Picked Long'),
    'Wrong LPN': t('pallet.findingWrongLpn', 'Wrong LPN'),
    'Missed Scan': t('pallet.findingMissedScan', 'Missed Scan'),
    'Not Taken through Inventory': t('pallet.findingNotInventory', 'Not Taken through Inventory'),
    'Staging Error (wrong location, stops mixed, etc)': t(
      'pallet.findingStagingError',
      'Staging Error (wrong location, stops mixed, etc)'
    ),
    'Poor Wrapping': t('pallet.findingPoorWrapping', 'Poor Wrapping'),
    'Bags DMG': t('pallet.findingBagsDmg', 'Bags DMG'),
    'Pallet DMG / Bag': t('pallet.findingPalletDmg', 'Pallet DMG / Bag'),
    'Pallet Dirty': t('pallet.findingPalletDirty', 'Pallet Dirty'),
    'Stacking Issue': t('pallet.findingStackingIssue', 'Stacking Issue'),
    'Tags Missing': t('pallet.findingTagsMissing', 'Tags Missing'),
    'Damage / Reject - Date on tag': t('pallet.findingDamageDate', 'Damage / Reject - Date on tag'),
    'Damage / Reject - Plot seed': t('pallet.findingDamagePlotSeed', 'Damage / Reject - Plot seed'),
    Other: t('pallet.findingOther', 'Other'),
  };
  return (value: string) => labels[value] ?? value;
}

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

function formatUomCount(
  count: number,
  uom: string | undefined,
  palletType: PalletType,
  t: ReturnType<typeof useT>
): string {
  const code = (
    uom || (palletType === 'Seedpak' ? 'SP' : palletType === 'Minibulk' ? 'MB' : 'BG')
  ).toUpperCase();

  if (code === 'SP' || code === 'SEEDPAK') {
    return `${count} SP`;
  }
  if (code === 'MB' || code === 'MINIBULK') {
    return `${count} MB`;
  }
  if (code === 'PL') {
    return `${count} ${actualCountUom(code)}`;
  }
  if (code === 'C62') {
    return `${count} C62`;
  }
  if (code === 'PCE') {
    return count === 1
      ? t('pallet.piecesCountOne', '{count} piece', { count })
      : t('pallet.piecesCount', '{count} pieces', { count });
  }
  return count === 1
    ? t('pallet.bagsCountOne', '{count} bag', { count })
    : t('pallet.bagsCount', '{count} bags', { count });
}

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
  const { locked, editing, readOnly, setEditing } = useInspectionMode(inspection);
  const t = useT();
  const findingLabel = useFindingLabel();
  const palletTypeLabel = usePalletTypeLabel();
  const navigate = useNavigate();
  const location = useLocation();
  const isFromInvestigation = location.state?.from === 'investigation';
  const pallet = inspection.pallets[palletIndex];

  const currentFindings = useMemo(() => {
    if (!pallet?.findings) return [];
    return pallet.findings.split(',').map(f => f.trim()).filter(Boolean);
  }, [pallet?.findings]);

  const [validationError, setValidationError] = useState('');
  const [showConfirmRemove, setShowConfirmRemove] = useState(false);

  const handleAdd = () => {
    if (!pallet.lpnNumber && inspection.type !== 'returns' && pallet.passInspection === 'Fail') {
      setValidationError(t('pallet.errLpnRequired', 'LPN number is required.'));
      return;
    }
    const missingBatch = pallet.batchSections.some(s => !s.batchCode?.value);
    if (missingBatch) {
      setValidationError(
        t('pallet.errBatchRequired', 'All batch sections must have a batch code.')
      );
      return;
    }
    setValidationError('');
    navigate(isFromInvestigation ? '/investigation' : `/inspection/${inspection.id}`);
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

  const removePallet = () => {
    setShowConfirmRemove(true);
  };

  const confirmRemovePallet = () => {
    setShowConfirmRemove(false);
    dispatch({ type: 'REMOVE_PALLET', index: palletIndex });
    navigate(`/inspection/${inspection.id}`);
  };

  const delivery = inspection.bol.deliveries.find((d) => d.id === pallet.deliveryId);

  const palletUom = useMemo(() => {
    for (const section of pallet.batchSections) {
      if (section.batchCode?.value) {
        const sectionCode = normalizeBatchCode(section.batchCode.value);
        const li = inspection.picklist.lineItems.find(
          (item) => normalizeBatchCode(item.batchCode.value) === sectionCode
        );
        if (li?.uom) return li.uom;
      }
    }
    if (pallet.palletType === 'Seedpak') return 'SP';
    if (pallet.palletType === 'Minibulk') return 'MB';
    return 'BG';
  }, [pallet.batchSections, pallet.palletType, inspection.picklist.lineItems]);

  const totalActualOnPallet = pallet.batchSections.reduce(
    (sum, bs) => sum + (bs.actualBagCount.value || 0),
    0
  );

  const totalDisplayOnPallet = useMemo(
    () =>
      pallet.batchSections.reduce((sum, section) => {
        const code = normalizeBatchCode(section.batchCode.value);
        const line = inspection.picklist.lineItems.find(
          (item) => normalizeBatchCode(item.batchCode.value) === code
        );
        const sectionUom = line?.uom || palletUom;
        return (
          sum +
          actualCountInUom(
            sectionUom,
            section.actualBagCount.value,
            line?.description.value
          )
        );
      }, 0),
    [pallet.batchSections, inspection.picklist.lineItems, palletUom]
  );

  // For each section, compute how much more is "available" (i.e., remaining on picklist)
  const remainingForBatch = (batchCode: string | null) => {
    const normalizedBatch = normalizeBatchCode(batchCode);
    if (!normalizedBatch) return null;
    const lineItem = inspection.picklist.lineItems.find(
      (li) => normalizeBatchCode(li.batchCode.value) === normalizedBatch
    );
    if (!lineItem) return null;
    const expected = lineItem.expectedQuantity.value || 0;
    // Total already counted across all pallets except this one
    let countedElsewhere = 0;
    inspection.pallets.forEach((p, idx) => {
      if (idx === palletIndex) return;
      p.batchSections.forEach((bs) => {
        if (normalizeBatchCode(bs.batchCode.value) === normalizedBatch) {
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
      return t(
        'pallet.warnFullUnder60',
        'Full bag pallets must contain exactly 60 bags. Since this pallet has less than 60 bags ({count}), it should be marked as a Partial Bag Pallet.',
        { count: totalActualOnPallet }
      );
    }
    if (pallet.palletType === 'Partial Bag Pallet' && totalActualOnPallet >= 60) {
      return t(
        'pallet.warnPartialOver60',
        'A partial bag pallet should contain less than 60 bags. Since this pallet has 60 or more bags ({count}), it should be marked as a Full Bag Pallet.',
        { count: totalActualOnPallet }
      );
    }
    return null;
  })();

  const returnDuplicateBatchWarning = (() => {
    if (!isReturns || totalActualOnPallet >= 60) return null;
    for (const bs of pallet.batchSections) {
      const batchCode = normalizeBatchCode(bs.batchCode.value);
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
            (obs) => normalizeBatchCode(obs.batchCode.value) === batchCode
          );
          if (hasSameBatch) {
            return t(
              'pallet.warnDuplicateBatch',
              'There is another pallet (Pallet {pallet}) containing batch {batch} that is also under 60 bags ({count} bags). Consider consolidating them.',
              { pallet: otherPallet.palletNumber, batch: batchCode, count: otherPalletTotal }
            );
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
            {t('pallet.headPallet', 'Pallet')} <em>{pallet.palletNumber}</em>
          </h1>
          <div className="page-head__sub">
            {palletTypeLabel(pallet.palletType)}
            {!isReturns && delivery && (
              <>
                {' '}· {t('pallet.headDelivery', 'Delivery')}{' '}
                <span className="mono">{delivery.deliveryNumber}</span>
                {delivery.stopNumber !== undefined && (
                  <> ({t('pallet.headStop', 'Stop {number}', { number: delivery.stopNumber })})</>
                )}
              </>
            )}
          </div>
        </div>
        <div className="page-head__actions">
          {locked && <ViewEditToggle editing={editing} onChange={setEditing} />}
          {!readOnly && (
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
          )}
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => navigate(isFromInvestigation ? '/investigation' : `/inspection/${inspection.id}`)}
          >
            {t('pallet.back', '← Back')}
          </button>
        </div>
      </div>

      {readOnly && (
        <div className="banner banner--info" style={{ marginBottom: 20 }}>
          <span className="banner__icon">👁</span>
          <div className="banner__body">
            {t('pallet.viewBannerPre', 'This inspection is complete and is open in')}{' '}
            <strong>{t('pallet.viewBannerMode', 'view mode')}</strong>
            {t('pallet.viewBannerPost', '. Switch to Edit in the corner to change anything.')}
          </div>
        </div>
      )}

      <fieldset className="readonly-fieldset" disabled={readOnly}>
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

      {/* Pallet type selection */}
      <section className="section">
        <div className="field-row">
          <div className="field">
            <div className="field__label">{t('pallet.typeLabel', 'Pallet type')}</div>
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
                ? PALLET_TYPES.filter(pt => pt !== 'Mixed Bag Pallet' && pt !== 'Minibulk')
                : PALLET_TYPES
              ).map((pt) => (
                <option key={pt} value={pt}>{palletTypeLabel(pt)}</option>
              ))}
            </select>
          </div>
        </div>
      </section>
      </fieldset>

      {/* Photo slots — handled by Semantic Photo Dictionary */}
      <section className="section">
        <DynamicPhotoChecklist 
          palletType={pallet.palletType}
          inspectionId={inspection.id}
          palletIndex={palletIndex}
          isReturns={inspection.type === 'returns'}
          currentUser={inspection.startedBy || 'unknown'}
          photos={pallet.photos}
          batchCount={pallet.batchCount}
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
          onRotatePhoto={(photoId: string) =>
            dispatch({ type: 'ROTATE_PHOTO', photoId })
          }
          readOnly={readOnly}
        />
      </section>

      {/* Batch sections - one per batch on this pallet */}
      <fieldset className="readonly-fieldset" disabled={readOnly}>
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            <em>
              {pallet.batchSections.length === 1
                ? t('pallet.batchDataTitle', 'Batch data')
                : t('pallet.batchSectionsTitle', 'Batch sections')}
            </em>
          </h2>
          {pallet.batchSections.length > 1 && (
            <span className="section__meta">
              {t('pallet.batchesOnPallet', '{count} batches on this pallet', {
                count: pallet.batchSections.length,
              })}
            </span>
          )}
        </div>

        {pallet.batchSections.map((section, sectionIdx) => (
          <BatchSectionRow
            key={section.id}
            section={section}
            sectionNumber={sectionIdx + 1}
            isMultiple={pallet.batchSections.length > 1}
            isReturns={isReturns}
            isOutbound={inspection.type === 'outbound'}
            palletType={pallet.palletType}
            picklistLineItems={inspection.picklist.lineItems}
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
            {isReturns ? (
              t('pallet.damageTitle', 'Damage')
            ) : (
              <em>{t('pallet.orderVerificationTitle', 'Order verification')}</em>
            )}
          </h2>
        </div>
        
        <div className="field-row">
          <div className="field">
            <div className="field__label">
              {isReturns
                ? t(
                    'pallet.qDamaged',
                    '* Was anything damaged (Mouse holes, unfilled Seedpaks/bags, or overly damaged bags/boxes)?'
                  )
                : t(
                    'pallet.qPassInspection',
                    '* Does the Bag Pallet pass inspection with no findings? (No damage, all info matches, all labels applied)'
                  )}
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
                {isReturns ? t('pallet.no', 'No') : t('pallet.pass', 'Pass')}
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
                {isReturns ? t('pallet.yes', 'Yes') : t('pallet.fail', 'Fail')}
              </button>
            </div>
          </div>
          
          {inspection.type !== 'returns' && pallet.passInspection === 'Fail' && (
            <div className="field">
              <div className="field__label">{t('pallet.lpnLabel', '* What is the LPN number?')}</div>
              <AlphanumericInput
                value={pallet.lpnNumber || ''}
                onValueChange={(value) =>
                  dispatch({
                    type: 'UPDATE_PALLET',
                    index: palletIndex,
                    patch: { lpnNumber: value },
                  })
                }
                placeholder={t('pallet.lpnPlaceholder', 'Enter LPN number...')}
                className="mono"
                aria-label={t('pallet.lpnLabel', 'What is the LPN number?')}
              />
            </div>
          )}

          {inspection.type !== 'returns' && (
            <div className="field">
              <div className="field__label">
                {t('pallet.accuracyLabel', '* Is there an accuracy verification label attached?')}
              </div>
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
                    {v === 'Yes'
                      ? t('pallet.yes', 'Yes')
                      : v === 'No'
                      ? t('pallet.no', 'No')
                      : t('pallet.na', 'N/A')}
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
                 <div className="field__label">{t('pallet.photographDamage', '* Photograph the damage')}</div>
                 <div className="photo-slot-grid">
                   <SlotPhotoCapture
                      inspectionId={inspection.id}
                      category="Returns_Damage_Assessment"
                      slotKey="RETURNS_DAMAGE"
                      slotLabel={t('pallet.damagePhotoSlot', 'Damage Photo')}
                      palletIndex={palletIndex}
                      existingPhoto={pallet.photos.find((p: any) => p.slotKey === 'RETURNS_DAMAGE')}
                      currentUser={inspection.startedBy || 'unknown'}
                      onCaptured={(photo: any) => dispatch({ type: 'REPLACE_PALLET_PHOTO', palletIndex, slotKey: 'RETURNS_DAMAGE', photo })}
                      onQualityFlag={(photoId: string, flag: any) => dispatch({ type: 'SET_PHOTO_QUALITY_FLAG', photoId, flag })}
                      readOnly={readOnly}
                   />
                 </div>
              </div>
            )}
            <div className="field">
              <div className="field__label">
                {t('pallet.selectFindings', '* Select all {type} findings', {
                  type: palletTypeLabel(pallet.palletType),
                })}
              </div>
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
                      {findingLabel(opt)}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="field">
              <div className="field__label">
                {t('pallet.rejectedBagsLabel', 'Rejected Bags (how many bags are rejected)')}
              </div>
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
              <div className="field__label">
                {t('pallet.rejectionNotesLabel', 'Notes / Reasoning for rejection')}
              </div>
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
                placeholder={t(
                  'pallet.rejectionNotesPlaceholder',
                  'Describe why these bags were rejected (e.g. forklift damage, mouse holes, water damage)...'
                )}
              />
            </div>
          </div>
        )}
      </section>

      <div className="card" style={{ background: 'var(--surface-tint)', marginTop: 16 }}>
        <div className="row-between">
          <div>
            <div className="xs soft" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {t('pallet.totalOnPallet', 'Total on this pallet')}
            </div>
            <div className="fw-500" style={{ fontSize: 24 }}>
              {formatUomCount(totalDisplayOnPallet, palletUom, pallet.palletType, t)}
            </div>
          </div>
        </div>
      </div>
      </fieldset>

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
          {readOnly ? (
            <>
              <span />
              <button
                className="btn btn--accent btn--lg"
                onClick={() =>
                  navigate(isFromInvestigation ? '/investigation' : `/inspection/${inspection.id}`)
                }
              >
                {isFromInvestigation
                  ? t('pallet.backToInvestigation', '← Back to investigation')
                  : t('pallet.backToLoad', '← Back to load')}
              </button>
            </>
          ) : (
            <>
              <button className="btn btn--danger btn--ghost" onClick={removePallet}>
                {t('pallet.removePallet', 'Remove pallet')}
              </button>
              <button
                className="btn btn--accent btn--lg"
                onClick={handleAdd}
              >
                {t('pallet.addToLoad', '✓ Add to load')}
              </button>
            </>
          )}
        </div>
      </div>

      {showConfirmRemove && (
        <ConfirmModal
          title={t('pallet.confirmRemoveTitle', 'Remove this pallet?')}
          message={t('pallet.confirmRemove', 'Remove this pallet? Photos and data will be lost.')}
          confirmLabel={t('pallet.removePallet', 'Remove pallet')}
          danger
          onConfirm={confirmRemovePallet}
          onCancel={() => setShowConfirmRemove(false)}
        />
      )}
    </main>
  );
}

function BatchSectionRow({
  section,
  sectionNumber,
  isMultiple,
  isReturns,
  isOutbound,
  palletType,
  picklistLineItems,
  remainingAvailable,
  onUpdate,
}: {
  section: BatchSection;
  sectionNumber: number;
  isMultiple: boolean;
  isReturns: boolean;
  isOutbound: boolean;
  palletType: PalletType;
  picklistLineItems: Inspection['picklist']['lineItems'];
  remainingAvailable: number | null;
  onUpdate: (patch: Partial<BatchSection>) => void;
}) {
  const t = useT();
  const actual = section.actualBagCount.value;
  const expected = section.expectedBagCount;
  const mismatch = expected > 0 && actual !== null && actual !== expected;

  const isUnlistedOnPicklist = useMemo(() => {
    if (!isOutbound || isReturns) return false;
    return isBatchNotOnOriginalPicklist(picklistLineItems, section.batchCode.value);
  }, [picklistLineItems, section.batchCode.value, isOutbound, isReturns]);

  const sectionUom = useMemo(() => {
    if (!section.batchCode.value) return undefined;
    const code = normalizeBatchCode(section.batchCode.value);
    const li = picklistLineItems.find(
      (item) => normalizeBatchCode(item.batchCode.value) === code
    );
    return li?.uom;
  }, [picklistLineItems, section.batchCode.value]);

  const isBagProduct =
    palletType !== 'Seedpak' &&
    palletType !== 'Minibulk' &&
    sectionUom !== 'SP' &&
    sectionUom !== 'MB';

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        {isMultiple ? (
          <div
            className="xs soft fw-500"
            style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}
          >
            {t('pallet.batchNumber', 'Batch {number}', { number: sectionNumber })}
          </div>
        ) : <span />}
        {isUnlistedOnPicklist && (
          <span className="pill pill--danger" style={{ fontSize: 11 }}>
            ⚠ {t('pallet.notOnPicklist', 'Not on Picklist')}
          </span>
        )}
      </div>
      <div className="field-row">
        <SuggestableField
          label={t('pallet.batchCodeLabel', 'Batch code')}
          field={section.batchCode}
          mono
          uppercase
          hideCamera={true}
          placeholder="P18GY43M8"
          onChange={(field) => onUpdate({ batchCode: field })}
        />
        <SuggestableField
          label={t('pallet.actualCount', 'Actual count')}
          field={section.actualBagCount}
          type="number"
          hideCamera={true}
          placeholder={remainingAvailable !== null ? String(remainingAvailable) : '0'}
          onChange={(field) => onUpdate({ actualBagCount: field })}
        />
      </div>

      {isBagProduct && <LayerCountHelper section={section} onUpdate={onUpdate} />}

      {isUnlistedOnPicklist && (
        <div className="banner banner--danger" style={{ marginTop: 8, marginBottom: 0 }}>
          <span className="banner__icon">⚠</span>
          <div className="banner__body">
            {t(
              'pallet.unlistedBatchWarn',
              'Warning: Batch "{code}" was not on the original picklist. A verifier may add it, but it will remain flagged for final review.',
              { code: section.batchCode.value || '' }
            )}
          </div>
        </div>
      )}

      {remainingAvailable !== null && remainingAvailable > 0 && (
        <div className="small soft mt-8">
          {t(
            'pallet.remainingOnPicklist',
            '{count} bags remaining on picklist for this batch (already scanned on other pallets)',
            { count: remainingAvailable }
          )}
        </div>
      )}

      {mismatch && (
        <div className="banner banner--warn" style={{ marginTop: 8, marginBottom: 0 }}>
          <span className="banner__icon">⚠</span>
          <div className="banner__body">
            {t('pallet.mismatchPre', 'Count mismatch: expected')} <strong>{expected}</strong>
            {t('pallet.mismatchMid', ', you entered')} <strong>{actual}</strong>
            {actual !== null && expected !== 0 && (
              <>
                {' '}
                ({t('pallet.mismatchDiff', 'difference {diff}', {
                  diff: `${actual - expected > 0 ? '+' : ''}${actual - expected}`,
                })})
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Layer-geometry counter. Standard palletization = bagsPerLayer × layerCount + partial,
// which is more reliable than eyeballing sagging bags. The verifier enters the
// three numbers (layers are easy to see from the side) and applies the product to
// the actual bag count. Inputs persist on the section so the math is auditable.
function LayerCountHelper({
  section,
  onUpdate,
}: {
  section: BatchSection;
  onUpdate: (patch: Partial<BatchSection>) => void;
}) {
  const t = useT();
  const perLayer = section.bagsPerLayer;
  const layers = section.layerCount;
  const partial = section.partialLayerBags;
  const fullStackBags =
    typeof perLayer === 'number' && perLayer > 0 && typeof layers === 'number' && layers > 0
      ? perLayer * layers
      : null;
  const computed =
    fullStackBags !== null
      ? fullStackBags + (typeof partial === 'number' && partial > 0 ? partial : 0)
      : null;
  const alreadyApplied = computed !== null && section.actualBagCount.value === computed;

  const parse = (raw: string): number | undefined => {
    if (raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  return (
    <div
      className="mt-8"
      style={{ borderTop: '1px dashed var(--rule-soft)', paddingTop: 8 }}
    >
      <div
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 8 }}
      >
        <div className="field" style={{ margin: 0, minWidth: 110, flex: '1 1 110px' }}>
          <div className="field__label">{t('pallet.fullLayer', 'Full layer')}</div>
          <input
            type="number"
            inputMode="numeric"
            value={perLayer ?? ''}
            placeholder={t('pallet.fullLayerHint', 'bags per layer')}
            onChange={(e) => onUpdate({ bagsPerLayer: parse(e.target.value) })}
          />
        </div>
        <div style={{ alignSelf: 'center', paddingBottom: 8, color: 'var(--ink-faint)' }}>×</div>
        <div className="field" style={{ margin: 0, minWidth: 90, flex: '1 1 90px' }}>
          <div className="field__label">{t('pallet.fullStack', 'Full stack')}</div>
          <input
            type="number"
            inputMode="numeric"
            value={layers ?? ''}
            placeholder={t('pallet.fullStackHint', 'full layers')}
            onChange={(e) => onUpdate({ layerCount: parse(e.target.value) })}
          />
        </div>
        <div style={{ alignSelf: 'center', paddingBottom: 8, color: 'var(--ink-faint)' }}>+</div>
        <div className="field" style={{ margin: 0, minWidth: 90, flex: '1 1 90px' }}>
          <div className="field__label">{t('pallet.partial', 'Partial')}</div>
          <input
            type="number"
            inputMode="numeric"
            value={partial ?? ''}
            placeholder={t('pallet.partialHint', 'top bags')}
            onChange={(e) => onUpdate({ partialLayerBags: parse(e.target.value) })}
          />
        </div>
        <div style={{ alignSelf: 'center', paddingBottom: 8, whiteSpace: 'nowrap' }}>
          = <strong>{computed ?? '—'}</strong> {t('pallet.bagsUnit', 'bags')}
        </div>
        <button
          type="button"
          className="btn btn--sm"
          disabled={computed === null || alreadyApplied}
          onClick={() =>
            computed !== null &&
            onUpdate({ actualBagCount: { ...section.actualBagCount, value: computed, source: 'manual' } })
          }
          style={{ marginBottom: 2 }}
        >
          {alreadyApplied
            ? t('pallet.layerApplied', '✓ Applied')
            : t('pallet.layerApply', 'Use as actual count')}
        </button>
      </div>
    </div>
  );
}
