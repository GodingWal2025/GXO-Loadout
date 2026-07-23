// Domain types for Loadout — GXO outbound inspection.
//
// Major design points:
//   - InspectionType lets us support outbound / returns / retag with different
//     workflows but shared infrastructure
//   - Load # === BOL # (unified, was previously separate)
//   - One Load can have many Delivery #s (one or many stops). Each pallet is
//     tagged to a Delivery.
//   - Picklist and BOL are captured separately and cross-referenced
//   - Suggestable<T> wrapper on ML-eligible fields tracks manual vs ml-accepted
//   - Two flagging systems: QualityFlag (3 levels) and MLTrainingFlag (photo)

export type InspectionType = 'outbound' | 'inbound' | 'returns' | 'retag';

export type PalletType =
  | 'Full Bag Pallet'
  | 'Partial Bag Pallet'
  | 'Mixed Bag Pallet'
  | 'Seedpak'
  | 'Minibulk';

export type YesNoNA = 'Yes' | 'No' | 'N/A';
export type PassFail = 'Pass' | 'Fail';

// ============================================================
// Unit of measure (picklist / BOL)
// ============================================================
//
// The printed picklist uses SAP's UOM codes, each with its own packing rule:
//   - BG   bags — the base unit, one physical bag
//   - SP   SeedPak — a single reusable tote. Each SP holds 40, 45, or 50 bags,
//          which one is encoded in the material description (a "40USP"/"45USP"/
//          "50USP" token). A picklist line of "4 SP" means four separate
//          SeedPaks, so it is exploded into four one-SP lines (see uomRules).
//   - MB   Minibulk — like SP, a single tote exploded one-per-unit. Its size
//          (40/45) is a "…UMB" token in the description ("40SCUMB"/"45SCUMB").
//   - PL   pallet — a full pallet of BAGS_PER_PALLET bags
//   - C62  pallet unit that carries no batch code, only a SKU + material
//          description
// BAG and PCE are legacy codes kept so records written before this union still
// open; new picklist entry uses the codes in PICKLIST_UOM_OPTIONS.
export type Uom = 'BG' | 'SP' | 'MB' | 'PL' | 'C62' | 'BAG' | 'PCE';

/** UOM codes offered when entering/editing a picklist line. */
export const PICKLIST_UOM_OPTIONS: Uom[] = ['BG', 'SP', 'MB', 'PL', 'C62'];

/** A full pallet (UOM "PL") is 60 bags. */
export const BAGS_PER_PALLET = 60;

// ============================================================
// Suggestable - ML-ready field wrapper
// ============================================================

export interface Suggestable<T> {
  value: T | null;
  source: 'manual' | 'empty' | 'ml';
  /** Model confidence (0..1) when source === 'ml'; undefined otherwise. */
  mlConfidence?: number;
  /** Identifier of the model/version that produced an 'ml' suggestion. */
  mlModelVersion?: string;
}

export function emptySuggestable<T>(): Suggestable<T> {
  return { value: null, source: 'empty' };
}

/** Build a Suggestable from an ML/OCR inference result (human confirms later). */
export function mlSuggestable<T>(
  value: T | null,
  opts?: { confidence?: number; modelVersion?: string }
): Suggestable<T> {
  return {
    value,
    source: 'ml',
    mlConfidence: opts?.confidence,
    mlModelVersion: opts?.modelVersion,
  };
}

// ============================================================
// Photo
// ============================================================

export interface InspectionPhoto {
  id: string;
  sharePointUrl?: string;
  sharePointOriginalUrl?: string;
  localBlobUrl?: string;
  capturedAt: string;
  capturedBy: string;
  category: PhotoCategory;
  palletIndex?: number;
  slotKey?: string; // e.g. 'side-front', 'bag-flap-1', 'placard'
  metadata: PhotoMetadata;
  qualityFlag?: QualityFlag;
}

export interface PhotoMetadata {
  deviceModel?: string;
  orientation?: 'portrait' | 'landscape';
  originalWidth?: number;
  originalHeight?: number;
  fileSizeBytes?: number;
  capturedAtFixedStation?: boolean;
}

