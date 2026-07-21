// Image quality checks.
//
// Browser-based detection of common photo issues. These run on every captured
// image before it's saved.

export type QualityIssueType = 'blurry' | 'too_dark' | 'too_bright' | 'low_contrast' | 'sideways';

export interface QualityIssue {
  type: QualityIssueType;
  severity: 'mild' | 'severe';
  /** Blocking issues cannot be kept — the photo MUST be retaken. */
  blocking?: boolean;
  message: string;
  score: number;
}

export interface QualityCheckResult {
  passed: boolean;
  issues: QualityIssue[];
  metrics: {
    blurScore: number;
    meanBrightness: number;
    stdDevBrightness: number;
  };
}

export interface QualityCheckOptions {
  /**
   * Skip the portrait-orientation check. Documents (BOL, picklist) and other
   * wide subjects are legitimately landscape, so enforcing portrait there just
   * produces false rejections.
   */
  allowLandscape?: boolean;
}

export async function checkImageQuality(
  blob: Blob,
  options: QualityCheckOptions = {}
): Promise<QualityCheckResult> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return {
      passed: true,
      issues: [],
      metrics: { blurScore: 0, meanBrightness: 0, stdDevBrightness: 0 },
    };
  }

  const maxEdge = 400;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      passed: true,
      issues: [],
      metrics: { blurScore: 0, meanBrightness: 0, stdDevBrightness: 0 },
    };
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);

  const blurScore = computeBlurScore(imageData);
  const { mean, stdDev } = computeBrightnessStats(imageData);

  const issues: QualityIssue[] = [];

  // Orientation warning (non-blocking). Wider-than-tall usually means the
  // device was held sideways — but this is unreliable: some devices/capture
  // paths drop EXIF orientation, so an upright shot can read as landscape.
  // We therefore WARN but always let the verifier keep it, and skip the check
  // entirely for documents (allowLandscape), which are legitimately wide.
  if (!options.allowLandscape && bitmap.width > bitmap.height) {
    issues.push({
      type: 'sideways',
      severity: 'mild',
      blocking: false,
      message:
        'This photo is wider than tall. If you held the device upright you can keep it; otherwise retake in portrait.',
      score: bitmap.width / bitmap.height,
    });
  }

  if (blurScore < 25) {
    issues.push({
      type: 'blurry',
      severity: 'severe',
      message: 'This photo looks very blurry. Make sure you held the camera steady.',
      score: blurScore,
    });
  } else if (blurScore < 60) {
    issues.push({
      type: 'blurry',
      severity: 'mild',
      message: 'This photo may be slightly out of focus. Check that everything is sharp.',
      score: blurScore,
    });
  }

  if (mean < 40) {
    issues.push({
      type: 'too_dark',
      severity: 'severe',
      message: 'The photo is very dark. Turn on more lights or use a flash.',
      score: mean,
    });
  } else if (mean < 70) {
    issues.push({
      type: 'too_dark',
      severity: 'mild',
      message: 'The photo looks a little dark. More light would help.',
      score: mean,
    });
  } else if (mean > 220) {
    issues.push({
      type: 'too_bright',
      severity: 'severe',
      message: 'The photo is overexposed. Try moving away from the light source.',
      score: mean,
    });
  }

  if (stdDev < 20 && mean > 50 && mean < 220) {
    issues.push({
      type: 'low_contrast',
      severity: 'mild',
      message: 'The photo has very low contrast. Make sure the subject is clearly visible.',
      score: stdDev,
    });
  }

  return {
    passed: issues.length === 0,
    issues,
    metrics: { blurScore, meanBrightness: mean, stdDevBrightness: stdDev },
  };
}

function computeBlurScore(imageData: ImageData): number {
  const { data, width, height } = imageData;

  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  const laplacian = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const val =
        4 * gray[i] -
        gray[i - 1] -
        gray[i + 1] -
        gray[i - width] -
        gray[i + width];
      laplacian[i] = val;
    }
  }

  let sum = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      sum += laplacian[y * width + x];
      count++;
    }
  }
  const mean = sum / count;

  let varSum = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const diff = laplacian[y * width + x] - mean;
      varSum += diff * diff;
    }
  }
  return varSum / count;
}

function computeBrightnessStats(imageData: ImageData): { mean: number; stdDev: number } {
  const { data } = imageData;
  const pixelCount = data.length / 4;
  let sum = 0;
  for (let i = 0; i < pixelCount; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    sum += 0.299 * r + 0.587 * g + 0.114 * b;
  }
  const mean = sum / pixelCount;

  let varSum = 0;
  for (let i = 0; i < pixelCount; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const diff = lum - mean;
    varSum += diff * diff;
  }
  const stdDev = Math.sqrt(varSum / pixelCount);

  return { mean, stdDev };
}
