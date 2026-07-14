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
