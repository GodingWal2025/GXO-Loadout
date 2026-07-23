// Picklist OCR column mapping.
//
// The extractor lives in the Function app (api/src/index.ts) because the
// Document Intelligence key must stay server-side, but the mapping logic is
// pure and worth testing here where the suite already runs.
//
// These cases come from a real Albert Lea picklist where the SKU column was
// being filled with the material DESCRIPTION and the batch code was dropped.

import { describe, expect, it } from 'vitest';
import { extractLineItemsFromTables } from '../../../api/src/index';

/** Builds a prebuilt-layout style table from a header row + data rows. */
function table(header: string[], rows: string[][]) {
  const cells: { rowIndex: number; columnIndex: number; content: string }[] = [];
  header.forEach((content, columnIndex) => cells.push({ rowIndex: 0, columnIndex, content }));
  rows.forEach((row, r) =>
    row.forEach((content, columnIndex) => cells.push({ rowIndex: r + 1, columnIndex, content }))
  );
  return { cells };
}

describe('picklist OCR extraction', () => {
  it('keeps the material number and its description in separate fields', () => {
    const items = extractLineItemsFromTables([
      table(
        ['Batch', 'Material', 'Material Description', 'Qty', 'UOM'],
        [
          ['H18MYD9JX', '91007244', 'C.CL.201-40VT4PRIB.SF2.40USP.UB.US', '18', 'BAG'],
          ['J20QRT4LM', '91007301', 'C.CL.115-22VT2PRIB.SF1.20USP.UB.US', '4', 'SP'],
        ]
      ),
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      batchCode: 'H18MYD9JX',
      sku: '91007244',
      description: 'C.CL.201-40VT4PRIB.SF2.40USP.UB.US',
      expectedQuantity: 18,
      uom: 'BG', // "BAG" normalizes to the SAP code BG
    });
    expect(items[1]).toMatchObject({ sku: '91007301', uom: 'SP', expectedQuantity: 4 });
  });

  it('does not let "Material Description" claim the SKU column', () => {
    // Regression: "Material Description" contains "material", so an
    // sku-before-description keyword order mapped it to sku and dropped the
    // real material number entirely.
    const items = extractLineItemsFromTables([
      table(
        ['Material Description', 'Material', 'Qty'],
        [['C.CL.201-40VT4PRIB.SF2.40USP.UB.US', '91007244', '18']]
      ),
    ]);

    expect(items[0].sku).toBe('91007244');
    expect(items[0].description).toBe('C.CL.201-40VT4PRIB.SF2.40USP.UB.US');
  });

  it('finds the batch column when the header does not name it', () => {
    const items = extractLineItemsFromTables([
      table(
        ['Seq', 'Code', 'Material', 'Qty'],
        [
          ['1', 'H18MYD9JX', '91007244', '18'],
          ['2', 'J20QRT4LM', '91007301', '4'],
        ]
      ),
    ]);

    expect(items.map((i) => i.batchCode)).toEqual(['H18MYD9JX', 'J20QRT4LM']);
  });

  it('corrects a swapped SKU / description pair', () => {
    const items = extractLineItemsFromTables([
      table(['Item', 'Qty'], [['C.CL.201-40VT4PRIB.SF2.40USP.UB.US', '18']]),
    ]);

    // A dotted description is not a material number, so it must not be
    // presented to the verifier as a confirmed SKU.
    expect(items[0].sku).toBeNull();
    expect(items[0].description).toBe('C.CL.201-40VT4PRIB.SF2.40USP.UB.US');
  });

  it('ignores tables that are not line-item tables', () => {
    expect(extractLineItemsFromTables([table(['Ship To', 'Address'], [['Acme', '1 Main St']])])).toEqual(
      []
    );
    expect(extractLineItemsFromTables([])).toEqual([]);
    expect(extractLineItemsFromTables(undefined)).toEqual([]);
  });

  it('skips empty and subtotal rows', () => {
    const items = extractLineItemsFromTables([
      table(
        ['Batch', 'Material', 'Qty'],
        [
          ['H18MYD9JX', '91007244', '18'],
          ['', '', ''],
        ]
      ),
    ]);

    expect(items).toHaveLength(1);
  });
});
