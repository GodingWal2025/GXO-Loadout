import { Link } from 'react-router-dom';
import { countInspectionFlags, type Inspection } from '../shared';
import { downloadInspectionPdf } from '../lib/inspectionPdf';
import { useT, type TranslateFn } from '../shared/i18n/LanguageContext';
import { buildInspectionListCardModel, getInspectionCardStatus } from './inspectionListCardModel';

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
  const card = buildInspectionListCardModel(inspection);
  const flaggedItemsCount = countInspectionFlags(inspection);
  const cardStatus = getInspectionCardStatus(inspection, card, flaggedItemsCount);
  const isInbound = inspection.type === 'inbound';
  const startedBy = inspection.startedBy || t('listCard.unknownInspector', 'Unknown');
  const lastEdited = inspection.lastEditedAt ? timeAgo(inspection.lastEditedAt, t) : '';

  const isFinished = inspection.status === 'COMPLETED' || inspection.status === 'FLAGGED';
  const linkTarget = isFinished
    ? `/inspection/${inspection.id}/review`
    : isInbound
      ? `/inspection/${inspection.id}/verify-inbound`
      : `/inspection/${inspection.id}`;

  return (
    <Link
      to={linkTarget}
      className={`card inspection-card inspection-card--${cardStatus}`}
      style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
    >
      <div className="card__head">
        <div>
          <div className="flex gap-8">
            <span className="pill pill--neutral">{typeLabels[inspection.type]}</span>
            <div className="card__title mono">#{card.loadNumber}</div>
            {card.hasUnlistedBatch && (
              <span className="pill pill--warn" style={{ fontSize: 11 }}>
                ⚠ {t('listCard.unlistedBatch', 'Not on original picklist')}
              </span>
            )}
            {isInbound && card.inboundDamaged > 0 && (
              <span className="pill pill--danger" style={{ fontSize: 11 }}>
                ⚑ {t('verifyInbound.damagedBadge', '{count} Damaged', { count: card.inboundDamaged })}
              </span>
            )}
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
          {cardStatus === 'issue' ? (
            <span className="pill pill--warn">
              ⚑ {flaggedItemsCount > 0
                ? t('listCard.flagged', '{count} flagged', { count: flaggedItemsCount })
                : t('listCard.needsReview', 'Needs review')}
            </span>
          ) : cardStatus === 'complete' ? (
            <span className="pill pill--success">✓ {t('listCard.completed', 'Completed')}</span>
          ) : (
            <span className="pill pill--danger">✕ {t('listCard.notComplete', 'Not complete')}</span>
          )}
        </div>
      </div>

      {isInbound && card.inboundLines.length > 0 && (
        <>
          <div className="row-between mb-8 mt-8">
            <span className="small soft">
              {card.inboundLines.length} {t('verifyInbound.summaryLines', 'Items Logged')} · {card.inboundReceived} {t('verifyInbound.summaryReceived', 'Total Received')}
            </span>
          </div>
          <div className="flex small soft mt-8" style={{ gap: '14px', flexWrap: 'wrap' }}>
            {card.inboundLines.slice(0, 4).map((li) => (
              <span key={li.id}>
                <span className="mono">{li.batch || '—'}</span>{' '}
                <strong style={{ color: li.qtyDamaged > 0 ? 'var(--danger)' : 'var(--ink)' }}>
                  {li.qtyReceived} {li.uom}
                </strong>
              </span>
            ))}
          </div>
        </>
      )}

      {!isInbound && card.totalExpected > 0 && (
        <>
          <div className="row-between mb-8 mt-8">
            <span className="small soft">
              {t('listCard.palletsBags', '{pallets} pallets · {actual} of {expected} bags', {
                pallets: inspection.pallets?.length ?? 0,
                actual: card.totalActual,
                expected: card.totalExpected,
              })}
            </span>
            <span className="small fw-500 inspection-card__percent">
              {card.percentComplete}%
            </span>
          </div>
          <div className="progress progress--thin">
            <div className="progress__bar" style={{ width: `${Math.min(100, Math.max(0, card.percentComplete))}%` }} />
          </div>
        </>
      )}

      {!isInbound && card.productLines.length > 0 && (
        <div className="flex small soft mt-8" style={{ gap: '14px', flexWrap: 'wrap' }}>
          {card.productLines.slice(0, 4).map((li) => (
            <span key={li.id}>
              <span className="mono">{li.batchCode || '—'}</span>{' '}
              <strong style={{ color: li.fulfilled ? 'var(--success)' : 'var(--ink)' }}>
                {li.actualQuantity} / {li.expectedQuantity}
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
