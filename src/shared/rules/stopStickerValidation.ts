export const isValidStopSticker = (stickerCode: string): boolean => {
  return /^STOP-[A-Z0-9]{4,8}$/.test(stickerCode);
};