export type PhotoCategory =
  | 'Picklist'
  | 'BOL'
  | 'CoverSheet'
  | 'Pallet_Side'
  | 'Pallet_BagFlap'
  | 'Pallet_Placard'
  | 'Pallet_LPN'
  | 'Pallet_GateSeal'
  | 'Staging_Overview'
  | 'Returns_BOL'
  | 'Returns_Damage_Assessment'
  | 'Staging_Final_Lane';



// ============================================================
// Flagging
// ============================================================

export type QualityFlagReason =
  | 'damaged_product'
  | 'wrong_or_missing_label'
  | 'wrong_batch_or_product_info'
  | 'quantity_discrepancy'
  | 'other';

export interface QualityFlag {
  flaggedAt: string;
  flaggedBy: string;
  reason: QualityFlagReason;
  otherReason?: string;
  notes?: string;
}


// ============================================================
// Pallet - now bound to a Delivery
// ============================================================

export interface BatchSection {
  // One section of a Mixed Bag Pallet (or the only batch of a Full/Partial)
  id: string;
  batchCode: Suggestable<string>;
  productName: Suggestable<string>;
  expectedBagCount: number; // read-only, derived from picklist
  actualBagCount: Suggestable<number>;
  bagFlapPhotoId?: string;
  // Layer-geometry helper: standard palletization is bagsPerLayer × layerCount.
  // Persisted so the computed count is reproducible and the inputs survive
  // navigation. Sagging/slumped bags make direct counting unreliable (even for
  // people), so this arithmetic is the primary count; the verifier confirms.
  bagsPerLayer?: number;
  layerCount?: number;
}

export interface PalletInspection {
  palletNumber: number;
  palletType: PalletType;
  deliveryId: string; // which delivery this pallet belongs to
  passInspection: PassFail;
  accuracyLabelAttached: YesNoNA;
  failureReason?: string;
  rejectedBagCount?: number;
  rejectedNotes?: string;
  lpnNumber?: string;
  findings?: string;

  // For Full/Partial: array of length 1
  // For Mixed: array of length 1-3 (inspector picks count upfront)
  batchSections: BatchSection[];
  batchCount: 1 | 2 | 3; // For mixed pallets - confirms how many sections expected

  photos: InspectionPhoto[];
  qualityFlag?: QualityFlag;
  completedAt?: string;

  // Handoff tracking: which inspector scanned this specific pallet
  scannedBy?: string;
  scannedAt?: string;
}

export interface HandoffEntry {
  at: string;
  fromInspector?: string;
  toInspector: string;
  // Pallet numbers that were completed under the previous inspector
  palletsCompletedByPrevious: number[];
}

// ============================================================
// Picklist (overall load)
// ============================================================

export interface Picklist {
  capturedAt?: string;
  capturedBy?: string;
  photoIds: string[];
  loadNumber: Suggestable<string>;
  shipDate: Suggestable<string>;
  carrier?: string;
  lineItems: PicklistLineItemEntry[];
  verifiedAt?: string;
  verifiedBy?: string;
}

export interface PicklistLineItemEntry {
  id: string;
  batchCode: Suggestable<string>;
  /**
   * Material / SKU number — the picklist calls it "Material", the floor calls
   * it "SKU", they are the same value. e.g. "91007244".
   */
  sku: Suggestable<string>;
  /** Material description. e.g. "C.CL.201-40VT4PRIB.SF2.40USP.UB.US". */
  description: Suggestable<string>;
  /**
   * @deprecated Records written before SKU and description were separate
   * fields. Migrated into `description` on load (see migratePicklistLine);
   * never written by new code, kept only so old rows still open.
   */
  productName?: Suggestable<string>;
  expectedQuantity: Suggestable<number>;
  uom: Uom;
  deliveryId?: string; // which delivery does this line belong to (after picklist/BOL cross-ref)
  actualQuantity: number;
  fulfilled: boolean;
}

// ============================================================
// BOL & Delivery
// ============================================================

