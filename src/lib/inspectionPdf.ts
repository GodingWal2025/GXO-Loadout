// PDF export of an inspection's batch/quantity data.
//
// Mirrors the Review Progress modal: summary pills, a per-batch product
// summary, and the per-pallet detail table. Generated fully client-side with
// jsPDF so it works offline and on iPad PWAs.

import { normalizeBatchCode, type Inspection } from '../shared';
import { dbListInventoryItems } from '../shared/services/db';

export async function downloadInspectionPdf(inspection: Inspection): Promise<void> {
  // Lazy-load the PDF libraries (~350KB) so they don't weigh down the main
  // bundle — PDF export is an occasional action. Both are precached by the
  // PWA service worker, so this still works offline after first load.
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  const isInbound = inspection.type === 'inbound';
  const isReturns = inspection.type === 'returns';

  const loadNum =
    inspection.inbound?.bolNumber?.value ||
    inspection.picklist.loadNumber.value ||
    inspection.bol.loadNumber.value ||
    inspection.returnsBol?.bolNumber?.value ||
    inspection.id.slice(0, 8);

  // If inbound, render digital replica of the Inbound Verification Log
  if (isInbound) {
    const inbound = inspection.inbound;
    const lines = inbound?.lineItems || [];
    const totalReceived = lines.reduce(
      (sum, li) => sum + (Number(li.qtyReceived?.value) || 0),
      0
    );
    const totalDamaged = lines.reduce(
      (sum, li) => sum + (Number(li.qtyDamaged?.value) || 0),
      0
    );

    // Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Inbound Verification Log', margin, 46);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(
      `Generated: ${new Date().toLocaleString()}  ·  Status: ${inspection.status}`,
      margin,
      60
    );

    // Header Table (replicating paper log top header)
    autoTable(doc, {
      startY: 70,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 4, textColor: 30 },
      headStyles: { fillColor: [245, 245, 245], textColor: 20, fontStyle: 'bold' },
      body: [
        [
          { content: 'BoL Number:', styles: { fontStyle: 'bold' } },
          inbound?.bolNumber?.value || '—',
          { content: 'Date Received:', styles: { fontStyle: 'bold' } },
          inbound?.dateReceived?.value || '—',
        ],
        [
          { content: 'Delivery Number:', styles: { fontStyle: 'bold' } },
          inbound?.deliveryNumber?.value || '—',
          { content: 'Date Verified:', styles: { fontStyle: 'bold' } },
          inbound?.dateVerified?.value || '—',
        ],
        [
          { content: 'Staging Lane(s):', styles: { fontStyle: 'bold' } },
          inbound?.stagingLane?.value || inspection.stagingLocation || '—',
          { content: 'Verifier:', styles: { fontStyle: 'bold' } },
          inbound?.verifier?.value || inspection.startedBy || '—',
        ],
        [
          { content: 'Check one:', styles: { fontStyle: 'bold' } },
          '[X] Inbound    [ ] Return',
          { content: 'Damage photos:', styles: { fontStyle: 'bold' } },
          `${lines.flatMap((l) => l.damagePhotoIds || []).length} captured`,
        ],
      ],
    });

    const headerFinalY = (doc as any).lastAutoTable.finalY;

    // Line items table
    const tableBody = lines.map((li, idx) => [
      String(li.itemNumber || idx + 1),
      li.materialNumber?.value || '—',
      li.batch?.value ? li.batch.value.toUpperCase() : '—',
      li.uom || 'BG',
      li.location?.value || '—',
      String(li.qtyReceived?.value ?? 0),
      String(li.qtyDamaged?.value ?? 0),
      li.onBol ? 'Y' : 'N',
      (li.damagePhotoIds || []).length > 0 ? `${li.damagePhotoIds?.length} photos` : 'None',
    ]);

    autoTable(doc, {
      startY: headerFinalY + 14,
      margin: { left: margin, right: margin },
      head: [
        [
          '#',
          'MATERIAL NUMBER',
          'BATCH',
          'UOM',
          'LOC',
          'QTY RECEIVED',
          'QTY DAMAGED',
          'ON BOL?',
          'DAMAGES',
        ],
      ],
      body: tableBody,
      foot: [
        [
          'Total',
          '',
          '',
          '',
          '',
          String(totalReceived),
          String(totalDamaged),
          '',
          '',
        ],
      ],
      theme: 'grid',
      headStyles: { fillColor: [20, 20, 20], textColor: 255, fontSize: 8.5 },
      footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold', fontSize: 8.5 },
      styles: { fontSize: 8, cellPadding: 4 },
      columnStyles: {
        5: { halign: 'right' },
        6: { halign: 'right' },
        7: { halign: 'center' },
      },
    });

    // Page footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(
        `GXO Loadout — Inbound Verification Log — BoL #${loadNum} — page ${i} of ${pageCount}`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 20,
        { align: 'center' }
      );
    }

    doc.save(`inbound-${loadNum}-log.pdf`);
    return;
  }

  // Delivery lookup
  const deliveryMap: Record<string, { deliveryNumber: string; stopNumber?: number }> = {};
  for (const d of inspection.bol.deliveries) {
    deliveryMap[d.id] = { deliveryNumber: d.deliveryNumber, stopNumber: d.stopNumber };
  }

  // Batch codes are matched case-insensitively — scanned/OCR'd codes are often
  // mixed-case while inventory/picklist store them uppercase.
  const norm = normalizeBatchCode;

  // Product name lookup from picklist
  const productByBatch: Record<string, string> = {};
  const descByBatch: Record<string, string> = {};
  const skuByBatch: Record<string, string> = {};
  for (const li of inspection.picklist.lineItems) {
    const code = norm(li.batchCode.value || '');
    const label = [li.sku.value, li.description.value].filter(Boolean).join(' — ');
    if (code && label) productByBatch[code] = label;
    if (code && li.description.value) descByBatch[code] = li.description.value;
    if (code && li.sku.value) skuByBatch[code] = li.sku.value;
  }

  // Fill SKU / Material Description gaps from the inventory list (keyed by
  // batch). The picklist often lacks descriptions, so inventory is the source
  // of truth for the material description.
  const inventory = await dbListInventoryItems().catch(() => []);
  const descBySku: Record<string, string> = {};
  for (const it of inventory) {
    if (it.sku && it.description) descBySku[norm(it.sku)] = it.description;
    const batch = norm(it.batch || '');
    if (!batch) continue;
    if (it.sku && !skuByBatch[batch]) skuByBatch[batch] = it.sku;
    if (it.description && !descByBatch[batch]) descByBatch[batch] = it.description;
  }
  // Last resort: resolve description via the batch's SKU.
  for (const code of Object.keys(skuByBatch)) {
    if (!descByBatch[code] && descBySku[norm(skuByBatch[code])]) {
      descByBatch[code] = descBySku[norm(skuByBatch[code])];
    }
  }

  // Flatten batch rows (same shape as the progress modal)
  const rows: {
    palletNumber: number;
    palletType: string;
    batchCode: string;
    bagCount: number;
    deliveryNumber: string;
    stopNumber?: number;
    scannedBy?: string;
  }[] = [];
  for (const p of inspection.pallets) {
    const delInfo = p.deliveryId ? deliveryMap[p.deliveryId] : undefined;
    for (const bs of p.batchSections) {
      rows.push({
        palletNumber: p.palletNumber,
        palletType: p.palletType,
        batchCode: bs.batchCode.value || '',
        bagCount: bs.actualBagCount.value || 0,
        deliveryNumber: delInfo?.deliveryNumber || '—',
        stopNumber: delInfo?.stopNumber,
        scannedBy: p.scannedBy,
      });
    }
  }

  // Aggregate per batch
  const batchTotals = new Map<string, number>();
  for (const r of rows) {
    if (!r.batchCode) continue;
    batchTotals.set(r.batchCode, (batchTotals.get(r.batchCode) || 0) + r.bagCount);
  }
  const totalBags = rows.reduce((s, r) => s + r.bagCount, 0);

  // Distinct delivery numbers across all pallets, in first-seen order
  const deliveryNums: string[] = [];
  for (const r of rows) {
    if (r.deliveryNumber && r.deliveryNumber !== '—' && !deliveryNums.includes(r.deliveryNumber)) {
      deliveryNums.push(r.deliveryNumber);
    }
  }

  // ---- Header ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(`Load #${loadNum}`, margin, 52);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90);
  const subParts = [
    inspection.type.toUpperCase(),
    inspection.status === 'COMPLETED' || inspection.status === 'FLAGGED'
      ? `Completed${inspection.completedBy ? ` by ${inspection.completedBy}` : ''}`
      : `In progress${inspection.currentInspector || inspection.startedBy ? ` — ${inspection.currentInspector || inspection.startedBy}` : ''}`,
    `Generated ${new Date().toLocaleString()}`,
  ];
  doc.text(subParts.join('  ·  '), margin, 68);

  doc.setFontSize(10);
  doc.setTextColor(40);
  if (isReturns) {
    doc.text(
      `Deliveries: ${deliveryNums.length ? deliveryNums.join(', ') : '—'}`,
      margin,
      86
    );
  } else {
    doc.text(
      `${inspection.pallets.length} pallets scanned   ·   ${totalBags} total bags   ·   ${batchTotals.size} unique batches`,
      margin,
      86
    );
  }

  // ---- Batch summary table (non-returns only) ----
  let afterSummaryY = 110;
  if (!isReturns) {
    autoTable(doc, {
      startY: 100,
      margin: { left: margin, right: margin },
      head: [['Batch Code', 'Product', 'Total Bags']],
      body: Array.from(batchTotals.entries()).map(([code, bags]) => [
        code,
        productByBatch[norm(code)] || '—',
        String(bags),
      ]),
      foot: [['Total', '', String(totalBags)]],
      theme: 'grid',
      headStyles: { fillColor: [20, 20, 20], textColor: 255, fontSize: 9 },
      footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 5 },
      columnStyles: { 2: { halign: 'right' } },
    });
    afterSummaryY = (doc as any).lastAutoTable.finalY + 24;
  }

  // ---- Per-pallet detail table ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(20);
  doc.text('Pallet detail', margin, afterSummaryY);

  const head = isReturns
    ? [['Pallet', 'Batch', 'SKU', 'Material Description', 'Quantity']]
    : [['Pallet', 'Delivery', 'Stop', 'Type', 'Batch Code', 'Bags', 'Scanned By']];
  const body = rows.map((r) =>
    isReturns
      ? [`#${r.palletNumber}`, r.batchCode ? r.batchCode.toUpperCase() : '—', skuByBatch[norm(r.batchCode)] || '—', descByBatch[norm(r.batchCode)] || '—', String(r.bagCount)]
      : [`#${r.palletNumber}`, r.deliveryNumber, r.stopNumber !== undefined ? String(r.stopNumber) : '—', r.palletType, r.batchCode || '—', String(r.bagCount), r.scannedBy || '—']
  );

  autoTable(doc, {
    startY: afterSummaryY + 10,
    margin: { left: margin, right: margin },
    head,
    body,
    theme: 'grid',
    headStyles: { fillColor: [20, 20, 20], textColor: 255, fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 5 },
    columnStyles: { [isReturns ? 4 : 5]: { halign: 'right' } },
  });

  // Page footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(
      `GXO Loadout — Load #${loadNum} — page ${i} of ${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 20,
      { align: 'center' }
    );
  }

  doc.save(`load-${loadNum}-batches.pdf`);
}
