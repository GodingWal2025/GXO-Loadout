import { getPhotoLabel, type PalletType, type InspectionPhoto, type QualityFlag } from '../shared';
import { requiredPalletPhotos } from '../shared/rules/photoRequirements';
import { SlotPhotoCapture } from '../shared';
import { useT } from '../shared/i18n/LanguageContext';

interface Props {
  palletType: PalletType;
  inspectionId: string;
  palletIndex: number;
  isReturns: boolean;
  currentUser: string;
  photos: InspectionPhoto[];
  onCaptured: (slotKey: string, photo: InspectionPhoto) => void;
  onQualityFlag: (photoId: string, flag: QualityFlag | undefined) => void;
  onRotatePhoto?: (photoId: string) => void;
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
  onRotatePhoto,
  readOnly = false,
  batchCount
}: Props) {
  const t = useT();
  const requiredShots = requiredPalletPhotos(palletType, batchCount, isReturns);

  const findSlotPhoto = (slotKey: string) => photos.find((p) => p.slotKey === slotKey);
  const capturedCount = photos.filter((p) => p.slotKey && requiredShots.includes(p.slotKey as any)).length;
  const firstMissingIndex = requiredShots.findIndex((shot) => !findSlotPhoto(shot));

  return (
    <div className="photo-checklist">
      <div className="section__head">
        <h2 className="section__title" style={{ textTransform: 'none' }}>
          {readOnly
            ? t('photoChecklist.photosFor', 'Photos for {type}', { type: palletType })
            : t('photoChecklist.takeRequired', '* Take pictures as required for {type}', {
                type: palletType,
              })}
        </h2>
        <span className="section__meta">
          {t('photoChecklist.capturedCount', '{done} of {total} captured', {
            done: capturedCount,
            total: requiredShots.length,
          })}
        </span>
      </div>

      <div className="photo-slot-grid">
        {/* 2. Dynamically render exactly what is needed with step sequencing */}
        {requiredShots.map((shotType, idx) => {
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

          const isNext = !readOnly && idx === firstMissingIndex;

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
              onRotatePhoto={onRotatePhoto}
              readOnly={readOnly}
              isNextRequired={isNext}
              stepNumber={idx + 1}
            />
          );
        })}
      </div>
    </div>
  );
}
