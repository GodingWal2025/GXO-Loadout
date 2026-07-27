import { useState, useMemo, useEffect } from 'react';
import type { Inspection } from '../shared';
import type { InventoryItem } from '../shared/types/inventory';
import { downloadInspectionPdf } from '../lib/inspectionPdf';
import { dbListInventoryItems } from '../shared/services/db';
import { useT } from '../shared/i18n/LanguageContext';

interface Props {
  inspection: Inspection;
  onClose: () => void;
}

export function InspectionProgressModal({ inspection, onClose }: Props) {
  const t = useT();
  const [search, setSearch] = useState('');
  const [filterDelivery, setFilterDelivery] = useState('all');
  const [filterStop, setFilterStop] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [inventory, setInventory] = useState<InventoryItem[]>([]);

  // Load the inventory list — it's the source of truth for SKU + material
  // description, since the picklist often omits descriptions.
  useEffect(() => {
    let active = true;
    const load = () => {
      dbListInventoryItems()
        .then((items) => { if (active) setInventory(items); })
        .catch(() => { /* offline / empty inventory is fine */ });
    };
    load();
    // Re-load if a background inventory sync lands while the modal is open.
    window.addEventListener('loadout-inventory-updated', load);
    return () => {
      active = false;
      window.removeEventListener('loadout-inventory-updated', load);
    };
  }, []);

  // Build delivery ID to info map
  const deliveryMap = useMemo(() => {
    const map: Record<string, { deliveryNumber: string; stopNumber?: number }> = {};
    if (inspection.bol?.deliveries) {
      for (const d of inspection.bol.deliveries) {
        map[d.id] = {
          deliveryNumber: d.deliveryNumber,
          stopNumber: d.stopNumber,
        };
      }
    }
    return map;
  }, [inspection.bol?.deliveries]);

  // Build SKU + material description lookups keyed by batch code. Inventory is
  // the source of truth for descriptions; the picklist fills in any gaps.
  // Codes are matched case-insensitively (scanned codes are often mixed-case).
  const batchInfoMap = useMemo(() => {
    const norm = (s: string) => s.trim().toUpperCase();
    const map: Record<string, { sku: string; description: string }> = {};
    for (const li of inspection.picklist?.lineItems ?? []) {
      const code = norm(li.batchCode.value || '');
      if (!code) continue;
      map[code] = {
        sku: li.sku.value || '',
        description: li.description.value || '',
      };
    }
    // Inventory-derived lookups override/fill missing SKU + description.
    const descBySku: Record<string, string> = {};
    for (const it of inventory) {
      if (it.sku && it.description) descBySku[norm(it.sku)] = it.description;
      const batch = norm(it.batch || '');
      if (!batch) continue;
      const cur = map[batch] || { sku: '', description: '' };
      map[batch] = {
        sku: cur.sku || it.sku || '',
        description: cur.description || it.description || '',
      };
    }
    // Last resort: resolve description via the batch's SKU.
    for (const code of Object.keys(map)) {
      if (!map[code].description && map[code].sku && descBySku[norm(map[code].sku)]) {
        map[code].description = descBySku[norm(map[code].sku)];
      }
    }
    return map;
  }, [inspection.picklist?.lineItems, inventory]);

  // Build a flat list of all batch sections across all pallets
  const allBatches = useMemo(() => {
    const rows: {
      palletNumber: number;
      palletType: string;
      batchCode: string;
      sku: string;
      description: string;
      bagCount: number;
      deliveryNumber: string;
      stopNumber?: number;
      scannedBy?: string;
      scannedAt?: string;
    }[] = [];

    for (const p of inspection.pallets) {
      const delInfo = p.deliveryId ? deliveryMap[p.deliveryId] : undefined;
      for (const bs of p.batchSections) {
        const code = bs.batchCode.value || '';
        const info = batchInfoMap[code.trim().toUpperCase()];
        rows.push({
          palletNumber: p.palletNumber,
          palletType: p.palletType,
          batchCode: code,
          sku: info?.sku || '',
          description: info?.description || '',
          bagCount: bs.actualBagCount.value || 0,
          deliveryNumber: delInfo?.deliveryNumber || '—',
          stopNumber: delInfo?.stopNumber,
          scannedBy: p.scannedBy,
          scannedAt: p.scannedAt,
        });
      }
    }
    return rows;
  }, [inspection.pallets, deliveryMap, batchInfoMap]);

  // Extract unique values for filter dropdowns
  const deliveriesList = useMemo(() => {
    return Array.from(new Set(allBatches.map(r => r.deliveryNumber).filter(d => d && d !== '—'))).sort();
  }, [allBatches]);

  const stopsList = useMemo(() => {
    return Array.from(new Set(allBatches.map(r => r.stopNumber).filter((s): s is number => s !== undefined))).sort((a, b) => a - b);
  }, [allBatches]);

  const typesList = useMemo(() => {
    return Array.from(new Set(allBatches.map(r => r.palletType).filter(Boolean))).sort();
  }, [allBatches]);

  // Filter application
  const filtered = useMemo(() => {
    return allBatches.filter((r) => {
      // 1. Text Search
      if (search.trim()) {
        const term = search.toLowerCase();
        const matchesText =
          r.batchCode.toLowerCase().includes(term) ||
          String(r.palletNumber).includes(term) ||
          r.deliveryNumber.toLowerCase().includes(term);
        if (!matchesText) return false;
      }
      // 2. Delivery Filter
      if (filterDelivery !== 'all' && r.deliveryNumber !== filterDelivery) {
        return false;
      }
      // 3. Stop Filter
      if (filterStop !== 'all' && String(r.stopNumber) !== filterStop) {
        return false;
      }
      // 4. Type Filter
      if (filterType !== 'all' && r.palletType !== filterType) {
        return false;
      }
      return true;
    });
  }, [allBatches, search, filterDelivery, filterStop, filterType]);

  // Aggregate totals
  const totalBags = allBatches.reduce((s, r) => s + r.bagCount, 0);
  const uniqueBatches = new Set(allBatches.map((r) => r.batchCode).filter(Boolean));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 1100, width: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="modal__head">
          <h2 className="modal__title">
            {t('progress.titleLead', 'Inspection')} <em>{t('progress.titleEm', 'progress')}</em>
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn--outline btn--sm"
              onClick={() => downloadInspectionPdf(inspection)}
              title={t('progress.downloadPdfTitle', 'Download batch summary as PDF')}
            >
              {t('progress.downloadPdf', '⤓ Download PDF')}
            </button>
            <button className="btn btn--ghost btn--sm" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {/* Summary pills */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div className="pill pill--info">
            {t('progress.palletsScanned', '{count} pallets scanned', {
              count: inspection.pallets.length,
            })}
          </div>
          <div className="pill pill--info">
            {t('progress.totalBags', '{count} total bags', { count: totalBags })}
          </div>
          <div className="pill pill--info">
            {t('progress.uniqueBatches', '{count} unique batches', { count: uniqueBatches.size })}
          </div>
          {inspection.flaggedItemsCount > 0 && (
            <div className="pill pill--warn">
              {t('progress.flagged', '⚑ {count} flagged', { count: inspection.flaggedItemsCount })}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="field" style={{ marginBottom: 12 }}>
          <input
            type="text"
            placeholder={t('progress.searchPlaceholder', 'Search batch code or pallet number…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        {/* Filters dropdown row */}
        <div className="field-row" style={{ marginBottom: 16, gap: 12 }}>
          <div className="field">
            <select
              value={filterDelivery}
              onChange={(e) => setFilterDelivery(e.target.value)}
              style={{ minHeight: '38px', padding: '6px 10px' }}
            >
              <option value="all">{t('progress.allDeliveries', 'All Deliveries')}</option>
              {deliveriesList.map(d => (
                <option key={d} value={d}>{t('progress.deliveryOption', 'Delivery {n}', { n: d })}</option>
              ))}
            </select>
          </div>
          {inspection.type !== 'returns' && stopsList.length > 0 && (
            <div className="field">
              <select
                value={filterStop}
                onChange={(e) => setFilterStop(e.target.value)}
                style={{ minHeight: '38px', padding: '6px 10px' }}
              >
                <option value="all">{t('progress.allStops', 'All Stops')}</option>
                {stopsList.map(s => (
                  <option key={s} value={String(s)}>{t('progress.stopOption', 'Stop {n}', { n: s })}</option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              style={{ minHeight: '38px', padding: '6px 10px' }}
            >
              <option value="all">{t('progress.allPalletTypes', 'All Pallet Types')}</option>
              {typesList.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Results table */}
        <div style={{ overflow: 'auto', flex: 1 }}>
          {filtered.length === 0 ? (
            <div className="empty" style={{ padding: 24 }}>
              <div className="empty__title">
                {search || filterDelivery !== 'all' || filterStop !== 'all' || filterType !== 'all'
                  ? t('progress.noMatches', 'No matching batches')
                  : t('progress.noPallets', 'No pallets scanned yet')}
              </div>
              <div className="empty__sub">
                {search || filterDelivery !== 'all' || filterStop !== 'all' || filterType !== 'all'
                  ? t('progress.noMatchesHint', 'Try relaxing your filter criteria.')
                  : t('progress.noPalletsHint', 'Scan pallets to see progress here.')}
              </div>
            </div>
          ) : (
            <div className="table-card">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('progress.colPallet', 'Pallet')}</th>
                    <th>{t('progress.colDelivery', 'Delivery')}</th>
                    {inspection.type !== 'returns' && <th>{t('progress.colStop', 'Stop')}</th>}
                    <th>{t('progress.colType', 'Type')}</th>
                    <th>{t('progress.colBatchCode', 'Batch Code')}</th>
                    <th>{t('progress.colSku', 'SKU')}</th>
                    <th>{t('progress.colDescription', 'Material Description')}</th>
                    <th className="right">{t('progress.colBags', 'Bags')}</th>
                    <th>{t('progress.colScannedBy', 'Scanned by')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={i}>
                      <td className="mono fw-500">#{r.palletNumber}</td>
                      <td className="mono small">{r.deliveryNumber}</td>
                      {inspection.type !== 'returns' && <td className="num small">{r.stopNumber ?? '—'}</td>}
                      <td className="small soft">{r.palletType}</td>
                      <td className="mono" style={{ textTransform: 'uppercase' }}>{r.batchCode || '—'}</td>
                      <td className="mono small">{r.sku || '—'}</td>
                      <td className="small soft">{r.description || '—'}</td>
                      <td className="right num fw-500">{r.bagCount}</td>
                      <td className="small soft">{r.scannedBy || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Handoff timeline */}
        {inspection.handoffLog && inspection.handoffLog.length > 0 && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--rule-soft)', paddingTop: 12 }}>
            <div
              className="xs soft"
              style={{ textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}
            >
              {t('progress.handoffTimeline', 'Handoff timeline')}
            </div>
            {inspection.handoffLog.map((entry, i) => (
              <div key={i} className="small" style={{ marginBottom: 4 }}>
                <strong>{entry.fromInspector || t('progress.started', 'Started')}</strong> →{' '}
                <strong>{entry.toInspector}</strong>{' '}
                <span className="xs soft">
                  {new Date(entry.at).toLocaleString()}
                  {entry.palletsCompletedByPrevious.length > 0 && (
                    <>
                      {' '}
                      {t('progress.completedPallets', '· completed pallets {list}', {
                        list: entry.palletsCompletedByPrevious.join(', '),
                      })}
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
