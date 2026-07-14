export const validatePhotoQuality = (photoSizeInBytes: number, isBlurry: boolean): boolean => {
  const MIN_SIZE = 100 * 1024; // 100kb
  if (photoSizeInBytes < MIN_SIZE) return false;
  if (isBlurry) return false;
  return true;
};
