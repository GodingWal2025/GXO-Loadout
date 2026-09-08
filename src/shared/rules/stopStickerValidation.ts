/** Accepts the printed warehouse sticker format: STOP- plus 4–8 letters/digits. */
export const isValidStopSticker = (stickerCode: string): boolean => {
  return /^STOP-[A-Z0-9]{4,8}$/.test(stickerCode);
};
