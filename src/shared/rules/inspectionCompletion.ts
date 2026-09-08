import { Inspection } from '../types/inspection';

/** FLAGGED is terminal too: it means the inspection finished with issues to review. */
export const isInspectionComplete = (inspection: Inspection): boolean => {
  return inspection.status === 'COMPLETED' || inspection.status === 'FLAGGED';
};
