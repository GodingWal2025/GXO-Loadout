import { useCallback, useRef } from 'react';
import {
  browserOrientsByDefault,
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

  // The <input> is created once and its change listener is bound once, but
  // `onCapture` is a fresh closure every render (it captures the caller's
  // latest state — e.g. the pages already saved). Route it through a ref so the
  // listener always calls the CURRENT callback. Without this the listener stays
  // pinned to the first render's closure, so each new page appends to stale
  // state and overwrites the pages captured before it.
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;

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
      onCaptureRef.current(downscaled, file);
      (e.target as HTMLInputElement).value = '';
    });
    document.body.appendChild(input);
    inputRef.current = input;
    return input;
  }, []);

  return useCallback(() => {
    ensureInput().click();
  }, [ensureInput]);
}

async function downscaleAndNormalize(file: File, maxEdge: number): Promise<Blob> {
  // Prefer the browser's own EXIF handling: it reads the tag natively, so it
  // can't miss one the way our parser can, and it removes any chance of
  // rotating an already-upright frame a second time. We only parse and rotate
  // ourselves on a browser that doesn't orient by default.
  const browserOrients = await browserOrientsByDefault();
  const orientation = browserOrients ? 1 : await readExifOrientation(file);
  const bitmap = browserOrients
    ? await createImageBitmap(file)
    : await createImageBitmap(file, { imageOrientation: 'none' });

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
