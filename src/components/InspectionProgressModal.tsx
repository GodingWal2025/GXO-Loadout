import { useState, useMemo } from 'react';
import type { Inspection } from '../shared';
import { downloadInspectionPdf } from '../lib/inspectionPdf';

interface Props {
  inspection: Inspection;
  onClose: () => void;
}

export function InspectionProgressModal({ inspection, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [filterDelivery, setFilterDelivery] = useState('all');
  const [filterStop, setFilterStop] = useState('all');
  const [filterType, setFilterType] = useState('all');

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

  // Build a flat list of all batch sections across all pallets
  const allBatches = useMemo(() => {
    const rows: {
      palletNumber: number;
      palletType: string;
      batchCode: string;
      bagCount: number;
      deliveryNumber: string;
      stopNumber?: number;
      scannedBy?: string;
      scannedAt?: string;
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
          scannedAt: p.scannedAt,
        });
      }
    }
    return rows;
  }, [inspection.pallets, deliveryMap]);

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
        style={{ maxWidth: 760, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="modal__head">
          <h2 className="modal__title">
            Inspection <em>progress</em>
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn--outline btn--sm"
              onClick={() => downloadInspectionPdf(inspection)}
              title="Download batch summary as PDF"
            >
              ⤓ Download PDF
            </button>
            <button className="btn btn--ghost btn--sm" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {/* Summary pills */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div className="pill pill--info">{inspection.pallets.length} pallets scanned</div>
          <div className="pill pill--info">{totalBags} total bags</div>
          <div className="pill pill--info">{uniqueBatches.size} unique batches</div>
          {inspection.flaggedItemsCount > 0 && (
            <div className="pill pill--warn">⚑ {inspection.flaggedItemsCount} flagged</div>
          )}
        </div>

        {/* Search */}
        <div className="field" style={{ marginBottom: 12 }}>
          <input
            type="text"
            placeholder="Search batch code or pallet number…"
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
              <option value="all">All Deliveries</option>
              {deliveriesList.map(d => (
                <option key={d} value={d}>Delivery {d}</option>
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
                <option value="all">All Stops</option>
                {stopsList.map(s => (
                  <option key={s} value={String(s)}>Stop {s}</option>
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
              <option value="all">All Pallet Types</option>
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
                  ? 'No matching batches'
                  : 'No pallets scanned yet'}
              </div>
              <div className="empty__sub">
                {search || filterDelivery !== 'all' || filterStop !== 'all' || filterType !== 'all'
                  ? 'Try relaxing your filter criteria.'
                  : 'Scan pallets to see progress here.'}
              </div>
            </div>
          ) : (
            <div className="table-card">
              <table className="data">
                <thead>
                  <tr>
                    <th>Pallet</th>
                    <th>Delivery</th>
                    {inspection.type !== 'returns' && <th>Stop</th>}
                    <th>Type</th>
                    <th>Batch Code</th>
                    <th className="right">Bags</th>
                    <th>Scanned by</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={i}>
                      <td className="mono fw-500">#{r.palletNumber}</td>
                      <td className="mono small">{r.deliveryNumber}</td>
                      {inspection.type !== 'returns' && <td className="num small">{r.stopNumber ?? '—'}</td>}
                      <td className="small soft">{r.palletType}</td>
                      <td className="mono">{r.batchCode || '—'}</td>
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
              Handoff timeline
            </div>
            {inspection.handoffLog.map((entry, i) => (
              <div key={i} className="small" style={{ marginBottom: 4 }}>
                <strong>{entry.fromInspector || 'Started'}</strong> → <strong>{entry.toInspector}</strong>{' '}
                <span className="xs soft">
                  {new Date(entry.at).toLocaleString()}
                  {entry.palletsCompletedByPrevious.length > 0 && (
                    <> · completed pallets {entry.palletsCompletedByPrevious.join(', ')}</>
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
