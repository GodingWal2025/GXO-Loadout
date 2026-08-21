import {
  decoderAlreadyRotated,
  orientationTransform,
  readJpegInfo,
} from '../../shared/services/jpegOrientation';

export interface CanonicalImage {
  blob: Blob;
  width: number;
  height: number;
  sha256: string;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode canonical JPEG'))),
      'image/jpeg',
      0.92
    );
  });
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Decode a phone photo to upright pixels and remove all EXIF metadata. */
export async function canonicalizeImage(file: Blob): Promise<CanonicalImage> {
  const bytes = await file.arrayBuffer();
  const info = readJpegInfo(bytes);
  const bitmap = await createImageBitmap(file);
  const alreadyRotated = decoderAlreadyRotated(info, bitmap.width, bitmap.height);
  const effectiveOrientation = alreadyRotated === false ? info.orientation : 1;
  const upright = orientationTransform(effectiveOrientation, bitmap.width, bitmap.height);

  const canvas = document.createElement('canvas');
  canvas.width = upright.width;
  canvas.height = upright.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  context.setTransform(...upright.transform);
  context.drawImage(bitmap, 0, 0);
  context.setTransform(1, 0, 0, 1, 0, 0);
  bitmap.close?.();

  const blob = await canvasToBlob(canvas);
  return { blob, width: canvas.width, height: canvas.height, sha256: await sha256Hex(blob) };
}