export interface BOLData {
  capturedAt?: string;
  capturedBy?: string;
  photoIds: string[];
  loadNumber: Suggestable<string>;
  shipDate: Suggestable<string>;
  carrier?: string;
  numberOfStops?: number;
  isMultiStopLoad?: YesNoNA;
  placardMatchesBol?: YesNoNA;
  /**
   * Line items read from the BOL (via OCR or manual entry). The BOL has no
   * batch code — SAP only stamps batches after picking — so these key on SKU.
   * They're cross-referenced against the picklist to confirm the load matches.
   */
  lineItems: BOLLineItem[];
  deliveries: Delivery[];
  verifiedAt?: string;
  verifiedBy?: string;
}

export interface BOLLineItem {
  id: string;
  /** Material / SKU number — same value the picklist calls "Material". */
  sku: Suggestable<string>;
  description: Suggestable<string>;
  /** Quantity shipped for this SKU on this delivery/stop. */
  quantity: Suggestable<number>;
  uom: Uom;
  shipmentNumber: Suggestable<string>;
  deliveryNumber: Suggestable<string>;
  stopNumber: Suggestable<number>;
}

export interface ReturnsBOLData {
  capturedAt?: string;
  capturedBy?: string;
  photoIds: string[];
  bolNumber: Suggestable<string>;
  receivedDate: Suggestable<string>;
  expectedPallets54x40: Suggestable<number>;
  expectedPallets40x40: Suggestable<number>;
  expectedEmptySeedPaks: Suggestable<number>;
  expectedProductSeedPaks: Suggestable<number>;
  expectedBaggedProduct: Suggestable<number>;
  verifiedAt?: string;
  verifiedBy?: string;
}

export interface Delivery {
  id: string;
  deliveryNumber: string;
  stopNumber?: number;
  // Each delivery has its own slice of the picklist line items
  lineItemIds: string[];
}

// ============================================================
// Cross-reference between picklist and BOL
// ============================================================

export interface CrossReferenceResult {
  loadNumberMatches: boolean;
  shipDateMatches: boolean;
  lineItemDiscrepancies: LineItemDiscrepancy[];
  /** True when header fields agree AND there are no line-item discrepancies. */
  matches: boolean;
  computedAt: string;
}

/**
 * A per-SKU mismatch between the picklist and the BOL. Keyed on SKU because the
 * BOL carries no batch code (multiple picklist batches can share one SKU, so
 * their quantities are summed before comparing).
 */
export interface LineItemDiscrepancy {
  sku: string;
  description?: string;
  picklistQty?: number;
  bolQty?: number;
  kind: 'missing-on-picklist' | 'missing-on-bol' | 'qty-mismatch';
}

// ============================================================
// Inspection (parent record)
// ============================================================

export type InspectionStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FLAGGED' | 'CANCELLED';

export interface Inspection {
  id: string;
  type: InspectionType; // outbound / returns / retag
  siteId: string;
  status: InspectionStatus;

  // Inspector tracking. Picker and inspector are usually different people.
  // startedBy is the inspector who created the record. currentInspector is
  // who's currently scanning — changes when there's a handoff in the workspace.
  // All pallets record their own scannedBy at capture time.
  pickerName?: string;
  startedBy?: string;
  startedAt: string;
  completedBy?: string;
  completedAt?: string;
  lastEditedBy?: string;
  lastEditedAt?: string;
  currentInspector?: string; // changes during handoff
  handoffLog?: HandoffEntry[];

  stagingLocation?: string;

  picklist: Picklist;
  bol: BOLData;
  returnsBol?: ReturnsBOLData;
  returnsBrand?: 'Dekalb' | 'Channel';
  crossReference?: CrossReferenceResult;

  pallets: PalletInspection[];

  staging: StagingSection;

  qualityFlag?: QualityFlag;
  flaggedItemsCount: number;
  archived?: boolean;
  /** Admin tombstone. Set server-side by DELETE /api/inspections/{id}; clients
   *  drop the local record instead of storing it. Never hard-delete on the
   *  server — other devices would resurrect it on their next push. */
  deleted?: boolean;
  deletedAt?: string;
}

