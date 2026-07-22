import { generateId } from '../shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { dbGetInspection } from '../shared';
import { useInspection } from '../shared';
import type { Inspection, Suggestable, ReturnsBOLData } from '../shared';
import { SuggestableField } from '../shared';
import { StepBackLink } from '../shared';
import { useT } from '../shared/i18n/LanguageContext';

export function VerifyReturnsRoute() {
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

  return <VerifyReturnsInner initial={loaded} onVerified={() => navigate(`/inspection/${id}`)} />;
}

function VerifyReturnsInner({
  initial,
  onVerified,
}: {
  initial: Inspection;
  onVerified: () => void;
}) {
  const { inspection, dispatch } = useInspection(initial);
  const t = useT();
  const returnsBol = inspection.returnsBol;

  // Auto-initialize a default delivery if none exist
  useEffect(() => {
    if (inspection.bol.deliveries.length === 0) {
      dispatch({
        type: 'ADD_DELIVERY',
        delivery: {
          id: generateId(),
          deliveryNumber: '',
          stopNumber: 1,
          lineItemIds: [],
        },
      });
    }
  }, [inspection.bol.deliveries.length, dispatch]);

  if (!returnsBol) return null; // Defensive check

  const confirm = () => {
    dispatch({ type: 'VERIFY_RETURNS_BOL', verifiedBy: inspection.startedBy || 'unknown' });
    onVerified();
  };

  const updateField = (patch: Partial<ReturnsBOLData>) => {
    dispatch({ type: 'SET_RETURNS_BOL', patch });
  };

  const canConfirm = inspection.bol.deliveries.length > 0;

  return (
    <main>
      <StepBackLink to={`/inspection/${inspection.id}/capture-returns-staging`} />

      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            {t('verifyReturns.titleLead', 'Verify')}{' '}
            <em>{t('verifyReturns.titleEm', 'returns data')}</em>
          </h1>
          <div className="page-head__sub">
            {t('verifyReturns.subtitle', 'Step 4 of 5 · Confirm expected quantities')}
          </div>
        </div>
      </div>

      <div className="banner banner--warn">
        <span className="banner__icon">⚠</span>
        <div className="banner__body">
          {t(
            'verifyReturns.warn',
            'Verify each quantity carefully. These numbers will be cross-referenced against your physical counts during scanning.'
          )}
        </div>
      </div>

      {/* ===== Load header ===== */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            {t('verifyReturns.bolLead', 'BOL')} <em>{t('verifyReturns.bolEm', 'details')}</em>
          </h2>
        </div>
        <div className="field-row">
          <SuggestableField
            label={t('verifyReturns.bolNumber', 'Returns BOL #')}
            field={returnsBol.bolNumber}
            mono
            placeholder="835"
            onChange={(field) => updateField({ bolNumber: field })}
          />
          <ShipDateField
            field={returnsBol.receivedDate}
            onChange={(field) => updateField({ receivedDate: field })}
          />
        </div>
      </section>

      {/* ===== Expected Quantities ===== */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            {t('verifyReturns.expectedLead', 'Expected')}{' '}
            <em>{t('verifyReturns.expectedEm', 'quantities')}</em>
          </h2>
        </div>

        <div className="card">
          <div className="field-row" style={{ marginBottom: 16 }}>
            <ReturnsQtyField
              label={t('verifyReturns.pallets54x40', 'Wooden Pallets (54x40)')}
              field={returnsBol.expectedPallets54x40}
              onChange={(field) => updateField({ expectedPallets54x40: field })}
            />
            <ReturnsQtyField
              label={t('verifyReturns.pallets40x40', 'Wooden Pallets (40x40)')}
              field={returnsBol.expectedPallets40x40}
              onChange={(field) => updateField({ expectedPallets40x40: field })}
            />
          </div>
          
          <div className="field-row" style={{ marginBottom: 16 }}>
            <ReturnsQtyField
              label={t('verifyReturns.emptySeedPaks', 'Empty SeedPaks')}
              field={returnsBol.expectedEmptySeedPaks}
              onChange={(field) => updateField({ expectedEmptySeedPaks: field })}
            />
            <ReturnsQtyField
              label={t('verifyReturns.productSeedPaks', 'Product SeedPaks')}
              field={returnsBol.expectedProductSeedPaks}
              onChange={(field) => updateField({ expectedProductSeedPaks: field })}
            />
          </div>

          <div className="field-row">
            <ReturnsQtyField
              label={t('verifyReturns.baggedProduct', 'Bagged Product (pallets)')}
              field={returnsBol.expectedBaggedProduct}
              onChange={(field) => updateField({ expectedBaggedProduct: field })}
            />
          </div>
        </div>
      </section>

      <div className="flex gap-8" style={{ justifyContent: 'flex-end', marginTop: 24 }}>
        <button className="btn btn--ghost" onClick={() => window.history.back()}>
          {t('verifyReturns.back', '← Back')}
        </button>
        <button className="btn btn--accent btn--lg" onClick={confirm} disabled={!canConfirm}>
          {t('verifyReturns.confirmStart', '✓ Confirm & start scanning')}
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
  const t = useT();
  return (
    <div className="field">
      <div className="field__label">{t('verifyReturns.receivedDate', 'Received date')}</div>
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

function ReturnsQtyField({
  label,
  field,
  onChange,
}: {
  label: string;
  field: Suggestable<number>;
  onChange: (next: Suggestable<number>) => void;
}) {
  const handleChange = (raw: string) => {
    const next: number | null = raw === '' ? null : Number(raw);
    let source: Suggestable<number>['source'] = 'manual';
    if (next === null) source = 'empty';
    onChange({ ...field, value: next, source });
  };

  return (
    <div className="field">
      <div className="field__label">{label}</div>
      <input
        type="number"
        value={field.value === null ? '' : String(field.value)}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="0"
      />
    </div>
  );
}
