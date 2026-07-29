// Reading a JPEG's EXIF orientation and encoded size straight from the bytes.
//
// Why not just trust the browser: `createImageBitmap`'s `imageOrientation`
// default flipped between spec revisions ('none' originally, 'from-image' later),
// older iOS Safari ignores the option entirely, and `<img>` decoding applies
// orientation on its own. So "did the decoder already rotate this?" is not
// answerable a priori across the phones on a warehouse floor.
//
// It IS answerable after the fact: compare the decoded dimensions against the
// size recorded in the JPEG's own SOF marker. If they came back swapped, the
// decoder rotated; if they match, it didn't. That makes the correction
// deterministic on every browser, and testable without one.
//
// This matters because the pallet layer count is read off the VERTICAL axis. A
// sideways frame doesn't fail loudly — it returns a confident, wrong number that
// a verifier may accept.

export interface JpegInfo {
  /** EXIF orientation 1-8; 1 when absent or unparseable. */
  orientation: number;
  /** Size as encoded in the SOF marker (pre-rotation). 0 when unparseable. */
  rawWidth: number;
  rawHeight: number;
}

const EXIF_ORIENTATION_TAG = 0x0112;

/** Markers carrying frame dimensions. Excludes DHT (C4), JPG (C8), DAC (CC). */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function readUint16(bytes: Uint8Array, at: number, littleEndian: boolean): number {
  return littleEndian
    ? bytes[at] | (bytes[at + 1] << 8)
    : (bytes[at] << 8) | bytes[at + 1];
}

function readUint32(bytes: Uint8Array, at: number, littleEndian: boolean): number {
  return littleEndian
    ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
    : ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

/** Pull orientation out of an APP1/Exif payload starting at the "Exif\0\0" tag. */
function parseExifOrientation(bytes: Uint8Array, exifStart: number, exifEnd: number): number {
  const tiff = exifStart + 6; // skip "Exif\0\0"
  if (tiff + 8 > exifEnd) return 1;

  const byteOrder = readUint16(bytes, tiff, false);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return 1; // not "II" or "MM"
  const le = byteOrder === 0x4949;

  const ifdOffset = readUint32(bytes, tiff + 4, le);
  const ifd = tiff + ifdOffset;
  if (ifd + 2 > exifEnd) return 1;

  const entryCount = readUint16(bytes, ifd, le);
  for (let i = 0; i < entryCount; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > exifEnd) break;
    if (readUint16(bytes, entry, le) === EXIF_ORIENTATION_TAG) {
      // SHORT value sits in the first 2 bytes of the 4-byte value field.
      const value = readUint16(bytes, entry + 8, le);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/**
 * Walk the JPEG segment chain for the EXIF orientation and SOF dimensions.
 * Returns orientation 1 / zero dimensions for non-JPEG or malformed input —
 * callers treat that as "no correction known".
 */
export function readJpegInfo(buffer: ArrayBuffer | Uint8Array): JpegInfo {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const fallback: JpegInfo = { orientation: 1, rawWidth: 0, rawHeight: 0 };

  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return fallback;

  let orientation = 1;
  let rawWidth = 0;
  let rawHeight = 0;

  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) {
      at++; // resync past padding
      continue;
    }
    const marker = bytes[at + 1];

    // Standalone markers carry no length payload.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    // End of image, or start of entropy-coded scan — nothing more to read.
    if (marker === 0xd9 || marker === 0xda) break;

    const length = readUint16(bytes, at + 2, false);
    if (length < 2) break;
    const segStart = at + 4;
    const segEnd = Math.min(at + 2 + length, bytes.length);

    if (
      marker === 0xe1 &&
      segStart + 6 <= segEnd &&
      bytes[segStart] === 0x45 && // E
      bytes[segStart + 1] === 0x78 && // x
      bytes[segStart + 2] === 0x69 && // i
      bytes[segStart + 3] === 0x66 && // f
      bytes[segStart + 4] === 0x00
    ) {
      orientation = parseExifOrientation(bytes, segStart, segEnd);
    } else if (isStartOfFrame(marker) && segStart + 5 <= segEnd) {
      rawHeight = readUint16(bytes, segStart + 1, false);
      rawWidth = readUint16(bytes, segStart + 3, false);
    }

    if (orientation !== 1 && rawWidth > 0) break; // have everything we need
    at = at + 2 + length;
  }

  return { orientation, rawWidth, rawHeight };
}

/** True for the orientations that swap width and height (90°/270° rotations). */
export function swapsAxes(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

/**
 * Whether the decoder already applied EXIF orientation, inferred by comparing
 * the decoded size to the encoded size.
 *
 * `null` means undecidable — square frames, or missing SOF dimensions — in which
 * case the caller should leave the pixels alone rather than risk a wrong rotation.
 */
export function decoderAlreadyRotated(
  info: JpegInfo,
  decodedWidth: number,
  decodedHeight: number
): boolean | null {
  if (!swapsAxes(info.orientation)) return false; // no swap to detect
  if (!info.rawWidth || !info.rawHeight) return null;
  if (info.rawWidth === info.rawHeight) return null; // square: swap is invisible

  if (decodedWidth === info.rawWidth && decodedHeight === info.rawHeight) return false;
  if (decodedWidth === info.rawHeight && decodedHeight === info.rawWidth) return true;
  return null; // resampled or otherwise unexpected — don't guess
}

/**
 * Canvas setup that renders `orientation` upright.
 *
 * `transform` is a setTransform() tuple [a, b, c, d, e, f] mapping the source
 * frame onto a canvas of the returned size; draw the image at (0, 0) after
 * applying it.
 */
export function orientationTransform(
  orientation: number,
  width: number,
  height: number
): { width: number; height: number; transform: [number, number, number, number, number, number] } {
  switch (orientation) {
    case 2: // horizontal mirror
      return { width, height, transform: [-1, 0, 0, 1, width, 0] };
    case 3: // 180°
      return { width, height, transform: [-1, 0, 0, -1, width, height] };
    case 4: // vertical mirror
      return { width, height, transform: [1, 0, 0, -1, 0, height] };
    case 5: // transpose
      return { width: height, height: width, transform: [0, 1, 1, 0, 0, 0] };
    case 6: // 90° clockwise
      return { width: height, height: width, transform: [0, 1, -1, 0, height, 0] };
    case 7: // transverse
      return { width: height, height: width, transform: [0, -1, -1, 0, height, width] };
    case 8: // 90° counter-clockwise
      return { width: height, height: width, transform: [0, -1, 1, 0, 0, width] };
    default: // 1, or anything unrecognized
      return { width, height, transform: [1, 0, 0, 1, 0, 0] };
  }
}
