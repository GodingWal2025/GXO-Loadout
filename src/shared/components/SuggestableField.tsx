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
  /** Interpret a scanned GS1 barcode as a batch/lot code (application identifier 10). */
  scanMode?: 'raw' | 'gs1Batch';
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
  scanMode = 'raw',
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
    const finalValue = scanMode === 'gs1Batch'
      ? extractGs1BatchCode(decodedText)
      : decodedText.trim().replace(/^\]C1/, '');

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
        {type === 'text' && (uppercase || mono) ? (
          <AlphanumericInput
            value={field.value === null ? '' : String(field.value)}
            onValueChange={handleChange}
            placeholder={placeholder}
            className={mono ? 'mono' : ''}
            uppercase={uppercase || Boolean(mono)}
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
            type="button"
            className="btn btn--outline" 
            onClick={() => setScanning(true)}
            style={{ padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title={t('suggest.scanBarcode', 'Scan Barcode')}
            aria-label={t('suggest.scanBarcode', 'Scan Barcode')}
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

/** Extract GS1 application identifier 10 (lot/batch) from scanner output. */
export function extractGs1BatchCode(decodedText: string): string {
  const value = decodedText.trim().replace(/^\]C1/, '');

  // Human-readable GS1, such as (01)00197515378837(10)P60G6UPB8.
  const parenthesized = value.match(/\(10\)\s*([A-Z0-9][A-Z0-9._/-]{0,19})/i);
  if (parenthesized) return parenthesized[1].toUpperCase();

  // Scanner output for AI 01 followed by variable-length AI 10. A group
  // separator (FNC1) terminates the lot when another application identifier follows.
  const gtinAndBatch = value.match(/^01\d{14}10([^\x1D]{1,20})/i);
  if (gtinAndBatch) return gtinAndBatch[1].toUpperCase();

  // Also support barcodes that contain only application identifier 10.
  const batchOnly = value.match(/^10([^\x1D]{1,20})/i);
  if (batchOnly) return batchOnly[1].toUpperCase();

  // Preserve support for ordinary, non-GS1 batch-code barcodes.
  return value.toUpperCase();
}
