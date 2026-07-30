import { Link } from 'react-router-dom';
import type { Inspection } from '../shared';
import { downloadInspectionPdf } from '../lib/inspectionPdf';
import { useT, type TranslateFn } from '../shared/i18n/LanguageContext';

interface Props {
  inspection: Inspection;
}

export function InspectionListCard({ inspection }: Props) {
  const t = useT();
  const typeLabels: Record<Inspection['type'], string> = {
    outbound: t('listCard.typeOutbound', 'Outbound'),
    inbound: t('listCard.typeInbound', 'Inbound'),
    returns: t('listCard.typeReturns', 'Returns'),
    retag: t('listCard.typeRetag', 'Retag'),
    discard: t('listCard.typeDiscard', 'Discard'),
  };
  const totalExpected = inspection.picklist.lineItems.reduce(
    (sum, li) => sum + (li.expectedQuantity.value || 0),
    0
  );
  const totalActual = inspection.picklist.lineItems.reduce((sum, li) => sum + li.actualQuantity, 0);
  const pct = totalExpected > 0 ? Math.round((totalActual / totalExpected) * 100) : 0;

  const loadNum = inspection.picklist.loadNumber.value || inspection.bol.loadNumber.value || inspection.id.slice(0, 8);
  const startedBy = inspection.startedBy || t('listCard.unknownInspector', 'Unknown');
  const lastEdited = inspection.lastEditedAt ? timeAgo(inspection.lastEditedAt, t) : '';

  return (
    <Link
      to={`/inspection/${inspection.id}`}
      className="card"
      style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
    >
      <div className="card__head">
        <div>
          <div className="flex gap-8">
            <span className="pill pill--neutral">{typeLabels[inspection.type]}</span>
            <div className="card__title mono">#{loadNum}</div>
          </div>
          <div className="card__sub">
            {t('listCard.startedBy', 'Started by {name}', { name: startedBy })} · {lastEdited}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {(inspection.status === 'COMPLETED' || inspection.status === 'FLAGGED') && (
            <button
              className="btn btn--outline btn--sm"
              title={t('listCard.downloadPdfTitle', 'Download batch summary as PDF')}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                downloadInspectionPdf(inspection);
              }}
            >
              ⤓ PDF
            </button>
          )}
          {inspection.flaggedItemsCount > 0 ? (
            <span className="pill pill--danger">
              ⚑ {t('listCard.flagged', '{count} flagged', { count: inspection.flaggedItemsCount })}
            </span>
          ) : inspection.status === 'COMPLETED' ? (
            <span className="pill pill--success">✓ {t('listCard.completed', 'Completed')}</span>
          ) : (
            <span className="pill pill--info">{t('listCard.inProgress', 'In progress')}</span>
          )}
        </div>
      </div>

      {totalExpected > 0 && (
        <>
          <div className="row-between mb-8 mt-8">
            <span className="small soft">
              {t('listCard.palletsBags', '{pallets} pallets · {actual} of {expected} bags', {
                pallets: inspection.pallets.length,
                actual: totalActual,
                expected: totalExpected,
              })}
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

function timeAgo(iso: string, t: TranslateFn): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return t('listCard.justNow', 'just now');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('listCard.minutesAgo', '{count}m ago', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('listCard.hoursAgo', '{count}h ago', { count: hours });
  const days = Math.floor(hours / 24);
  return t('listCard.daysAgo', '{count}d ago', { count: days });
}
