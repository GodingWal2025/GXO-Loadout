/**
 * Client-side photo compression utility.
 *
 * Resizes the image to a max edge and iteratively reduces JPEG quality
 * until the output is under the target file size.
 */

interface CompressOptions {
  maxEdge?: number;
  targetSizeKB?: number;
  initialQuality?: number;
  minQuality?: number;
}

export async function compressPhoto(
  blob: Blob,
  options?: CompressOptions
): Promise<Blob> {
  const {
    maxEdge = 1200,
    targetSizeKB = 300,
    initialQuality = 0.80,
    minQuality = 0.40,
  } = options || {};

  const targetBytes = targetSizeKB * 1024;

  if (blob.size <= targetBytes) {
    return blob;
  }

  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const outW = Math.round(bitmap.width * scale);
  const outH = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, outW, outH);
  bitmap.close?.();

  let quality = initialQuality;
  let result: Blob | null = null;

  while (quality >= minQuality) {
    result = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/jpeg', quality)
    );

    if (result.size <= targetBytes) {
      break;
    }

    quality -= 0.10;
  }

  if (!result) {
    result = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/jpeg', minQuality)
    );
  }

  return result;
}
