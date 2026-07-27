import { generateId, emptySuggestable, PICKLIST_UOM_OPTIONS, parsePackInfo } from '../shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { dbGetInspection } from '../shared';
import { useInspection } from '../shared';
import type { Inspection, Suggestable, PicklistLineItemEntry, Delivery } from '../shared';
import { SuggestableField } from '../shared';
import { StepBackLink } from '../shared';
import { useT } from '../shared/i18n/LanguageContext';

export function VerifyRoute() {
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

  return <VerifyInner initial={loaded} onVerified={() => navigate(`/inspection/${id}`)} />;
}

function VerifyInner({
  initial,
  onVerified,
}: {
  initial: Inspection;
  onVerified: () => void;
}) {
  const { inspection, dispatch } = useInspection(initial);
  const t = useT();

  const confirm = () => {
    dispatch({ type: 'VERIFY_PICKLIST', verifiedBy: inspection.startedBy || 'unknown' });
    onVerified();
  };


  const addDelivery = () => {
    dispatch({
      type: 'ADD_DELIVERY',
      delivery: {
        id: generateId(),
        deliveryNumber: '',
        stopNumber: inspection.bol.deliveries.length + 1,
        lineItemIds: [],
      },
    });
  };

  const removeDelivery = (deliveryId: string) => {
    if (
      !window.confirm(
        t(
          'verify.removeDeliveryConfirm',
          'Remove this delivery? Any line items assigned to it will need reassignment.'
        )
      )
    )
      return;
    dispatch({ type: 'REMOVE_DELIVERY', id: deliveryId });
  };

  // Cross-reference: load numbers should match between picklist and BOL
  const picklistLoad = inspection.picklist.loadNumber.value;
  const bolLoad = inspection.bol.loadNumber.value;
  const loadMismatch = picklistLoad && bolLoad && picklistLoad !== bolLoad;
  const sharedLoadNumber = bolLoad || picklistLoad;

  const canConfirm =
    Boolean(sharedLoadNumber) &&
    inspection.bol.deliveries.length > 0;

  return (
    <main>
      <StepBackLink to={`/inspection/${inspection.id}/capture-picklist`} />

      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            {t('verify.titleLead', 'Verify')} <em>{t('verify.titleEm', 'load data')}</em>
          </h1>
          <div className="page-head__sub">
            {t('verify.subtitle', 'Step 4 of 4 · Confirm data and reconcile picklist vs BOL')}
          </div>
        </div>
      </div>

      <div className="banner banner--warn">
        <span className="banner__icon">⚠</span>
        <div className="banner__body">
          {t('verify.warnLead', 'Verify each row carefully.')}{' '}
          <strong>{t('verify.warnStrong', 'Mistakes here affect the whole inspection.')}</strong>{' '}
          {t('verify.warnTail', 'Bag counts and batch codes drive every per-pallet check.')}
        </div>
      </div>

      {loadMismatch && (
        <div className="banner banner--danger">
          <span className="banner__icon">✕</span>
          <div className="banner__body">
            <strong>{t('verify.loadMismatchTitle', 'Load # mismatch.')}</strong>{' '}
            {t('verify.loadMismatchPicklist', 'Picklist says')}{' '}
            <span className="mono">{picklistLoad}</span>,{' '}
            {t('verify.loadMismatchBol', 'BOL says')} <span className="mono">{bolLoad}</span>.{' '}
            {t('verify.loadMismatchTail', 'These should be the same — pick the correct one.')}
          </div>
        </div>
      )}

      {/* ===== Load header ===== */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            {t('verify.loadHeaderLead', 'Load')} <em>{t('verify.loadHeaderEm', 'header')}</em>
          </h2>
        </div>
        <div className="field-row">
          <SuggestableField
            label={t('verify.loadNumberLabel', 'Load # (matches BOL #)')}
            field={inspection.picklist.loadNumber}
            mono
            placeholder="835"
            hideCamera={true}
            onChange={(field) => {
              dispatch({ type: 'SET_PICKLIST', patch: { loadNumber: field } });
              // Mirror to BOL since they're the same number
              dispatch({ type: 'SET_BOL', patch: { loadNumber: field } });
            }}
          />
          <ShipDateField
            field={inspection.picklist.shipDate}
            onChange={(field) => {
              dispatch({ type: 'SET_PICKLIST', patch: { shipDate: field } });
              dispatch({ type: 'SET_BOL', patch: { shipDate: field } });
            }}
          />
        </div>
      </section>

      {/* ===== Picklist line items ===== */}
      <PicklistLineItems
        lineItems={inspection.picklist.lineItems}
        deliveries={inspection.bol.deliveries}
        onAdd={() =>
          dispatch({
            type: 'ADD_PICKLIST_LINE',
            line: {
              id: generateId(),
              batchCode: emptySuggestable<string>(),
              sku: emptySuggestable<string>(),
              description: emptySuggestable<string>(),
              expectedQuantity: emptySuggestable<number>(),
              uom: 'BG',
              actualQuantity: 0,
              fulfilled: false,
            },
          })
        }
        onUpdate={(index, patch) =>
          dispatch({ type: 'UPDATE_PICKLIST_LINE', index, patch })
        }
        onRemove={(index) => dispatch({ type: 'REMOVE_PICKLIST_LINE', index })}
      />

      {/* ===== Deliveries ===== */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            {t('verify.deliveries', 'Deliveries')} <em>({inspection.bol.deliveries.length})</em>
          </h2>
          <button className="btn btn--sm" onClick={addDelivery}>
            {t('verify.addDelivery', '+ Add delivery')}
          </button>
        </div>

        <div className="banner banner--info">
          <span className="banner__icon">i</span>
          <div className="banner__body">
            {inspection.type === 'returns'
              ? t(
                  'verify.deliveriesHintReturns',
                  'One Load can have multiple Delivery #s. Each line item below is assigned to a specific delivery.'
                )
              : t(
                  'verify.deliveriesHint',
                  'One Load can have multiple Delivery #s (for one or many stops). Each line item below is assigned to a specific delivery.'
                )}
          </div>
        </div>

        {inspection.bol.deliveries.length === 0 ? (
          <div className="empty">
            <div className="empty__title">{t('verify.noDeliveries', 'No deliveries yet')}</div>
            <div className="empty__sub">
              {t('verify.noDeliveriesHint', 'Tap "+ Add delivery" to enter at least one.')}
            </div>
          </div>
        ) : (
          <div className="delivery-list">
            {inspection.bol.deliveries.map((d) => (
              <div key={d.id} className="card">
                <div className="field-row">
                  <div className="field">
                    <div className="field__label">{t('verify.deliveryNumber', 'Delivery #')}</div>
                    <input
                      className="mono"
                      value={d.deliveryNumber}
                      onChange={(e) =>
                        dispatch({
                          type: 'UPDATE_DELIVERY',
                          id: d.id,
                          patch: { deliveryNumber: e.target.value },
                        })
                      }
                      placeholder="810..."
                    />
                  </div>
                  {inspection.type !== 'returns' && (
                    <div className="field">
                      <div className="field__label">{t('verify.stopNumber', 'Stop #')}</div>
                      <input
                        type="number"
                        value={d.stopNumber ?? ''}
                        onChange={(e) =>
                          dispatch({
                            type: 'UPDATE_DELIVERY',
                            id: d.id,
                            patch: {
                              stopNumber: e.target.value === '' ? undefined : Number(e.target.value),
                            },
                          })
                        }
                        placeholder="1"
                      />
                    </div>
                  )}
                  <div className="field" style={{ alignSelf: 'flex-end' }}>
                    <button className="btn btn--sm btn--ghost" onClick={() => removeDelivery(d.id)}>
                      {t('verify.removeDelivery', 'Remove delivery')}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ===== Verification Questions ===== */}
      {inspection.type !== 'returns' && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">
              {t('verify.orderVerificationLead', 'Order')}{' '}
              <em>{t('verify.orderVerificationEm', 'Verification')}</em>
            </h2>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 16, fontWeight: 500 }}>
              {t('verify.multiStopQuestion', '* Is this a multi-stop load?')}
            </div>
            <div className="row-start gap-8">
              <button
                className={`btn btn--lg flex-1 ${inspection.bol.isMultiStopLoad === 'Yes' ? 'btn--accent' : 'btn--ghost'}`}
                style={inspection.bol.isMultiStopLoad === 'Yes' ? { backgroundColor: 'var(--success)', color: 'white' } : {}}
                onClick={() => dispatch({ type: 'SET_BOL', patch: { isMultiStopLoad: 'Yes' } })}
              >
                {t('verify.yes', 'Yes')}
              </button>
              <button
                className={`btn btn--lg flex-1 ${inspection.bol.isMultiStopLoad === 'No' ? 'btn--accent' : 'btn--ghost'}`}
                style={inspection.bol.isMultiStopLoad === 'No' ? { backgroundColor: 'var(--danger)', color: 'white' } : {}}
                onClick={() => dispatch({ type: 'SET_BOL', patch: { isMultiStopLoad: 'No' } })}
              >
                {t('verify.no', 'No')}
              </button>
            </div>
          </div>

          <div className="card">
            <div style={{ marginBottom: 16, fontWeight: 500 }}>
              {t('verify.placardQuestion', '* Does the placard info match the initial BOL?')}
            </div>
            <div className="row-start gap-8">
              <button
                className={`btn btn--lg flex-1 ${inspection.bol.placardMatchesBol === 'Yes' ? 'btn--accent' : 'btn--ghost'}`}
                style={inspection.bol.placardMatchesBol === 'Yes' ? { backgroundColor: 'var(--success)', color: 'white' } : {}}
                onClick={() => dispatch({ type: 'SET_BOL', patch: { placardMatchesBol: 'Yes' } })}
              >
                {t('verify.yes', 'Yes')}
              </button>
              <button
                className={`btn btn--lg flex-1 ${inspection.bol.placardMatchesBol === 'No' ? 'btn--accent' : 'btn--ghost'}`}
                style={inspection.bol.placardMatchesBol === 'No' ? { backgroundColor: 'var(--danger)', color: 'white' } : {}}
                onClick={() => dispatch({ type: 'SET_BOL', patch: { placardMatchesBol: 'No' } })}
              >
                {t('verify.no', 'No')}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Back lives in StepBackLink at the top of the page now — it targets the
          previous step explicitly rather than whatever history happens to hold. */}
      <div className="flex gap-8" style={{ justifyContent: 'flex-end', marginTop: 24 }}>
        <button className="btn btn--accent btn--lg" onClick={confirm} disabled={!canConfirm}>
          {t('verify.confirmStart', '✓ Confirm & start scanning')}
        </button>
      </div>
    </main>
  );
}

function PicklistLineItems({
  lineItems,
  deliveries,
  onAdd,
  onUpdate,
  onRemove,
}: {
  lineItems: PicklistLineItemEntry[];
  deliveries: Delivery[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<PicklistLineItemEntry>) => void;
  onRemove: (index: number) => void;
}) {
  const t = useT();
  const totalExpected = lineItems.reduce(
    (sum, li) => sum + (li.expectedQuantity.value || 0),
    0
  );

  return (
    <section className="section">
      <div className="section__head">
        <h2 className="section__title">
          {t('verify.picklistLead', 'Picklist')}{' '}
          <em>{t('verify.picklistEm', 'line items ({count})', { count: lineItems.length })}</em>
        </h2>
        <button className="btn btn--sm" onClick={onAdd}>
          {t('verify.addLine', '+ Add line')}
        </button>
      </div>

      <div className="banner banner--info">
        <span className="banner__icon">i</span>
        <div className="banner__body">
          {t(
            'verify.lineItemsHint',
            'Enter each batch code and the quantity the picklist calls for. These expected counts drive the per-pallet reconciliation and the "remaining to pick" tally.'
          )}
        </div>
      </div>

      {lineItems.length === 0 ? (
        <div className="empty">
          <div className="empty__title">{t('verify.noLineItems', 'No line items yet')}</div>
          <div className="empty__sub">
            {t('verify.noLineItemsHint', 'Tap "+ Add line" to enter the picklist quantities.')}
          </div>
        </div>
      ) : (
        <div className="delivery-list">
          {lineItems.map((li, index) => (
            <div key={li.id} className="card">
              <div className="field-row">
                <SuggestableField
                  label={t('verify.batchCode', 'Batch code')}
                  field={li.batchCode}
                  mono
                  uppercase
                  placeholder="H18MYD9JX"
                  onChange={(field) => onUpdate(index, { batchCode: field })}
                />
                <SuggestableField
                  label={t('verify.sku', 'SKU / Material')}
                  field={li.sku}
                  mono
                  hideCamera
                  placeholder="91007244"
                  onChange={(field) => onUpdate(index, { sku: field })}
                />
              </div>
              <div className="field-row">
                <SuggestableField
                  label={t('verify.description', 'Material description')}
                  field={li.description}
                  hideCamera
                  placeholder={t('verify.descriptionPlaceholder', 'Material description')}
                  onChange={(field) => onUpdate(index, { description: field })}
                />
              </div>
              <div className="field-row">
                <SuggestableField
                  label={t('verify.expectedQty', 'Expected qty')}
                  field={li.expectedQuantity}
                  type="number"
                  hideCamera
                  placeholder="0"
                  onChange={(field) => onUpdate(index, { expectedQuantity: field })}
                />
                <div className="field">
                  <div className="field__label">{t('verify.unit', 'Unit')}</div>
                  <select
                    value={li.uom}
                    onChange={(e) =>
                      onUpdate(index, {
                        uom: e.target.value as PicklistLineItemEntry['uom'],
                      })
                    }
                  >
                    {/* Legacy codes (BAG/PCE) only appear if an old record still
                        carries one, so it stays visible instead of resetting. */}
                    {(PICKLIST_UOM_OPTIONS.includes(li.uom)
                      ? PICKLIST_UOM_OPTIONS
                      : [li.uom, ...PICKLIST_UOM_OPTIONS]
                    ).map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                  {(() => {
                    if (li.uom !== 'SP' && li.uom !== 'MB') return null;
                    const pack = parsePackInfo(li.description.value);
                    if (!pack) return null;
                    return (
                      <div className="small soft" style={{ marginTop: 4 }}>
                        {pack.kind === 'MB'
                          ? t('verify.mbSize', 'Minibulk · {ssu}', { ssu: pack.ssu })
                          : t('verify.spSize', 'SeedPak · {ssu}', { ssu: pack.ssu })}
                      </div>
                    );
                  })()}
                </div>
                {/* Which delivery this product is picked for. Read off the
                    picklist's delivery heading — shown here so the inspector
                    confirms (or corrects) the placement before scanning. */}
                {deliveries.length > 1 && (
                  <div className="field">
                    <div className="field__label">{t('verify.lineDelivery', 'Delivery')}</div>
                    <select
                      value={li.deliveryId ?? ''}
                      onChange={(e) =>
                        onUpdate(index, { deliveryId: e.target.value || undefined })
                      }
                    >
                      <option value="">{t('verify.lineDeliveryNone', 'Unassigned')}</option>
                      {deliveries.map((d, i) => (
                        <option key={d.id} value={d.id}>
                          {d.deliveryNumber ||
                            t('verify.lineDeliveryFallback', 'Delivery {n}', { n: i + 1 })}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="field" style={{ alignSelf: 'flex-end' }}>
                  <button
                    className="btn btn--sm btn--ghost"
                    onClick={() => onRemove(index)}
                  >
                    {t('verify.removeLine', 'Remove line')}
                  </button>
                </div>
              </div>
            </div>
          ))}

          <div className="small soft" style={{ textAlign: 'right', marginTop: 8 }}>
            {t('verify.totalExpectedLabel', 'Total expected:')} <strong>{totalExpected}</strong>{' '}
            {lineItems.length === 1
              ? t('verify.acrossLine', 'across {count} line', { count: lineItems.length })
              : t('verify.acrossLines', 'across {count} lines', { count: lineItems.length })}
          </div>
        </div>
      )}
    </section>
  );
}

function ShipDateField({
  field,
  onChange,
}: {
  field: Suggestable<string>;
  onChange: (next: Suggestable<string>) => void;
}) {
  const t = useT();
  // Use HTML5 date picker - works well on iPad (native picker UI)
  return (
    <div className="field">
      <div className="field__label">{t('verify.shipDate', 'Ship date')}</div>
      <input
        type="date"
        value={field.value || ''}
        onChange={(e) =>
          onChange({
            ...field,
            value: e.target.value || null,
            source: 'manual',
          })
        }
      />
    </div>
  );
}


