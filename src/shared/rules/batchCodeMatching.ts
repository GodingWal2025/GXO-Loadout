export const isBatchCodeValid = (expectedCode: string, scannedCode: string): boolean => {
  if (!expectedCode || !scannedCode) return false;
  return expectedCode.trim().toUpperCase() === scannedCode.trim().toUpperCase();
};
