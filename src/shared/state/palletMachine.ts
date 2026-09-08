export type PalletEvent = 'SCAN' | 'VERIFY';

/** Forward-only pallet lifecycle; repeated or out-of-order events are safe no-ops. */
export const transitionPallet = (currentState: string, event: PalletEvent) => {
  if (currentState === 'UNSCANNED' && event === 'SCAN') return 'SCANNED';
  if (currentState === 'SCANNED' && event === 'VERIFY') return 'VERIFIED';
  return currentState;
};
