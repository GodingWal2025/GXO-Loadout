import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AlphanumericInput } from './AlphanumericInput';
import { extractGs1BatchCode, SuggestableField } from './SuggestableField';
import { LanguageProvider } from '../i18n/LanguageContext';

describe('AlphanumericInput', () => {
  it('keeps the letter keyboard without rendering static number shortcuts', () => {
    const markup = renderToStaticMarkup(
      <AlphanumericInput value="P60SM" onValueChange={() => undefined} aria-label="Batch code" />
    );

    expect(markup).toContain('inputMode="text"');
    expect(markup).toContain('autoCapitalize="characters"');
    expect(markup).not.toContain('aria-label="Number shortcuts"');
    expect(markup).not.toContain('aria-label="Insert ');
  });

  it('does not add shortcuts to other identifier-style fields', () => {
    const markup = renderToStaticMarkup(
      <LanguageProvider>
        <SuggestableField
          label="SKU / Material"
          field={{ value: '91007244', source: 'manual' }}
          mono
          onChange={() => undefined}
        />
      </LanguageProvider>
    );

    expect(markup).not.toContain('aria-label="Number shortcuts"');
    expect(markup).not.toContain('aria-label="Insert ');
  });
});

describe('GS1 batch code scanning', () => {
  it('extracts AI 10 from the human-readable barcode value', () => {
    expect(extractGs1BatchCode('(01)00197515378837(10)P60G6UPB8')).toBe('P60G6UPB8');
  });

  it('extracts AI 10 from raw GS1-128 scanner output', () => {
    expect(extractGs1BatchCode(']C1010019751537883710P60G6UPB8')).toBe('P60G6UPB8');
  });

  it('stops a variable-length batch at the FNC1 separator', () => {
    expect(extractGs1BatchCode('010019751537883710P60G6UPB8\x1D21SERIAL')).toBe('P60G6UPB8');
  });

  it('keeps ordinary batch-only barcodes working', () => {
    expect(extractGs1BatchCode('p60g6upb8')).toBe('P60G6UPB8');
  });
});
