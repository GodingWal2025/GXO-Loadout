import { useState } from 'react';
import type { Suggestable } from '../types/inspection';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { useT } from '../i18n/LanguageContext';
import { AlphanumericInput } from './AlphanumericInput';

interface Props<T extends string | number> {
  label: string;
  field: Suggestable<T>;
  type?: 'text' | 'number';
  placeholder?: string;
  mono?: boolean;
  hideCamera?: boolean;
  /** Force typed letters to uppercase (batch codes are always uppercase). */
  uppercase?: boolean;
  onChange: (next: Suggestable<T>) => void;
}

export function SuggestableField<T extends string | number>({
  label,
  field,
  type = 'text',
  placeholder,
  mono,
  hideCamera = false,
  uppercase = false,
  onChange,
}: Props<T>) {
  const t = useT();
  const [scanning, setScanning] = useState(false);

  const handleChange = (rawInput: string) => {
    const raw = uppercase && type === 'text' ? rawInput.toUpperCase() : rawInput;
    const next: T | null =
      raw === '' ? null : (type === 'number' ? (Number(raw) as T) : (raw as T));

    let source: Suggestable<T>['source'];
    if (next === null) source = 'empty';
    else source = 'manual';

    onChange({ ...field, value: next, source });
  };

  const handleScan = (decodedText: string) => {
    setScanning(false);
    let finalValue = decodedText.trim();

    // Strip GS1 symbology identifier if present
    finalValue = finalValue.replace(/^\]C1/, '');

    if (label.toLowerCase().includes('batch')) {
      // Try to match human-readable format with parens: (10)H18MYD9JX
      const parensMatch = finalValue.match(/\(10\)\s*([A-Z0-9]+)/i);
      if (parensMatch) {
        finalValue = parensMatch[1];
      } else {
        // Try to match raw GS1: 01 (14 chars) + 10 (batch)
        const gs1Match = finalValue.match(/^01\d{14}10([A-Z0-9]+)/i);
        if (gs1Match) {
          finalValue = gs1Match[1];
        }
      }
    }

    handleChange(finalValue);
  };

  const isMlSuggested = field.source === 'ml' && field.value !== null;
  const confidencePct =
    typeof field.mlConfidence === 'number'
      ? Math.round(field.mlConfidence * 100)
      : null;

  return (
    <div className="field">
      <div className="field__label">
        {label}
        {isMlSuggested && (
          <span
            className="field__ml-badge"
            title={t(
              'suggest.mlHint',
              'Auto-filled from a scanned document. Confirm or correct it.'
            )}
            style={{
              marginLeft: 8,
              fontSize: '0.7rem',
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 999,
              background: '#fef3c7',
              color: '#92400e',
              verticalAlign: 'middle',
            }}
          >
            {t('suggest.aiConfirm', '✨ AI{pct} · confirm', {
              pct: confidencePct !== null ? ` ${confidencePct}%` : '',
            })}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        {uppercase && type === 'text' ? (
          <AlphanumericInput
            value={field.value === null ? '' : String(field.value)}
            onValueChange={handleChange}
            placeholder={placeholder}
            className={mono ? 'mono' : ''}
            aria-label={label}
          />
        ) : (
          <input
            type={type}
            value={field.value === null ? '' : String(field.value)}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={placeholder}
            className={mono ? 'mono' : ''}
            style={{ flex: 1 }}
          />
        )}
        {!hideCamera && (
          <button 
            className="btn btn--outline" 
            onClick={() => setScanning(true)}
            style={{ padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title={t('suggest.scanBarcode', 'Scan Barcode')}
          >
            📷
          </button>
        )}
      </div>

      {!hideCamera && scanning && (
        <BarcodeScanner 
          onResult={handleScan}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}
