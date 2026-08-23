import type { NormalizedXyxy } from '../../features/bag-labeling/coordinates';
import type { CocoRle } from '../../features/bag-labeling/types';

export interface Sam3Proposal {
  id: string;
  score: number;
  bbox: NormalizedXyxy;
  segmentationRle: CocoRle;
  displayPolygon: number[][];
}

interface ProposalResponse {
  success: boolean;
  instances: Sam3Proposal[];
  modelVersion?: string;
}

export interface LocatePalletResponse {
  success: boolean;
  targetPalletBox?: NormalizedXyxy;
  confidence?: number | null;
  multiplePalletsVisible?: boolean;
  targetAmbiguous?: boolean;
  targetSelectionReason?: string | null;
  primaryFace?: 'front' | 'left' | 'right' | null;
  primaryFaceQuad?: [number, number][] | null;
  secondaryFacesVisible?: string[];
  yawDegrees?: number | null;
  pitchDegrees?: number | null;
  faceVisibility?: number | null;
  geometryConfidence?: number | null;
  safeToRectify?: boolean;
  reviewReason?: string | null;
  modelVersion?: string;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'));
    reader.readAsDataURL(blob);
  });
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const body = JSON.stringify(payload);
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body,
    });
    if (attempt >= 2 || ![429, 502, 503].includes(response.status)) break;
    const retryHeader = Number(response.headers.get('retry-after'));
    const baseMs = Number.isFinite(retryHeader) && retryHeader > 0
      ? retryHeader * 1000
      : Math.min(3000, 1000 * 2 ** attempt);
    await new Promise((resolve) => setTimeout(resolve, baseMs + Math.random() * 250));
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(detail?.error || `Vision request failed (${response.status})`);
  }
  return await response.json() as T;
}

export async function proposeBagFlaps(
  image: Blob,
  targetPalletBox: NormalizedXyxy,
  promptBoxes: readonly NormalizedXyxy[] = []
): Promise<ProposalResponse> {
  return postJson('/api/pallet-vision/propose-flaps', {
    image: await blobToDataUrl(image),
    targetPalletBox,
    promptBoxes,
    textPrompt: 'bag flap',
  });
}

export async function locateTargetPallet(image: Blob): Promise<LocatePalletResponse> {
  return postJson('/api/pallet-vision/locate-pallet', { image: await blobToDataUrl(image) });
}
