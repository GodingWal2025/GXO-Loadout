import { PALLET_PHOTO_REQUIREMENTS, RETURNS_PALLET_PHOTO_REQUIREMENTS, getPhotoLabel, type PalletType, type InspectionPhoto, type QualityFlag } from '../shared';
import { SlotPhotoCapture } from '../shared';

interface Props {
  palletType: PalletType;
  inspectionId: string;
  palletIndex: number;
  isReturns: boolean;
  currentUser: string;
  photos: InspectionPhoto[];
  onCaptured: (slotKey: string, photo: InspectionPhoto) => void;
  onQualityFlag: (photoId: string, flag: QualityFlag | undefined) => void;
  readOnly?: boolean;
  batchCount?: number;
}

export function DynamicPhotoChecklist({
  palletType,
  inspectionId,
  palletIndex,
  isReturns,
  currentUser,
  photos,
  onCaptured,
  onQualityFlag,
  readOnly = false,
  batchCount
}: Props) {
  // 1. Instantly pull the correct group of requirements from the SDK
  let requiredShots = PALLET_PHOTO_REQUIREMENTS[palletType];
  
  if (palletType === 'Mixed Bag Pallet') {
    requiredShots = [];
    if ((batchCount || 1) >= 1) requiredShots.push('BAG_FLAP_1');
    if ((batchCount || 1) >= 2) requiredShots.push('BAG_FLAP_2');
    if ((batchCount || 1) >= 3) requiredShots.push('BAG_FLAP_3');
    requiredShots.push('FRONT_VIEW', 'SIDE_VIEW_1', 'BACK_VIEW', 'SIDE_VIEW_2');
  } else if (isReturns && palletType !== 'Seedpak') {
    requiredShots = RETURNS_PALLET_PHOTO_REQUIREMENTS;
  }

  if (!requiredShots) {
    return null; // Safety fallback
  }

  const findSlotPhoto = (slotKey: string) => photos.find((p) => p.slotKey === slotKey);
  const capturedCount = photos.filter((p) => p.slotKey && requiredShots.includes(p.slotKey as any)).length;

  return (
    <div className="photo-checklist">
      <div className="section__head">
        <h2 className="section__title" style={{ textTransform: 'none' }}>
          {readOnly ? `Photos for ${palletType}` : `* Take pictures as required for ${palletType}`}
        </h2>
        <span className="section__meta">
          {capturedCount} of {requiredShots.length} captured
        </span>
      </div>

      <div className="photo-slot-grid">
        {/* 2. Dynamically render exactly what is needed */}
        {requiredShots.map((shotType) => {
          // Determine generic photo category based on requirement (or default to Pallet_Side)
          let category: any = 'Pallet_Side';
          if (
            shotType === 'LOT_LABEL_CLOSEUP' ||
            shotType === 'LOT_LABEL_CLOSEUP_1' ||
            shotType === 'LOT_LABEL_CLOSEUP_2' ||
            shotType === 'LOT_LABEL_CLOSEUP_3' ||
            shotType === 'BAG_FLAP_1' ||
            shotType === 'BAG_FLAP_2' ||
            shotType === 'BAG_FLAP_3' ||
            shotType === 'ALL_MIXED_SKUS_VISIBLE' ||
            shotType === 'BAG_FLAP'
          ) {
            category = 'Pallet_BagFlap';
          }
          if (shotType === 'SEAL_INTACT_VIEW' || shotType === 'BASE_WOOD_CONDITION') category = 'Pallet_LPN';
          
          if (isReturns && category === 'Pallet_Side') {
            category = 'Returns_Damage_Assessment';
          }

          return (
            <SlotPhotoCapture
              key={shotType}
              inspectionId={inspectionId}
              category={category}
              slotKey={shotType}
              slotLabel={getPhotoLabel(shotType)}
              palletIndex={palletIndex}
              existingPhoto={findSlotPhoto(shotType)}
              currentUser={currentUser}
              onCaptured={(photo) => onCaptured(shotType, photo)}
              onQualityFlag={onQualityFlag}
              readOnly={readOnly}
            />
          );
        })}
      </div>
    </div>
  );
}
