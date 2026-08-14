import type { Picklist, PalletInspection, HandoffEntry } from '../shared';
import { expectedBags } from '../shared';
import { useT } from '../shared/i18n/LanguageContext';

export interface InspectorColorTheme {
  primary: string;
  bgTint: string;
  border: string;
  badgeBg: string;
  badgeText: string;
  lightBadgeBg: string;
  lightBadgeText: string;
}

export const INSPECTOR_PALETTES: InspectorColorTheme[] = [
  {
    primary: '#16a34a', // Emerald Green (1st Inspector)
    bgTint: 'rgba(22, 163, 74, 0.08)',
    border: '#16a34a',
    badgeBg: '#16a34a',
    badgeText: '#ffffff',
    lightBadgeBg: '#ecfdf5',
    lightBadgeText: '#15803d',
  },
  {
    primary: '#2563eb', // Royal Blue (2nd Inspector)
    bgTint: 'rgba(37, 99, 235, 0.08)',
    border: '#2563eb',
    badgeBg: '#2563eb',
    badgeText: '#ffffff',
    lightBadgeBg: '#eff6ff',
    lightBadgeText: '#1d4ed8',
  },
  {
    primary: '#7c3aed', // Violet / Purple (3rd Inspector)
    bgTint: 'rgba(124, 58, 237, 0.08)',
    border: '#7c3aed',
    badgeBg: '#7c3aed',
    badgeText: '#ffffff',
    lightBadgeBg: '#f5f3ff',
    lightBadgeText: '#6d28d9',
  },
  {
    primary: '#d97706', // Amber / Orange (4th Inspector)
    bgTint: 'rgba(217, 119, 6, 0.08)',
    border: '#d97706',
    badgeBg: '#d97706',
    badgeText: '#ffffff',
    lightBadgeBg: '#fffbeb',
    lightBadgeText: '#b45309',
  },
  {
    primary: '#0d9488', // Teal (5th Inspector)
    bgTint: 'rgba(13, 148, 136, 0.08)',
    border: '#0d9488',
    badgeBg: '#0d9488',
    badgeText: '#ffffff',
    lightBadgeBg: '#f0fdfa',
    lightBadgeText: '#0f766e',
  },
  {
    primary: '#db2777', // Pink / Rose (6th Inspector)
    bgTint: 'rgba(219, 39, 119, 0.08)',
    border: '#db2777',
    badgeBg: '#db2777',
    badgeText: '#ffffff',
    lightBadgeBg: '#fdf2f8',
    lightBadgeText: '#be185d',
  },
];

function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface Props {
  picklist: Picklist;
  pallets?: PalletInspection[];
  startedBy?: string;
  currentInspector?: string;
  handoffLog?: HandoffEntry[];
}

