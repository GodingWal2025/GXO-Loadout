import type { NormalizedXyxy } from './coordinates';

export type PalletView = 'front' | 'side_1' | 'back' | 'side_2' | 'other';
export type DatasetSplit = 'train' | 'valid' | 'test';

export interface CocoRle {
  size: readonly [number, number];
  counts: string;
}

export interface BagFlapAnnotation {
  id: string;
  promptBox?: NormalizedXyxy;
  bbox: NormalizedXyxy;
  segmentationRle: CocoRle;
  displayPolygon: number[][];
  score?: number;
  status: 'proposed' | 'accepted' | 'rejected';
}

export interface PalletLabelPhoto {
  id: string;
  fileName: string;
  view: PalletView;
  width: number;
  height: number;
  sha256: string;
  targetPalletBox?: NormalizedXyxy;
  flaps: BagFlapAnnotation[];
  reviewed: boolean;
  blob: Blob;
  createdAt: string;
}

export interface PalletLabelGroup {
  id: string;
  displayName: string;
  split: DatasetSplit;
  photos: PalletLabelPhoto[];
  createdAt: string;
  updatedAt: string;
}

export interface DatasetManifest {
  schemaVersion: 1;
  createdAt: string;
  splitSalt: string;
  groups: Array<{
    id: string;
    displayName: string;
    split: DatasetSplit;
    photos: Array<{
      id: string;
      fileName: string;
      view: PalletView;
      width: number;
      height: number;
      sha256: string;
      reviewed: boolean;
      targetPalletBox?: NormalizedXyxy;
      acceptedFlaps: number;
    }>;
  }>;
}
