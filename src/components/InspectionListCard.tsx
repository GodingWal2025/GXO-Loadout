import { Link } from 'react-router-dom';
import type { Inspection } from '../shared';
import { normalizeBatchCode } from '../shared';
import { expectedBags, isPackagingLine, picklistHasOcr } from '../shared';
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
  // For outbound + OCR, packaging SKUs are excluded from completion counts.
  const excludePackaging =
    inspection.type === 'outbound' && picklistHasOcr(inspection.picklist);
  const productLineItems = excludePackaging
    ? inspection.picklist.lineItems.filter((li) => !isPackagingLine(li))
    : inspection.picklist.lineItems;

  const totalExpected = productLineItems.reduce(
    (sum, li) => sum + expectedBags(li.uom, li.expectedQuantity.value, li.description.value),
    0
  );
  const totalActual = productLineItems.reduce((sum, li) => sum + li.actualQuantity, 0);
  const pct = totalExpected > 0 ? Math.round((totalActual / totalExpected) * 100) : 0;

  const hasUnlistedBatch = inspection.pallets.some((p) =>
    p.batchSections.some((bs) => {
      const code = normalizeBatchCode(bs.batchCode?.value);
      if (!code) return false;
      return !inspection.picklist.lineItems.some(
        (li) => normalizeBatchCode(li.batchCode?.value) === code
      );
    })
  );

  const isInbound = inspection.type === 'inbound';
  const inboundLines = inspection.inbound?.lineItems || [];
  const inboundReceived = inboundLines.reduce(
    (sum, li) => sum + (Number(li.qtyReceived?.value) || 0),
    0
  );
  const inboundDamaged = inboundLines.reduce(
    (sum, li) => sum + (Number(li.qtyDamaged?.value) || 0),
    0
  );

  const loadNum =
    inspection.inbound?.bolNumber.value ||
    inspection.picklist.loadNumber.value ||
    inspection.bol.loadNumber.value ||
    inspection.returnsBol?.bolNumber.value ||
    inspection.id.slice(0, 8);
  const startedBy = inspection.startedBy || t('listCard.unknownInspector', 'Unknown');
  const lastEdited = inspection.lastEditedAt ? timeAgo(inspection.lastEditedAt, t) : '';

  const linkTarget = isInbound
    ? inspection.status === 'COMPLETED' || inspection.status === 'FLAGGED'
      ? `/inspection/${inspection.id}/review`
      : `/inspection/${inspection.id}/verify-inbound`
    : `/inspection/${inspection.id}`;

  return (
    <Link
      to={linkTarget}
      className="card"
      style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
    >
      <div className="card__head">
        <div>
          <div className="flex gap-8">
            <span className="pill pill--neutral">{typeLabels[inspection.type]}</span>
            <div className="card__title mono">#{loadNum}</div>
            {hasUnlistedBatch && (
              <span className="pill pill--warn" style={{ fontSize: 11 }}>
                ⚠ {t('listCard.unlistedBatch', 'Unlisted batch')}
              </span>
            )}
            {isInbound && inboundDamaged > 0 && (
              <span className="pill pill--danger" style={{ fontSize: 11 }}>
                ⚑ {t('verifyInbound.damagedBadge', '{count} Damaged', { count: inboundDamaged })}
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

      {isInbound && inboundLines.length > 0 && (
        <>
          <div className="row-between mb-8 mt-8">
            <span className="small soft">
              {inboundLines.length} {t('verifyInbound.summaryLines', 'Items Logged')} · {inboundReceived} {t('verifyInbound.summaryReceived', 'Total Received')}
            </span>
          </div>
          <div className="flex small soft mt-8" style={{ gap: '14px', flexWrap: 'wrap' }}>
            {inboundLines.slice(0, 4).map((li) => (
              <span key={li.id}>
                <span className="mono">{li.batch.value || '—'}</span>{' '}
                <strong style={{ color: (Number(li.qtyDamaged.value) || 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>
                  {li.qtyReceived.value ?? 0} {li.uom}
                </strong>
              </span>
            ))}
          </div>
        </>
      )}

      {!isInbound && totalExpected > 0 && (
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
            <div className="progress__bar" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
          </div>
        </>
      )}

      {!isInbound && productLineItems.length > 0 && (
        <div className="flex small soft mt-8" style={{ gap: '14px', flexWrap: 'wrap' }}>
          {productLineItems.slice(0, 4).map((li) => (
            <span key={li.id}>
              <span className="mono">{li.batchCode.value || '—'}</span>{' '}
              <strong style={{ color: li.fulfilled ? 'var(--success)' : 'var(--ink)' }}>
                {li.actualQuantity} / {expectedBags(li.uom, li.expectedQuantity.value, li.description.value)}
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
