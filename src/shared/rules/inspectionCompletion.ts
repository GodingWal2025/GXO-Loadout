import { Inspection } from '../types/inspection';
export const isInspectionComplete = (inspection: Inspection): boolean => {
  return inspection.status === 'COMPLETED' || inspection.status === 'FLAGGED';
};