export interface StagingSection {
  stagingLocation: string;
  stagedCorrectly: YesNoNA;
  paperBagsProperlyStacked: YesNoNA;
  ltlPalletsSecured: YesNoNA;
  mixedPalletsLabeled: YesNoNA;
  multiStopStickersAttached: YesNoNA;
  palletQuantityMatchesBOL: YesNoNA;
  overviewPhotos: InspectionPhoto[];
  coverSheetPhotos: InspectionPhoto[];
  finalLanePhotos: InspectionPhoto[];
  // Packaging used (outbound only)
  pallets40x40Used?: number;
  pallets48x40Used?: number;
  seedpaksUsed?: number;
  otherPackagingNotes?: string;
}

// ============================================================
// Site & Inspector lists (admin-editable)
// ============================================================

export interface Site {
  id: string;
  name: string;
  address?: string;
  active: boolean;
  createdAt?: string;
}

export interface Inspector {
  id: string;
  name: string;
  siteId: string;
  active: boolean;
  /** Stamped on every write; drives the cross-device sync merge. */
  updatedAt?: string;
}

// ============================================================
// Photo requirements per pallet type
// ============================================================

export const PALLET_SIDE_SLOTS: { key: string; label: string }[] = [
  { key: 'side-front', label: 'Front' },
  { key: 'side-back', label: 'Back' },
  { key: 'side-left', label: 'Left' },
  { key: 'side-right', label: 'Right' },
];

export function getRequiredPhotoSlots(
  palletType: PalletType,
  batchCount: number
): { key: string; label: string; category: PhotoCategory }[] {
  const sides = PALLET_SIDE_SLOTS.map((s) => ({
    key: s.key,
    label: s.label,
    category: 'Pallet_Side' as PhotoCategory,
  }));

  if (palletType === 'Full Bag Pallet' || palletType === 'Partial Bag Pallet') {
    return [
      { key: 'bag-flap-1', label: 'Bag flap', category: 'Pallet_BagFlap' },
      ...sides,
    ];
  }

  if (palletType === 'Mixed Bag Pallet') {
    const flaps = [];
    for (let i = 0; i < batchCount; i++) {
      flaps.push({
        key: `bag-flap-${i + 1}`,
        label: `Bag flap ${i + 1}`,
        category: 'Pallet_BagFlap' as PhotoCategory,
      });
    }
    return [
      ...flaps,
      { key: 'placard', label: 'Placard', category: 'Pallet_Placard' },
      ...sides,
    ];
  }

  if (palletType === 'Seedpak' || palletType === 'Minibulk') {
    return [
      { key: 'lpn', label: 'LPN', category: 'Pallet_LPN' },
      { key: 'gate-seal', label: 'Gate seal', category: 'Pallet_GateSeal' },
      ...sides,
    ];
  }

  // Paper Bag
  return [
    { key: 'bag-flap-1', label: 'Bag flap', category: 'Pallet_BagFlap' },
    ...sides,
  ];
}

// ============================================================
// Display labels
// ============================================================

export const QUALITY_FLAG_REASONS: Record<QualityFlagReason, string> = {
  damaged_product: 'Damaged product / packaging',
  wrong_or_missing_label: 'Wrong or missing label',
  wrong_batch_or_product_info: 'Wrong batch / product info',
  quantity_discrepancy: 'Quantity discrepancy',
  other: 'Other',
};

export const PALLET_TYPES: PalletType[] = [
  'Full Bag Pallet',
  'Partial Bag Pallet',
  'Mixed Bag Pallet',
  'Seedpak',
  'Minibulk',
];

export const INSPECTION_TYPE_LABELS: Record<InspectionType, string> = {
  outbound: 'Outbound',
  inbound: 'Inbound',
  returns: 'Returns',
  retag: 'Retag',
};

export const INSPECTION_TYPE_DESCRIPTIONS: Record<InspectionType, string> = {
  outbound: 'Verify a load against the printed picklist before it ships.',
  inbound: 'Receive and verify incoming loads.',
  returns: 'Process returned product back into inventory.',
  retag: 'Re-label or correct existing inventory.',
};
