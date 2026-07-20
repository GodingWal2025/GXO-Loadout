import { generateId } from '../shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { dbGetInspection } from '../shared';
import { useInspection } from '../shared';
import type { Inspection, Suggestable } from '../shared';
import { SuggestableField } from '../shared';

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
    if (!window.confirm('Remove this delivery? Any line items assigned to it will need reassignment.')) return;
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
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            Verify <em>load data</em>
          </h1>
          <div className="page-head__sub">
            Step 4 of 4 · Confirm data and reconcile picklist vs BOL
          </div>
        </div>
      </div>

      <div className="banner banner--warn">
        <span className="banner__icon">⚠</span>
        <div className="banner__body">
          Verify each row carefully. <strong>Mistakes here affect the whole inspection.</strong>{' '}
          Bag counts and batch codes drive every per-pallet check.
        </div>
      </div>

      {loadMismatch && (
        <div className="banner banner--danger">
          <span className="banner__icon">✕</span>
          <div className="banner__body">
            <strong>Load # mismatch.</strong> Picklist says <span className="mono">{picklistLoad}</span>,
            BOL says <span className="mono">{bolLoad}</span>. These should be the same — pick the correct one.
          </div>
        </div>
      )}

      {/* ===== Load header ===== */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Load <em>header</em></h2>
        </div>
        <div className="field-row">
          <SuggestableField
            label="Load # (matches BOL #)"
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

      {/* ===== Deliveries ===== */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            Deliveries <em>({inspection.bol.deliveries.length})</em>
          </h2>
          <button className="btn btn--sm" onClick={addDelivery}>
            + Add delivery
          </button>
        </div>

        <div className="banner banner--info">
          <span className="banner__icon">i</span>
          <div className="banner__body">
            {inspection.type === 'returns'
              ? 'One Load can have multiple Delivery #s. Each line item below is assigned to a specific delivery.'
              : 'One Load can have multiple Delivery #s (for one or many stops). Each line item below is assigned to a specific delivery.'}
          </div>
        </div>

        {inspection.bol.deliveries.length === 0 ? (
          <div className="empty">
            <div className="empty__title">No deliveries yet</div>
            <div className="empty__sub">Tap "+ Add delivery" to enter at least one.</div>
          </div>
        ) : (
          <div className="delivery-list">
            {inspection.bol.deliveries.map((d) => (
              <div key={d.id} className="card">
                <div className="field-row">
                  <div className="field">
                    <div className="field__label">Delivery #</div>
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
                      <div className="field__label">Stop #</div>
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
                      Remove delivery
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
            <h2 className="section__title">Order <em>Verification</em></h2>
          </div>
          
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 16, fontWeight: 500 }}>
              * Is this a multi-stop load?
            </div>
            <div className="row-start gap-8">
              <button
                className={`btn btn--lg flex-1 ${inspection.bol.isMultiStopLoad === 'Yes' ? 'btn--accent' : 'btn--ghost'}`}
                style={inspection.bol.isMultiStopLoad === 'Yes' ? { backgroundColor: 'var(--success)', color: 'white' } : {}}
                onClick={() => dispatch({ type: 'SET_BOL', patch: { isMultiStopLoad: 'Yes' } })}
              >
                Yes
              </button>
              <button
                className={`btn btn--lg flex-1 ${inspection.bol.isMultiStopLoad === 'No' ? 'btn--accent' : 'btn--ghost'}`}
                style={inspection.bol.isMultiStopLoad === 'No' ? { backgroundColor: 'var(--danger)', color: 'white' } : {}}
                onClick={() => dispatch({ type: 'SET_BOL', patch: { isMultiStopLoad: 'No' } })}
              >
                No
              </button>
            </div>
          </div>

          <div className="card">
            <div style={{ marginBottom: 16, fontWeight: 500 }}>
              * Does the placard info match the initial BOL?
            </div>
            <div className="row-start gap-8">
              <button
                className={`btn btn--lg flex-1 ${inspection.bol.placardMatchesBol === 'Yes' ? 'btn--accent' : 'btn--ghost'}`}
                style={inspection.bol.placardMatchesBol === 'Yes' ? { backgroundColor: 'var(--success)', color: 'white' } : {}}
                onClick={() => dispatch({ type: 'SET_BOL', patch: { placardMatchesBol: 'Yes' } })}
              >
                Yes
              </button>
              <button
                className={`btn btn--lg flex-1 ${inspection.bol.placardMatchesBol === 'No' ? 'btn--accent' : 'btn--ghost'}`}
                style={inspection.bol.placardMatchesBol === 'No' ? { backgroundColor: 'var(--danger)', color: 'white' } : {}}
                onClick={() => dispatch({ type: 'SET_BOL', patch: { placardMatchesBol: 'No' } })}
              >
                No
              </button>
            </div>
          </div>
        </section>
      )}

      <div className="flex gap-8" style={{ justifyContent: 'flex-end', marginTop: 24 }}>
        <button className="btn btn--ghost" onClick={() => window.history.back()}>
          ← Back
        </button>
        <button className="btn btn--accent btn--lg" onClick={confirm} disabled={!canConfirm}>
          ✓ Confirm &amp; start scanning
        </button>
      </div>
    </main>
  );
}

function ShipDateField({
  field,
  onChange,
}: {
  field: Suggestable<string>;
  onChange: (next: Suggestable<string>) => void;
}) {
  // Use HTML5 date picker - works well on iPad (native picker UI)
  return (
    <div className="field">
      <div className="field__label">Ship date</div>
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


