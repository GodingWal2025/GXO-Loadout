import { describe, expect, it } from 'vitest';
import {
  decoderAlreadyRotated,
  orientationTransform,
  readJpegInfo,
  swapsAxes,
} from './jpegOrientation';

/**
 * Build a minimal but structurally valid JPEG: SOI, an APP1/Exif segment holding
 * one Orientation tag, an SOF0 frame header, EOI. Enough for the byte parser,
 * with no binary fixtures to keep in the repo.
 */
function buildJpeg(opts: {
  orientation?: number;
  width: number;
  height: number;
  bigEndian?: boolean;
  omitExif?: boolean;
}): Uint8Array {
  const { orientation = 1, width, height, bigEndian = false, omitExif = false } = opts;
  const out: number[] = [0xff, 0xd8];

  if (!omitExif) {
    const u16 = (v: number) => (bigEndian ? [(v >> 8) & 0xff, v & 0xff] : [v & 0xff, (v >> 8) & 0xff]);
    const u32 = (v: number) =>
      bigEndian
        ? [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
        : [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];

    const tiff = [
      ...(bigEndian ? [0x4d, 0x4d] : [0x49, 0x49]),
      ...u16(0x2a),
      ...u32(8), // IFD0 begins right after the 8-byte header
      ...u16(1), // one entry
      ...u16(0x0112), // Orientation
      ...u16(3), // SHORT
      ...u32(1), // count
      ...u16(orientation),
      0x00,
      0x00, // pad the 4-byte value field
      ...u32(0), // no next IFD
    ];
    const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0"
    const len = payload.length + 2;
    out.push(0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload);
  }

  // SOF0: length, precision, height, width, 1 component
  out.push(
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00
  );
  out.push(0xff, 0xd9);
  return new Uint8Array(out);
}

describe('readJpegInfo', () => {
  it('reads orientation 6 and the encoded size from a little-endian Exif block', () => {
    // Matches the real sample photos: 3264x2448 sensor frame, orientation 6.
    const info = readJpegInfo(buildJpeg({ orientation: 6, width: 3264, height: 2448 }));
    expect(info).toEqual({ orientation: 6, rawWidth: 3264, rawHeight: 2448 });
  });

  it('reads a big-endian ("MM") Exif block', () => {
    const info = readJpegInfo(buildJpeg({ orientation: 8, width: 4000, height: 3000, bigEndian: true }));
    expect(info.orientation).toBe(8);
    expect(info.rawWidth).toBe(4000);
  });

  it('defaults to orientation 1 when there is no Exif segment', () => {
    const info = readJpegInfo(buildJpeg({ width: 800, height: 600, omitExif: true }));
    expect(info).toEqual({ orientation: 1, rawWidth: 800, rawHeight: 600 });
  });

  it('returns the neutral result for non-JPEG bytes instead of throwing', () => {
    expect(readJpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toEqual({
      orientation: 1,
      rawWidth: 0,
      rawHeight: 0,
    });
    expect(readJpegInfo(new Uint8Array([]))).toEqual({
      orientation: 1,
      rawWidth: 0,
      rawHeight: 0,
    });
  });

  it('does not throw on a truncated Exif segment', () => {
    const full = buildJpeg({ orientation: 6, width: 3264, height: 2448 });
    expect(() => readJpegInfo(full.slice(0, 12))).not.toThrow();
  });

  it('rejects an out-of-range orientation value', () => {
    expect(readJpegInfo(buildJpeg({ orientation: 99, width: 100, height: 100 })).orientation).toBe(1);
  });
});

describe('swapsAxes', () => {
  it('is true only for the 90/270-degree orientations', () => {
    expect([1, 2, 3, 4].map(swapsAxes)).toEqual([false, false, false, false]);
    expect([5, 6, 7, 8].map(swapsAxes)).toEqual([true, true, true, true]);
  });
});

describe('decoderAlreadyRotated', () => {
  const info = { orientation: 6, rawWidth: 3264, rawHeight: 2448 };

  it('detects a decoder that ignored the tag (dimensions match the encoded frame)', () => {
    expect(decoderAlreadyRotated(info, 3264, 2448)).toBe(false);
  });

  it('detects a decoder that applied the tag (dimensions came back swapped)', () => {
    expect(decoderAlreadyRotated(info, 2448, 3264)).toBe(true);
  });

  it('reports no rotation needed when the orientation does not swap axes', () => {
    expect(decoderAlreadyRotated({ orientation: 1, rawWidth: 800, rawHeight: 600 }, 800, 600)).toBe(
      false
    );
  });

  it('is undecidable for square frames, so the caller leaves pixels alone', () => {
    expect(decoderAlreadyRotated({ orientation: 6, rawWidth: 900, rawHeight: 900 }, 900, 900)).toBeNull();
  });

  it('is undecidable without encoded dimensions', () => {
    expect(decoderAlreadyRotated({ orientation: 6, rawWidth: 0, rawHeight: 0 }, 100, 200)).toBeNull();
  });

  it('is undecidable when the decode was resampled to neither size', () => {
    expect(decoderAlreadyRotated(info, 1024, 768)).toBeNull();
  });
});

describe('orientationTransform', () => {
  it('leaves an upright image untouched', () => {
    expect(orientationTransform(1, 800, 600)).toEqual({
      width: 800,
      height: 600,
      transform: [1, 0, 0, 1, 0, 0],
    });
  });

  it('swaps the canvas dimensions for a 90-degree rotation', () => {
    // The production case: 3264x2448 encoded, orientation 6 -> upright portrait.
    expect(orientationTransform(6, 3264, 2448)).toEqual({
      width: 2448,
      height: 3264,
      transform: [0, 1, -1, 0, 2448, 0],
    });
    expect(orientationTransform(8, 3264, 2448).width).toBe(2448);
  });

  it('keeps dimensions for mirrors and 180-degree rotation', () => {
    for (const o of [2, 3, 4]) {
      const t = orientationTransform(o, 800, 600);
      expect([t.width, t.height]).toEqual([800, 600]);
    }
  });

  it('maps each rotating orientation corner-to-corner without leaving the canvas', () => {
    // Apply the transform to all four source corners; every result must land
    // inside the destination canvas. Catches sign/offset slips in the tuples.
    const w = 40;
    const h = 10;
    for (const o of [2, 3, 4, 5, 6, 7, 8]) {
      const { width, height, transform } = orientationTransform(o, w, h);
      const [a, b, c, d, e, f] = transform;
      for (const [x, y] of [
        [0, 0],
        [w, 0],
        [0, h],
        [w, h],
      ]) {
        const px = a * x + c * y + e;
        const py = b * x + d * y + f;
        expect(px).toBeGreaterThanOrEqual(-0.001);
        expect(px).toBeLessThanOrEqual(width + 0.001);
        expect(py).toBeGreaterThanOrEqual(-0.001);
        expect(py).toBeLessThanOrEqual(height + 0.001);
      }
    }
  });
});
