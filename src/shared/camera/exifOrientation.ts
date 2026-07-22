// EXIF orientation normalization for captured photos.
//
// Why this exists: iPad cameras (and most phone cameras) write JPEGs with
// the sensor's raw pixel orientation, then add an EXIF Orientation tag
// (1–8) telling viewers how to rotate the pixels for display.

// ============================================================
// Parser — find EXIF Orientation tag in a JPEG byte stream
// ============================================================

export function parseExifOrientationFromBuffer(buf: ArrayBuffer): number {
  const view = new DataView(buf);
  if (view.byteLength < 2) return 1;
  if (view.getUint16(0, false) !== 0xffd8) return 1;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset, false);
    if ((marker & 0xff00) !== 0xff00) return 1;
    if (marker === 0xffda || marker === 0xffd9) return 1;
    if (marker === 0xffd8 || (marker >= 0xffd0 && marker <= 0xffd7)) {
      offset += 2;
      continue;
    }

    const segLen = view.getUint16(offset + 2, false);
    if (segLen < 2 || offset + 2 + segLen > view.byteLength) return 1;

    if (marker === 0xffe1) {
      if (offset + 4 + 6 <= view.byteLength) {
        const sig =
          (view.getUint32(offset + 4, false) === 0x45786966) &&
          view.getUint16(offset + 8, false) === 0x0000;
        if (sig) {
          const tiffStart = offset + 10;
          const result = readOrientationFromTiff(view, tiffStart);
          if (result !== null) return result;
          return 1;
        }
      }
    }

    offset += 2 + segLen;
  }
  return 1;
}

function readOrientationFromTiff(view: DataView, tiffStart: number): number | null {
  if (tiffStart + 8 > view.byteLength) return null;
  const byteOrder = view.getUint16(tiffStart, false);
  let little: boolean;
  if (byteOrder === 0x4949) little = true;
  else if (byteOrder === 0x4d4d) little = false;
  else return null;

  if (view.getUint16(tiffStart + 2, little) !== 0x002a) return null;
  const ifd0Offset = view.getUint32(tiffStart + 4, little);
  const ifd0 = tiffStart + ifd0Offset;
  if (ifd0 + 2 > view.byteLength) return null;

  const entryCount = view.getUint16(ifd0, little);
  for (let i = 0; i < entryCount; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > view.byteLength) return null;
    const tag = view.getUint16(entry, little);
    if (tag === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      if (value >= 1 && value <= 8) return value;
      return null;
    }
  }
  return null;
}

export async function readExifOrientation(blob: Blob): Promise<number> {
  const buf = await blob.slice(0, 65536).arrayBuffer();
  return parseExifOrientationFromBuffer(buf);
}

// ============================================================
// Canvas transform — apply EXIF orientation to drawing context
// ============================================================

export function uprightSizeForOrientation(
  orientation: number,
  srcW: number,
  srcH: number
): { w: number; h: number } {
  const swap = orientation >= 5 && orientation <= 8;
  return swap ? { w: srcH, h: srcW } : { w: srcW, h: srcH };
}

export function setOrientationTransform(
  ctx: CanvasRenderingContext2D,
  orientation: number,
  srcW: number,
  srcH: number,
  outW: number,
  outH: number
): void {
  const upright = uprightSizeForOrientation(orientation, srcW, srcH);
  const sx = outW / upright.w;
  const sy = outH / upright.h;

  switch (orientation) {
    case 2:
      ctx.setTransform(-sx, 0, 0, sy, outW, 0);
      break;
    case 3:
      ctx.setTransform(-sx, 0, 0, -sy, outW, outH);
      break;
    case 4:
      ctx.setTransform(sx, 0, 0, -sy, 0, outH);
      break;
    case 5:
      ctx.setTransform(0, sy, sx, 0, 0, 0);
      break;
    case 6:
      ctx.setTransform(0, sy, -sx, 0, outW, 0);
      break;
    case 7:
      ctx.setTransform(0, -sy, -sx, 0, outW, outH);
      break;
    case 8:
      ctx.setTransform(0, -sy, sx, 0, 0, outH);
      break;
    default:
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
  }
}

// ============================================================
// Browser probe — does createImageBitmap auto-apply EXIF?
// ============================================================

// We decode captured photos with `{ imageOrientation: 'none' }` and rotate them
// ourselves. But that option is not honoured everywhere — notably older iPad
// Safari, which silently auto-rotates regardless. There the pixels arrive
// already upright, our transform rotates them a SECOND time, and the saved
// photo lands sideways. So probe the behaviour once and skip our transform when
// the browser has already done the work.
let autoOrientProbe: Promise<boolean> | null = null;

export function browserAutoOrientsBitmaps(): Promise<boolean> {
  if (!autoOrientProbe) autoOrientProbe = probeAutoOrient();
  return autoOrientProbe;
}

/** Test-only: forget the cached probe result. */
export function resetAutoOrientProbe(): void {
  autoOrientProbe = null;
}

async function probeAutoOrient(): Promise<boolean> {
  try {
    const jpeg = await makeProbeJpeg();
    if (!jpeg) return false;
    const bitmap = await createImageBitmap(jpeg, { imageOrientation: 'none' });
    // The probe image is 2x1 pixels tagged EXIF orientation 6 (rotate 90°).
    // Upright it would be 1x2, so swapped dimensions mean the browser rotated
    // it for us and ignored our request not to.
    const swapped = bitmap.height > bitmap.width;
    bitmap.close?.();
    return swapped;
  } catch {
    // Can't tell (no canvas, decode failure). Assume the option is honoured,
    // which is the behaviour every modern browser has.
    return false;
  }
}

/** A 2x1 JPEG carrying an EXIF Orientation=6 tag. */
async function makeProbeJpeg(): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 2, 1);

  const plain = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9)
  );
  if (!plain) return null;

  const bytes = new Uint8Array(await plain.arrayBuffer());
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  // APP1 segment: marker, length (34), "Exif\0\0", then a little-endian TIFF
  // header with a single IFD0 entry — tag 0x0112 (Orientation), SHORT, value 6.
  const app1 = new Uint8Array([
    0xff, 0xe1, 0x00, 0x22,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);

  const out = new Uint8Array(bytes.length + app1.length);
  out.set(bytes.subarray(0, 2), 0);          // SOI
  out.set(app1, 2);                          // our APP1
  out.set(bytes.subarray(2), 2 + app1.length);
  return new Blob([out], { type: 'image/jpeg' });
}

export function mapPointThroughOrientation(
  orientation: number,
  srcW: number,
  srcH: number,
  x: number,
  y: number
): { x: number; y: number } {
  switch (orientation) {
    case 2: return { x: srcW - x, y };
    case 3: return { x: srcW - x, y: srcH - y };
    case 4: return { x, y: srcH - y };
    case 5: return { x: y, y: x };
    case 6: return { x: srcH - y, y: x };
    case 7: return { x: srcH - y, y: srcW - x };
    case 8: return { x: y, y: srcW - x };
    default: return { x, y };
  }
}
