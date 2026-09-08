import { InspectionStatus } from '../types/inspection';

export type InspectionEvent = 'START' | 'COMPLETE' | 'CANCEL';

/**
 * Defines the allowed inspection lifecycle without side effects. Invalid or
 * duplicate events are intentional no-ops, which makes retries safe.
 */
export const transitionInspection = (currentState: InspectionStatus, event: InspectionEvent): InspectionStatus => {
  if (currentState === 'PENDING' && event === 'START') return 'IN_PROGRESS';
  if (currentState === 'IN_PROGRESS' && event === 'COMPLETE') return 'COMPLETED';
  if (event === 'CANCEL') return 'CANCELLED';
  return currentState;
};
