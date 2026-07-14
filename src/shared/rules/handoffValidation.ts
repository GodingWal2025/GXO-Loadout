export const isValidHandoff = (fromInspectorId: string, toInspectorId: string): boolean => {
  return fromInspectorId !== toInspectorId && Boolean(fromInspectorId) && Boolean(toInspectorId);
};
