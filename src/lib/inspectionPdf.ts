// PDF export of an inspection's batch/quantity data.
//
// Mirrors the Review Progress modal: summary pills, a per-batch product
// summary, and the per-pallet detail table. Generated fully client-side with
// jsPDF so it works offline and on iPad PWAs.

import type { Inspection } from '../shared';

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

  const loadNum =
    inspection.picklist.loadNumber.value ||
    inspection.bol.loadNumber.value ||
    inspection.returnsBol?.bolNumber?.value ||
    inspection.id.slice(0, 8);

  // Delivery lookup
  const deliveryMap: Record<string, { deliveryNumber: string; stopNumber?: number }> = {};
  for (const d of inspection.bol.deliveries) {
    deliveryMap[d.id] = { deliveryNumber: d.deliveryNumber, stopNumber: d.stopNumber };
  }

  // Product name lookup from picklist
  const productByBatch: Record<string, string> = {};
  for (const li of inspection.picklist.lineItems) {
    const code = li.batchCode.value;
    if (code && li.productName.value) productByBatch[code] = li.productName.value;
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
  doc.text(
    `${inspection.pallets.length} pallets scanned   ·   ${totalBags} total bags   ·   ${batchTotals.size} unique batches`,
    margin,
    86
  );

  // ---- Batch summary table ----
  autoTable(doc, {
    startY: 100,
    margin: { left: margin, right: margin },
    head: [['Batch Code', 'Product', 'Total Bags']],
    body: Array.from(batchTotals.entries()).map(([code, bags]) => [
      code,
      productByBatch[code] || '—',
      String(bags),
    ]),
    foot: [['Total', '', String(totalBags)]],
    theme: 'grid',
    headStyles: { fillColor: [20, 20, 20], textColor: 255, fontSize: 9 },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold', fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 5 },
    columnStyles: { 2: { halign: 'right' } },
  });

  // ---- Per-pallet detail table ----
  const isReturns = inspection.type === 'returns';
  const afterSummaryY = (doc as any).lastAutoTable.finalY + 24;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(20);
  doc.text('Pallet detail', margin, afterSummaryY);

  const head = isReturns
    ? [['Pallet', 'Delivery', 'Type', 'Batch Code', 'Bags', 'Scanned By']]
    : [['Pallet', 'Delivery', 'Stop', 'Type', 'Batch Code', 'Bags', 'Scanned By']];
  const body = rows.map((r) =>
    isReturns
      ? [`#${r.palletNumber}`, r.deliveryNumber, r.palletType, r.batchCode || '—', String(r.bagCount), r.scannedBy || '—']
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
