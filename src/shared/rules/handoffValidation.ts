/** A handoff requires two real, different inspectors; names are validated elsewhere. */
export const isValidHandoff = (fromInspectorId: string, toInspectorId: string): boolean => {
  return fromInspectorId !== toInspectorId && Boolean(fromInspectorId) && Boolean(toInspectorId);
};
