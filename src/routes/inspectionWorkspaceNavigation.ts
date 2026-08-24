import type { Inspection } from '../shared';

/**
 * Only inbound inspections use a different workspace route. Completed and
 * flagged outbound/returns loads must remain accessible in view or edit mode.
 */
export function getInspectionWorkspaceRedirect(
  inspection: Pick<Inspection, 'id' | 'type' | 'status'>
): string | null {
  if (inspection.type === 'inbound') {
    return `/inspection/${inspection.id}/verify-inbound`;
  }
  return null;
}
