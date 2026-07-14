import { useCallback, useRef } from 'react';
import {
  readExifOrientation,
  setOrientationTransform,
  uprightSizeForOrientation,
} from './exifOrientation';

/**
 * Cross-device photo capture.
 *
 * Uses native <input type="file" capture="environment">. Works on:
 *   - iPad Safari: opens rear camera directly
 *   - Android Chrome: prompts camera vs gallery
 *   - Desktop: opens file picker
 */
export function useCameraCapture(onCapture: (blob: Blob, originalBlob: Blob) => void) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const ensureInput = useCallback(() => {
    if (inputRef.current) return inputRef.current;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    input.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const downscaled = await downscaleAndNormalize(file, 1200);
      onCapture(downscaled, file);
      (e.target as HTMLInputElement).value = '';
    });
    document.body.appendChild(input);
    inputRef.current = input;
    return input;
  }, [onCapture]);

  return useCallback(() => {
    ensureInput().click();
  }, [ensureInput]);
}

async function downscaleAndNormalize(file: File, maxEdge: number): Promise<Blob> {
  const orientation = await readExifOrientation(file);
  const bitmap = await createImageBitmap(file, { imageOrientation: 'none' });

  const upright = uprightSizeForOrientation(orientation, bitmap.width, bitmap.height);
  const scale = Math.min(1, maxEdge / Math.max(upright.w, upright.h));
  const outW = Math.round(upright.w * scale);
  const outH = Math.round(upright.h * scale);

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d')!;
  setOrientationTransform(ctx, orientation, bitmap.width, bitmap.height, outW, outH);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  return new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.75)
  );
}
