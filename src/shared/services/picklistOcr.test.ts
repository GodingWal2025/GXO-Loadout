// Picklist OCR column mapping.
//
// The extractor lives in the Function app (api/src/index.ts) because the
// Document Intelligence key must stay server-side, but the mapping logic is
// pure and worth testing here where the suite already runs.
//
// These cases come from a real Albert Lea picklist where the SKU column was
// being filled with the material DESCRIPTION and the batch code was dropped.

import { describe, expect, it } from 'vitest';
import {
  DATE_VALUE,
  LOAD_LABEL,
  LOAD_VALUE,
  SHIP_DATE_LABEL,
  deliveryForPosition,
  docLines,
  extractLineItemsFromTables,
  findDeliveryAnchors,
  findLabeledValue,
  normalizeOcrBatchCode,
  normalizeOcrNumericText,
  parseDateToIso,
} from '../../../api/src/index';

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
  it('corrects B/8 only where the field format makes the character unambiguous', () => {
    expect(normalizeOcrNumericText('91007B44')).toBe('91007844');
    expect(normalizeOcrBatchCode('PB8GE1JMB')).toBe('P88GE1JMB');
    expect(normalizeOcrBatchCode('821R1SHTB')).toBe('B21R1SHTB');
    // The suffix is genuinely alphanumeric, so its B and 8 must remain as read.
    expect(normalizeOcrBatchCode('P21B1S8TB')).toBe('P21B1S8TB');
  });

  it('normalizes B to 8 in numeric SKU, quantity, and delivery fields', () => {
    const items = extractLineItemsFromTables([
      table(
        ['Delivery', 'Batch', 'Material', 'Qty'],
        [['80123B5', 'PB8GE1JM8', '91007B44', '2B']]
      ),
    ]);

    expect(items[0]).toMatchObject({
      deliveryNumber: '8012385',
      batchCode: 'P88GE1JM8',
      sku: '91007844',
      expectedQuantity: 28,
    });
  });

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

  it('reads a delivery column when the picklist has one', () => {
    const items = extractLineItemsFromTables([
      table(
        ['Delivery', 'Batch', 'Material', 'Qty'],
        [
          ['8012345', 'H18MYD9JX', '91007244', '18'],
          ['8012346', 'J20QRT4LM', '91007301', '4'],
        ]
      ),
    ]);

    expect(items.map((i) => i.deliveryNumber)).toEqual(['8012345', '8012346']);
  });
});

// The load header and the delivery headings are not part of the trained model —
// they're read off the OCR'd text layer. These are the shapes real Albert Lea
// picklists print them in.

/** Builds an analyze result from lines laid out top-to-bottom on one page. */
function page(texts: string[], pageNumber = 1) {
  return {
    pageNumber,
    height: 100,
    lines: texts.map((content, i) => ({
      content,
      // 10 units apart down a 100-unit page → normalized y of 0.1, 0.2, …
      polygon: [
        { x: 0, y: (i + 1) * 10 },
        { x: 10, y: (i + 1) * 10 },
      ],
    })),
  };
}

describe('picklist header extraction', () => {
  it('reads a load number printed beside its label', () => {
    const lines = docLines({ pages: [page(['Warehouse: Albert Lea', 'Load #: 835'])] });
    expect(findLabeledValue(lines, LOAD_LABEL, LOAD_VALUE)).toBe('835');
  });

  it('reads a load number stacked under its label', () => {
    const lines = docLines({ pages: [page(['Load', '835', 'Carrier', 'ACME'])] });
    expect(findLabeledValue(lines, LOAD_LABEL, LOAD_VALUE)).toBe('835');
  });

  it('does not mistake "Loading Point" for the load number', () => {
    const lines = docLines({ pages: [page(['Loading Point', 'AL01', 'Load 835'])] });
    expect(findLabeledValue(lines, LOAD_LABEL, LOAD_VALUE)).toBe('835');
  });

  it('reads the ship date', () => {
    const lines = docLines({ pages: [page(['Ship Date', '07/26/2026'])] });
    expect(findLabeledValue(lines, SHIP_DATE_LABEL, DATE_VALUE)).toBe('07/26/2026');
  });

  it('normalizes every printed date form to YYYY-MM-DD', () => {
    // The verify screen uses <input type="date">, which shows nothing at all
    // unless the value is ISO — an un-normalized date reads as "OCR failed".
    expect(parseDateToIso('07/26/2026')).toBe('2026-07-26');
    expect(parseDateToIso('26.07.2026')).toBe('2026-07-26'); // SAP's dotted form
    expect(parseDateToIso('7/26/26')).toBe('2026-07-26');
    expect(parseDateToIso('26-JUL-2026')).toBe('2026-07-26');
    expect(parseDateToIso('July 26, 2026')).toBe('2026-07-26');
    expect(parseDateToIso('2026-07-26')).toBe('2026-07-26');
    // A typed model field stringifies to this before it reaches us.
    expect(parseDateToIso('Sun Jul 26 2026 00:00:00 GMT+0000')).toBe('2026-07-26');
    expect(parseDateToIso('not a date')).toBeNull();
    expect(parseDateToIso(null)).toBeNull();
  });
});

describe('delivery grouping', () => {
  const result = {
    pages: [
      page([
        'Delivery 8012345',
        'H18MYD9JX 91007244 18 BAG',
        'K44ZZP1QW 91007288 6 BAG',
        'Delivery 8012346',
        'J20QRT4LM 91007301 4 SP',
      ]),
    ],
  };

  it('finds each delivery heading in order', () => {
    expect(findDeliveryAnchors(docLines(result)).map((a) => a.deliveryNumber)).toEqual([
      '8012345',
      '8012346',
    ]);
  });

  it('corrects B/8 confusion in a numeric delivery heading', () => {
    const inline = docLines({ pages: [page(['Delivery 80123B5'])] });
    const stacked = docLines({ pages: [page(['Delivery', '80123B6'])] });
    expect(findDeliveryAnchors(inline)[0].deliveryNumber).toBe('8012385');
    expect(findDeliveryAnchors(stacked)[0].deliveryNumber).toBe('8012386');
  });

  it('assigns a row to the heading printed above it', () => {
    const anchors = findDeliveryAnchors(docLines(result));
    // y values match the page() layout: heading 1 at .1, its rows at .2/.3,
    // heading 2 at .4, its row at .5.
    expect(deliveryForPosition(anchors, { page: 1, y: 0.2 })).toBe('8012345');
    expect(deliveryForPosition(anchors, { page: 1, y: 0.3 })).toBe('8012345');
    expect(deliveryForPosition(anchors, { page: 1, y: 0.5 })).toBe('8012346');
  });

  it('ignores "Delivery Date" — that is not a delivery number', () => {
    const lines = docLines({ pages: [page(['Delivery Date', '07/26/2026'])] });
    expect(findDeliveryAnchors(lines)).toEqual([]);
  });

  it('treats a repeated heading as the same section, not a new one', () => {
    // Page 2 of a delivery reprints its heading as a continuation banner.
    const lines = docLines({
      pages: [page(['Delivery 8012345', 'row a']), page(['Delivery 8012345', 'row b'], 2)],
    });
    expect(findDeliveryAnchors(lines)).toHaveLength(1);
  });

  it('leaves a row unassigned when nothing is above it', () => {
    expect(deliveryForPosition([], { page: 1, y: 0.5 })).toBeNull();
    expect(deliveryForPosition(findDeliveryAnchors(docLines(result)), null)).toBeNull();
  });
});
