// Media validation: magic bytes / signatures and size limits

export const MAX_PHOTO_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

export type SupportedMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

export interface MediaValidationResult {
  valid: boolean;
  mediaType?: SupportedMediaType;
  error?: string;
}

/**
 * Validates buffer against file signatures (magic bytes) to ensure uploaded data is authentic.
 * - JPEG: FF D8 FF
 * - PNG: 89 50 4E 47 0D 0A 1A 0A
 * - WebP: 52 49 46 46 .... 57 45 42 50 (RIFF....WEBP)
 * - PDF: 25 50 44 46 (%PDF)
 */
export function validateMediaSignature(
  buffer: Buffer,
  allowedTypes: SupportedMediaType[] = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
): MediaValidationResult {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Empty media payload' };
  }

  if (buffer.length > MAX_PHOTO_SIZE_BYTES) {
    return { valid: false, error: `Media exceeds maximum limit of 8 MB (${buffer.length} bytes)` };
  }

  // Check JPEG (FF D8 FF)
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    if (allowedTypes.includes('image/jpeg')) {
      return { valid: true, mediaType: 'image/jpeg' };
    }
  }

  // Check PNG (89 50 4E 47 0D 0A 1A 0A)
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    if (allowedTypes.includes('image/png')) {
      return { valid: true, mediaType: 'image/png' };
    }
  }

  // Check WebP (RIFF .... WEBP)
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    if (allowedTypes.includes('image/webp')) {
      return { valid: true, mediaType: 'image/webp' };
    }
  }

  // Check PDF (%PDF)
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === '%PDF') {
    if (allowedTypes.includes('application/pdf')) {
      return { valid: true, mediaType: 'application/pdf' };
    }
  }

  return {
    valid: false,
    error: `Unsupported or invalid media format (must be JPEG, PNG, WebP, or PDF)`,
  };
}