export function RunningTallyHeader({
  picklist,
  pallets = [],
  startedBy,
  currentInspector,
  handoffLog = [],
}: Props) {
  const t = useT();

  if (!picklist.lineItems || picklist.lineItems.length === 0) return null;

  // Build the list of distinct inspectors in chronological order
  const allInspectors: string[] = [];
  if (startedBy && !allInspectors.includes(startedBy)) allInspectors.push(startedBy);
  for (const h of handoffLog) {
    if (h.toInspector && !allInspectors.includes(h.toInspector)) allInspectors.push(h.toInspector);
  }
  for (const p of pallets) {
    if (p.scannedBy && !allInspectors.includes(p.scannedBy)) allInspectors.push(p.scannedBy);
  }
  if (currentInspector && !allInspectors.includes(currentInspector)) allInspectors.push(currentInspector);

  const hasMultipleInspectors = allInspectors.length > 1;

  const getInspectorTheme = (inspectorName?: string): InspectorColorTheme => {
    if (!inspectorName) return INSPECTOR_PALETTES[0];
    const index = allInspectors.indexOf(inspectorName);
    if (index === -1) return INSPECTOR_PALETTES[0];
    return INSPECTOR_PALETTES[index % INSPECTOR_PALETTES.length];
  };

  // The header counts bags, so each line's quantity is converted from its UOM
  // (1 PL → 60 bags, one 40USP SeedPak → 40) to match the scanned bag tally.
  const bagsExpected = (li: Picklist['lineItems'][number]) =>
    expectedBags(li.uom, li.expectedQuantity.value, li.description.value);

  const activeLineItems = picklist.lineItems.filter((li) => !li.cancelled);

  const totalExpected = activeLineItems.reduce((sum, li) => sum + bagsExpected(li), 0);
  const totalActual = activeLineItems.reduce((sum, li) => sum + li.actualQuantity, 0);
  const allFulfilled =
    activeLineItems.length > 0 && activeLineItems.every((li) => li.fulfilled);

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

          {/* Mini-legend if there are handoffs / multiple inspectors */}
          {hasMultipleInspectors && (
            <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              {allInspectors.map((name, i) => {
                const theme = INSPECTOR_PALETTES[i % INSPECTOR_PALETTES.length];
                const initials = getInitials(name);
                const isCurrent = name === currentInspector;
                return (
                  <span
                    key={name}
                    title={name}
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '1px 5px',
                      borderRadius: 4,
                      background: theme.lightBadgeBg,
                      color: theme.lightBadgeText,
                      border: `1px solid ${theme.border}50`,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: theme.primary,
                        display: 'inline-block',
                      }}
                    />
                    <span>{initials}</span>
                    {isCurrent && <span style={{ opacity: 0.7 }}>*</span>}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div className="tally__bars">
          {activeLineItems.map((li) => {
            const expected = bagsExpected(li);
            const actual = li.actualQuantity;
            const pct = expected ? Math.min(100, (actual / expected) * 100) : 0;
            const isAdjusted = Boolean(li.originalBatchCode || li.originalExpectedQuantity !== undefined);
            const status =
              actual === 0
                ? 'empty'
                : actual >= expected
                ? actual > expected
                  ? 'over'
                  : 'full'
                : 'short';
            const isComplete = status === 'full' || status === 'over';

            // Find pallets containing this batch
            const batchPallets = pallets.filter((p) =>
              p.batchSections.some(
                (bs) =>
                  bs.batchCode.value === li.batchCode.value && (bs.actualBagCount.value || 0) > 0
              )
            );

            // Determine the completing/primary inspector for this batch
            const lastPallet = batchPallets[batchPallets.length - 1];
            const primaryInspector = lastPallet?.scannedBy || startedBy || currentInspector;
            const theme = getInspectorTheme(primaryInspector);
            const initials = primaryInspector ? getInitials(primaryInspector) : '';

            // Unique contributing inspectors
            const contributingInspectors = [
              ...new Set(batchPallets.map((p) => p.scannedBy).filter(Boolean)),
            ] as string[];
            const isMultiScanned = contributingInspectors.length > 1;

            const cls = status === 'full' ? 'full' : status === 'over' ? 'over' : status === 'short' ? 'short' : '';

            const statusText =
              status === 'full'
                ? t('tally.barComplete', '✓ Complete')
                : status === 'over'
                ? t('tally.barOver', 'Over by {count}', { count: actual - expected })
                : status === 'empty'
                ? t('tally.barNeeded', '{count} needed', { count: expected })
                : t('tally.barMore', '{count} more', { count: expected - actual });

            // Dynamic styles when completed with different inspectors
            const barStyle: React.CSSProperties = {};
            const fillStyle: React.CSSProperties = { width: pct + '%' };
            const statusStyle: React.CSSProperties = {};

            if (isComplete && hasMultipleInspectors && primaryInspector) {
              barStyle.borderLeftColor = theme.border;
              barStyle.background = theme.bgTint;
              barStyle.borderRadius = 'var(--radius-sm)';
              barStyle.padding = '4px 8px 6px 10px';
              fillStyle.backgroundColor = theme.primary;
              statusStyle.color = theme.primary;
            }

            return (
              <div key={li.id} className={`tally__bar ${cls}`} style={barStyle}>
                <div
                  className="tally__bar-batch mono"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>{li.batchCode.value || '—'}</span>
                    {isAdjusted && (
                      <span
                        title={
                          li.originalBatchCode
                            ? t('tally.swappedFrom', 'Swapped from {orig}', { orig: li.originalBatchCode })
                            : t('tally.qtyAdjusted', 'Quantity adjusted')
                        }
                        style={{
                          fontSize: 10,
                          padding: '1px 3px',
                          borderRadius: 3,
                          background: 'var(--accent)',
                          color: '#fff',
                        }}
                      >
                        {t('tally.adjBadge', 'ADJ')}
                      </span>
                    )}
                  </div>

                  {/* Inspector badge for completed product if multiple inspectors exist */}
                  {isComplete && hasMultipleInspectors && primaryInspector && (
                    <span
                      title={
                        isMultiScanned
                          ? `Completed by ${primaryInspector} (contributed: ${contributingInspectors.join(', ')})`
                          : `Scanned by ${primaryInspector}`
                      }
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '1px 4px',
                        borderRadius: 3,
                        background: theme.lightBadgeBg,
                        color: theme.lightBadgeText,
                        border: `1px solid ${theme.border}60`,
                        letterSpacing: '0.04em',
                      }}
                    >
                      {initials}
                    </span>
                  )}
                </div>

                <div className="tally__bar-vals tnum">
                  {actual}
                  <span className="of"> / {expected}</span>
                </div>

                <div className="tally__bar-track">
                  <div className="tally__bar-fill" style={fillStyle}></div>
                </div>

                <div className="tally__bar-status" style={statusStyle}>
                  {statusText}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
