import { useEffect, useState } from 'react';
import { checkImageQuality, type QualityCheckOptions, type QualityIssue } from './imageQuality';
import { useCameraCapture } from './useCameraCapture';

interface PendingCapture {
  blob: Blob;
  previewUrl: string;
  issues: QualityIssue[];
}

/**
 * Share the capture → quality review → save flow across inspection screens.
 * The caller saves accepted photos; this hook owns only the temporary preview.
 * Documents can opt into landscape capture without changing pallet-photo rules.
 */
export function useQualityCheckedCapture(
  onAccept: (blob: Blob) => Promise<void>,
  options: QualityCheckOptions = {},
) {
  const [pending, setPending] = useState<PendingCapture | null>(null);

  // Release the preview when it is replaced, dismissed, or the route unmounts.
  useEffect(() => {
    if (!pending) return;
    return () => URL.revokeObjectURL(pending.previewUrl);
  }, [pending]);

  const capture = useCameraCapture(async (blob) => {
    const quality = await checkImageQuality(blob, options);
    if (!quality.passed) {
      setPending({ blob, previewUrl: URL.createObjectURL(blob), issues: quality.issues });
      return;
    }
    await onAccept(blob);
  });

  function handleRetake() {
    setPending(null);
    // Let the quality dialog close before reopening the native camera picker.
    setTimeout(capture, 50);
  }

  async function handleKeep() {
    if (!pending) return;
    const { blob } = pending;
    setPending(null);
    await onAccept(blob);
  }

  return { capture, pending, handleRetake, handleKeep };
}
