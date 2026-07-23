// UOM packing rules for picklist line items.
//
// The picklist speaks SAP UOM codes (BG / SP / MB / PL / C62). Three of them
// need special handling before the floor can reconcile against them:
//
//   - SP (SeedPak) / MB (Minibulk): each is ONE physical unit, so a line of
//     "4 SP" is four separate totes. We explode it into four one-unit lines so
//     each can be scanned and reconciled on its own. How many bags a tote holds
//     (40 / 45 / 50) is encoded in the material description, not the UOM: SP is
//     a "…USP" token, MB is a "…UMB" token.
//   - PL (pallet): a full pallet is BAGS_PER_PALLET (60) bags.
//
// See the Uom doc comment in types/inspection.ts for the full code list.

import { generateId } from '../utils/uuid';
import { BAGS_PER_PALLET } from '../types/inspection';
import type { PicklistLineItemEntry } from '../types/inspection';

export type SpSize = 40 | 45 | 50;

/** Which tote a pack size was read off of. */
export type PackKind = 'SP' | 'MB';

export interface PackInfo {
  size: SpSize;
  kind: PackKind;
}

/**
 * Read a tote's bag count and kind out of a material description. SAP encodes
 * the count as a "…USP" token for SeedPaks ("40USP", "45USP", "40SCUSP") and a
 * "…UMB" token for Minibulks ("40SCUMB", "45SCUMB"); placards spell them "SP40"
 * / "MB40". Returns null when the description carries no recognizable size.
 */
export function parsePackInfo(description: string | null | undefined): PackInfo | null {
  if (!description) return null;
  const d = description.toUpperCase();
  let m = d.match(/(40|45|50)(?:SC)?USP/) || d.match(/SP\s*(40|45|50)\b/);
  if (m) return { size: Number(m[1]) as SpSize, kind: 'SP' };
  m = d.match(/(40|45|50)(?:SC)?UMB/) || d.match(/MB\s*(40|45|50)\b/);
  if (m) return { size: Number(m[1]) as SpSize, kind: 'MB' };
  return null;
}

/**
 * SeedPak bag count (40 / 45 / 50) from a material description, or null. A thin
 * wrapper over {@link parsePackInfo} that ignores Minibulk sizes — kept for the
 * SP-specific call sites.
 */
export function parseSpSize(description: string | null | undefined): SpSize | null {
  const info = parsePackInfo(description);
  return info && info.kind === 'SP' ? info.size : null;
}

/**
 * Bags contained in one unit of a given UOM, for a line with this description.
 *   BG/BAG → 1, PL → 60, SP/MB → its 40/45/50 tote size (null if
 *   undecipherable), C62/PCE → null (pallet unit / piece — no fixed bag count).
 */
export function bagsPerUnit(uom: string, description: string | null | undefined): number | null {
  switch (uom) {
    case 'BG':
    case 'BAG':
      return 1;
    case 'PL':
      return BAGS_PER_PALLET;
    case 'SP':
    case 'MB':
      return parsePackInfo(description)?.size ?? null;
    default:
      return null;
  }
}

/** True when a picklist line should be split into one line per unit: SP or MB. */
export function shouldExplode(uom: string): boolean {
  return uom === 'SP' || uom === 'MB';
}

/**
 * Expand a single picklist line into the lines that should actually be tracked.
 * An SP or MB line with expectedQuantity N becomes N one-unit lines (fresh ids,
 * qty 1) so each tote is scanned and reconciled individually. Every other UOM —
 * and any SP/MB line that is already a single unit or has no/'≤1' quantity —
 * passes through unchanged.
 */
export function explodePicklistLine(line: PicklistLineItemEntry): PicklistLineItemEntry[] {
  const qty = line.expectedQuantity.value;
  if (!shouldExplode(line.uom) || qty == null || qty <= 1) return [line];

  const count = Math.floor(qty);
  const out: PicklistLineItemEntry[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      ...line,
      // First copy keeps the original id so any prior reference still resolves.
      id: i === 0 ? line.id : generateId(),
      expectedQuantity: { ...line.expectedQuantity, value: 1 },
      actualQuantity: 0,
      fulfilled: false,
    });
  }
  return out;
}

/** Apply {@link explodePicklistLine} across a whole list of lines, in order. */
export function explodePicklistLines(lines: PicklistLineItemEntry[]): PicklistLineItemEntry[] {
  return lines.flatMap(explodePicklistLine);
}
