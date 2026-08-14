import { describe, it, expect } from 'vitest';
import { validateMediaSignature, MAX_PHOTO_SIZE_BYTES } from './middleware/mediaValidation';

describe('Media Validation & Magic Byte Signatures', () => {
  it('identifies and accepts valid JPEG magic bytes (FF D8 FF)', () => {
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const res = validateMediaSignature(jpegBuffer);
    expect(res.valid).toBe(true);
    expect(res.mediaType).toBe('image/jpeg');
  });

  it('identifies and accepts valid PNG magic bytes', () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const res = validateMediaSignature(pngBuffer);
    expect(res.valid).toBe(true);
    expect(res.mediaType).toBe('image/png');
  });

  it('identifies and accepts valid WebP magic bytes (RIFF....WEBP)', () => {
    const webpBuffer = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP'),
    ]);
    const res = validateMediaSignature(webpBuffer);
    expect(res.valid).toBe(true);
    expect(res.mediaType).toBe('image/webp');
  });

  it('identifies and accepts valid PDF magic bytes (%PDF)', () => {
    const pdfBuffer = Buffer.from('%PDF-1.4\n...');
    const res = validateMediaSignature(pdfBuffer);
    expect(res.valid).toBe(true);
    expect(res.mediaType).toBe('application/pdf');
  });

  it('rejects invalid/executable/script payloads claiming to be images', () => {
    const htmlBuffer = Buffer.from('<script>alert(1)</script>');
    const res = validateMediaSignature(htmlBuffer);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Unsupported or invalid media format');
  });

  it('rejects payloads exceeding 8 MB size limit', () => {
    const oversized = Buffer.alloc(MAX_PHOTO_SIZE_BYTES + 10);
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[2] = 0xff;
    const res = validateMediaSignature(oversized);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('exceeds maximum limit');
  });
});
