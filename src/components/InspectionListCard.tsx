import { Link } from 'react-router-dom';
import type { Inspection } from '../shared';
import { INSPECTION_TYPE_LABELS } from '../shared';

interface Props {
  inspection: Inspection;
}

export function InspectionListCard({ inspection }: Props) {
  const totalExpected = inspection.picklist.lineItems.reduce(
    (sum, li) => sum + (li.expectedQuantity.value || 0),
    0
  );
  const totalActual = inspection.picklist.lineItems.reduce((sum, li) => sum + li.actualQuantity, 0);
  const pct = totalExpected > 0 ? Math.round((totalActual / totalExpected) * 100) : 0;

  const loadNum = inspection.picklist.loadNumber.value || inspection.bol.loadNumber.value || inspection.id.slice(0, 8);
  const startedBy = inspection.startedBy || 'Unknown';
  const lastEdited = inspection.lastEditedAt ? timeAgo(inspection.lastEditedAt) : '';

  return (
    <Link
      to={`/inspection/${inspection.id}`}
      className="card"
      style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
    >
      <div className="card__head">
        <div>
          <div className="flex gap-8">
            <span className="pill pill--neutral">{INSPECTION_TYPE_LABELS[inspection.type]}</span>
            <div className="card__title mono">#{loadNum}</div>
          </div>
          <div className="card__sub">
            Started by {startedBy} · {lastEdited}
          </div>
        </div>
        {inspection.flaggedItemsCount > 0 ? (
          <span className="pill pill--danger">⚑ {inspection.flaggedItemsCount} flagged</span>
        ) : (
          <span className="pill pill--info">In progress</span>
        )}
      </div>

      {totalExpected > 0 && (
        <>
          <div className="row-between mb-8 mt-8">
            <span className="small soft">
              {inspection.pallets.length} pallets · {totalActual} of {totalExpected} bags
            </span>
            <span className="small fw-500" style={{ color: 'var(--accent)' }}>
              {pct}%
            </span>
          </div>
          <div className="progress progress--thin">
            <div className="progress__bar" style={{ width: `${pct}%` }} />
          </div>
        </>
      )}

      {inspection.picklist.lineItems.length > 0 && (
        <div className="flex small soft mt-8" style={{ gap: '14px', flexWrap: 'wrap' }}>
          {inspection.picklist.lineItems.slice(0, 4).map((li) => (
            <span key={li.id}>
              <span className="mono">{li.batchCode.value || '—'}</span>{' '}
              <strong style={{ color: li.fulfilled ? 'var(--success)' : 'var(--ink)' }}>
                {li.actualQuantity} / {li.expectedQuantity.value || 0}
              </strong>
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

function timeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
