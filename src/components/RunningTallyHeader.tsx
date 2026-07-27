import type { Picklist } from '../shared';
import { expectedBags } from '../shared';
import { useT } from '../shared/i18n/LanguageContext';

interface Props {
  picklist: Picklist;
}

export function RunningTallyHeader({ picklist }: Props) {
  const t = useT();

  if (!picklist.lineItems || picklist.lineItems.length === 0) return null;

  // The header counts bags, so each line's quantity is converted from its UOM
  // (1 PL → 60 bags, one 40USP SeedPak → 40) to match the scanned bag tally.
  const bagsExpected = (li: Picklist['lineItems'][number]) =>
    expectedBags(li.uom, li.expectedQuantity.value, li.description.value);

  const totalExpected = picklist.lineItems.reduce((sum, li) => sum + bagsExpected(li), 0);
  const totalActual = picklist.lineItems.reduce((sum, li) => sum + li.actualQuantity, 0);
  const allFulfilled =
    picklist.lineItems.length > 0 && picklist.lineItems.every((li) => li.fulfilled);

  return (
    <div className="tally">
      <div className="tally__inner">
        <div className="tally__total">
          <div className="tally__total-lbl">
            {allFulfilled ? t('tally.complete', 'Complete') : t('tally.totalBags', 'Total bags')}
          </div>
          <div className="tally__total-num tnum">
            {totalActual}
            <span className="of"> / {totalExpected}</span>
          </div>
        </div>

        <div className="tally__bars">
          {picklist.lineItems.map((li) => {
            const expected = bagsExpected(li);
            const actual = li.actualQuantity;
            const pct = expected ? Math.min(100, (actual / expected) * 100) : 0;
            const status =
              actual === 0
                ? 'empty'
                : actual >= expected
                ? actual > expected
                  ? 'over'
                  : 'full'
                : 'short';
            const cls = status === 'full' ? 'full' : status === 'over' ? 'over' : status === 'short' ? 'short' : '';

            const statusText =
              status === 'full'
                ? t('tally.barComplete', '✓ Complete')
                : status === 'over'
                ? t('tally.barOver', 'Over by {count}', { count: actual - expected })
                : status === 'empty'
                ? t('tally.barNeeded', '{count} needed', { count: expected })
                : t('tally.barMore', '{count} more', { count: expected - actual });

            return (
              <div key={li.id} className={`tally__bar ${cls}`}>
                <div className="tally__bar-batch mono">{li.batchCode.value || '—'}</div>
                <div className="tally__bar-vals tnum">
                  {actual}
                  <span className="of"> / {expected}</span>
                </div>
                <div className="tally__bar-track">
                  <div className="tally__bar-fill" style={{ width: pct + '%' }}></div>
                </div>
                <div className="tally__bar-status">{statusText}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
