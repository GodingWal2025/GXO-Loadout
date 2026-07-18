import { useCallback, useEffect, useState } from 'react';
import type { Inspection, InspectionStatus } from '../types/inspection';

const LOCKED_STATUSES: InspectionStatus[] = ['COMPLETED', 'FLAGGED', 'CANCELLED'];

export function isInspectionLocked(status: InspectionStatus) {
  return LOCKED_STATUSES.includes(status);
}

const storageKey = (id: string) => `gxo:edit-mode:${id}`;

function readStored(id: string) {
  try {
    return sessionStorage.getItem(storageKey(id)) === 'edit';
  } catch {
    return false;
  }
}

/**
 * A finished inspection opens in view mode so nobody edits it by accident.
 * The corner toggle flips it into edit mode, and that choice has to survive
 * navigating between the workspace and the pallet screens — they are separate
 * routes that each mount their own state — so it lives in sessionStorage.
 */
export function useInspectionMode(inspection: Pick<Inspection, 'id' | 'status'>) {
  const locked = isInspectionLocked(inspection.status);
  const [editing, setEditing] = useState(() => (locked ? readStored(inspection.id) : true));

  useEffect(() => {
    setEditing(locked ? readStored(inspection.id) : true);
  }, [locked, inspection.id]);

  const changeEditing = useCallback(
    (next: boolean) => {
      setEditing(next);
      if (!locked) return;
      try {
        sessionStorage.setItem(storageKey(inspection.id), next ? 'edit' : 'view');
      } catch {
        // sessionStorage unavailable (private mode) — mode just won't persist
      }
    },
    [locked, inspection.id]
  );

  return {
    /** True once the inspection is completed/flagged/cancelled. */
    locked,
    editing,
    readOnly: locked && !editing,
    setEditing: changeEditing,
  };
}
