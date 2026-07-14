export type PalletEvent = 'SCAN' | 'VERIFY';
export const transitionPallet = (currentState: string, event: PalletEvent) => {
  if (currentState === 'UNSCANNED' && event === 'SCAN') return 'SCANNED';
  if (currentState === 'SCANNED' && event === 'VERIFY') return 'VERIFIED';
  return currentState;
};
