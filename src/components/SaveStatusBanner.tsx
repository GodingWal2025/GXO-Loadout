import { useEffect } from 'react';
import { getLocalSaveState } from '../shared/services/localSave';

/**
 * Invisible application-level guard for outstanding IndexedDB writes. The former
 * visual save banner was removed, but this listener still prevents a tab close
 * from discarding a pending or failed local save.
 */
export function SaveStatusBanner() {
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const state = getLocalSaveState();
      if (state.pending || state.failed) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  return null;
}
