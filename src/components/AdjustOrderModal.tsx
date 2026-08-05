import { useState } from 'react';
import type { Inspection, PicklistLineItemEntry } from '../shared';
import { generateId, expectedBags } from '../shared';
import { useT } from '../shared/i18n/LanguageContext';

interface Props {
  inspection: Inspection;
  onClose: () => void;
  onAdjustLine: (index: number, patch: Partial<PicklistLineItemEntry>, reason?: string) => void;
  onAddLine: (line: PicklistLineItemEntry) => void;
}

interface LineState {
  batchCode: string;
  expectedQuantity: number;
  cancelled: boolean;
  reason: string;
  isModified: boolean;
}

export function AdjustOrderModal({ inspection, onClose, onAdjustLine, onAddLine }: Props) {
  const t = useT();
  const inspectorName =
    inspection.currentInspector || inspection.startedBy || 'unknown';

  const [linesState, setLinesState] = useState<LineState[]>(() =>
    inspection.picklist.lineItems.map((li) => ({
      batchCode: li.batchCode.value || '',
      expectedQuantity: li.expectedQuantity.value || 0,
      cancelled: Boolean(li.cancelled),
      reason: li.adjustmentReason || '',
      isModified: false,
    }))
  );

  const [globalReason, setGlobalReason] = useState('');

  // Form for adding a new line
  const [showAddForm, setShowAddForm] = useState(false);
  const [newBatchCode, setNewBatchCode] = useState('');
  const [newSku, setNewSku] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newQuantity, setNewQuantity] = useState<number | ''>('');

  const handleLineChange = (
    index: number,
    field: 'batchCode' | 'expectedQuantity' | 'cancelled' | 'reason',
    value: any
  ) => {
    setLinesState((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const updated = { ...item, [field]: value, isModified: true };
        return updated;
      })
    );
  };

  const handleSaveAll = () => {
    linesState.forEach((st, i) => {
      const orig = inspection.picklist.lineItems[i];
      if (!orig) return;

      const batchChanged = st.batchCode.trim().toUpperCase() !== (orig.batchCode.value || '').trim().toUpperCase();
      const qtyChanged = st.expectedQuantity !== (orig.expectedQuantity.value || 0);
      const cancelChanged = st.cancelled !== Boolean(orig.cancelled);

      if (batchChanged || qtyChanged || cancelChanged || st.isModified) {
        const patch: Partial<PicklistLineItemEntry> = {};
        if (batchChanged) {
          patch.batchCode = {
            ...orig.batchCode,
            value: st.batchCode.trim().toUpperCase(),
            source: 'manual',
          };
        }
        if (qtyChanged) {
          patch.expectedQuantity = {
            ...orig.expectedQuantity,
            value: st.expectedQuantity,
            source: 'manual',
          };
        }
        if (cancelChanged) {
          patch.cancelled = st.cancelled;
        }

        const reason = st.reason.trim() || globalReason.trim() || undefined;
        onAdjustLine(i, patch, reason);
      }
    });

    onClose();
  };

  const handleAddNewLine = () => {
    if (!newBatchCode.trim() || !newQuantity) return;
    const newLine: PicklistLineItemEntry = {
      id: generateId(),
      batchCode: { value: newBatchCode.trim().toUpperCase(), source: 'manual' },
      sku: { value: newSku.trim() || null, source: 'manual' },
      description: { value: newDescription.trim() || null, source: 'manual' },
      expectedQuantity: { value: Number(newQuantity), source: 'manual' },
      uom: 'BG',
      actualQuantity: 0,
      fulfilled: false,
      adjustedAt: new Date().toISOString(),
      adjustedBy: inspectorName,
      adjustmentReason: globalReason.trim() || t('adjust.newLineReason', 'New line added to order'),
    };
    onAddLine(newLine);
    setNewBatchCode('');
    setNewSku('');
    setNewDescription('');
    setNewQuantity('');
    setShowAddForm(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 800, width: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="modal__head">
          <h2 className="modal__title">
            {t('adjust.titleLead', 'Adjust')} <em>{t('adjust.titleEm', 'Order / Picklist')}</em>
          </h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal__body" style={{ overflowY: 'auto', flex: 1, padding: 16 }}>
          <div className="banner banner--info" style={{ marginBottom: 16 }}>
            <span className="banner__icon">ℹ</span>
            <div className="banner__body">
              {t(
                'adjust.bannerInfo',
                'Use this form to handle batch swaps, quantity reductions, or cancelled lines mid-inspection. All adjustments are logged with your inspector name.'
              )}
            </div>
          </div>

          <div className="field" style={{ marginBottom: 20 }}>
            <label className="field__label">{t('adjust.globalReasonLabel', 'Reason for adjustment (optional)')}</label>
            <input
              type="text"
              placeholder={t('adjust.globalReasonPlaceholder', 'e.g. Batch H18 depleted in aisle 4, swapped for H22')}
              value={globalReason}
              onChange={(e) => setGlobalReason(e.target.value)}
            />
          </div>

          <h3 className="section__title" style={{ fontSize: 16, marginBottom: 12 }}>
            {t('adjust.currentLines', 'Current Picklist Lines')}
          </h3>

          <div className="stack" style={{ gap: 12 }}>
            {inspection.picklist.lineItems.map((li, i) => {
              const st = linesState[i];
              if (!st) return null;
              const expectedBagsCount = expectedBags(li.uom, st.expectedQuantity, li.description.value);

              return (
                <div
                  key={li.id || i}
                  className="card"
                  style={{
                    padding: 14,
                    opacity: st.cancelled ? 0.5 : 1,
                    backgroundColor: st.cancelled ? 'var(--bg-subtle)' : undefined,
                    border: st.cancelled ? '1px dashed var(--rule)' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <span className="fw-600 mono" style={{ fontSize: 15 }}>
                        {li.sku.value ? `SKU ${li.sku.value}` : t('adjust.lineItemNum', 'Line #{n}', { n: i + 1 })}
                      </span>
                      {li.description.value && (
                        <div className="small soft" style={{ marginTop: 2 }}>
                          {li.description.value}
                        </div>
                      )}
                      {(li.originalBatchCode || li.originalExpectedQuantity !== undefined) && (
                        <div className="xs badge badge--warn" style={{ marginTop: 4 }}>
                          {t('adjust.previouslyAdjusted', 'Previously adjusted')}
                          {li.originalBatchCode && ` (was: ${li.originalBatchCode})`}
                          {li.originalExpectedQuantity !== undefined && ` (was: ${li.originalExpectedQuantity} ${li.uom})`}
                        </div>
                      )}
                    </div>

                    <button
                      className={`btn btn--sm ${st.cancelled ? 'btn--ghost' : 'btn--danger'}`}
                      onClick={() => handleLineChange(i, 'cancelled', !st.cancelled)}
                      type="button"
                    >
                      {st.cancelled ? t('adjust.uncancelLine', 'Reactivate line') : t('adjust.cancelLine', 'Cancel line')}
                    </button>
                  </div>

                  {!st.cancelled && (
                    <div className="field-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                      <div className="field">
                        <label className="field__label">{t('adjust.batchCode', 'Batch Code')}</label>
                        <input
                          type="text"
                          className="mono"
                          value={st.batchCode}
                          onChange={(e) => handleLineChange(i, 'batchCode', e.target.value)}
                        />
                      </div>

                      <div className="field">
                        <label className="field__label">{t('adjust.expectedQty', 'Expected Qty ({uom})', { uom: li.uom })}</label>
                        <input
                          type="number"
                          min="0"
                          value={st.expectedQuantity}
                          onChange={(e) => handleLineChange(i, 'expectedQuantity', Math.max(0, Number(e.target.value)))}
                        />
                      </div>

                      <div className="field" style={{ justifyContent: 'center' }}>
                        <label className="field__label">{t('adjust.bagsTally', 'Bag Equivalent')}</label>
                        <div className="mono fw-600" style={{ fontSize: 16, paddingTop: 6 }}>
                          {expectedBagsCount} {t('adjust.bags', 'bags')}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add Line Form */}
          {showAddForm ? (
            <div className="card" style={{ padding: 14, marginTop: 16, border: '1px solid var(--accent)' }}>
              <h4 className="fw-600" style={{ marginBottom: 12 }}>{t('adjust.addNewLineTitle', 'Add New Batch Line')}</h4>
              <div className="field-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div className="field">
                  <label className="field__label">{t('adjust.batchCode', 'Batch Code')} *</label>
                  <input
                    type="text"
                    className="mono"
                    placeholder="e.g. H22XYZ456"
                    value={newBatchCode}
                    onChange={(e) => setNewBatchCode(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="field__label">{t('adjust.qtyBags', 'Quantity (bags)')} *</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="e.g. 50"
                    value={newQuantity}
                    onChange={(e) => setNewQuantity(e.target.value ? Number(e.target.value) : '')}
                  />
                </div>
              </div>
              <div className="field-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div className="field">
                  <label className="field__label">{t('adjust.skuOptional', 'SKU / Material # (optional)')}</label>
                  <input
                    type="text"
                    className="mono"
                    placeholder="e.g. 91879675"
                    value={newSku}
                    onChange={(e) => setNewSku(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="field__label">{t('adjust.descOptional', 'Description (optional)')}</label>
                  <input
                    type="text"
                    placeholder="e.g. C.DK.DKC099..."
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn--ghost btn--sm" onClick={() => setShowAddForm(false)}>
                  {t('adjust.cancel', 'Cancel')}
                </button>
                <button className="btn btn--sm" onClick={handleAddNewLine} disabled={!newBatchCode.trim() || !newQuantity}>
                  {t('adjust.addLineBtn', 'Add Line')}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn btn--ghost btn--sm"
              style={{ marginTop: 16, width: '100%' }}
              onClick={() => setShowAddForm(true)}
            >
              + {t('adjust.addNewLine', 'Add new batch / product line')}
            </button>
          )}
        </div>

        <div className="modal__foot" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: 16, borderTop: '1px solid var(--rule-soft)' }}>
          <button className="btn btn--ghost" onClick={onClose}>
            {t('adjust.cancel', 'Cancel')}
          </button>
          <button className="btn" onClick={handleSaveAll}>
            {t('adjust.saveAdjustments', 'Save adjustments')}
          </button>
        </div>
      </div>
    </div>
  );
}
