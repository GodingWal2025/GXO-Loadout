// Barrel re-export for shared module.
// This mirrors the old @gxo/semantic package's public API so that
// changing `from '@gxo/semantic'` to `from '../shared'` is the only
// edit needed in consuming files.

// Types
export * from './types/inspection';
export * from './types/ontology';

// Utils
export { generateId } from './utils/uuid';

// Services
export {
  getDB,
  dbSaveInspection,
  dbGetInspection,
  dbListAllInspections,
  dbListInspectionsForSite,
  dbListInProgressForSite,
  dbListCompletedForSite,
  dbHardDeleteInspection,
  dbArchiveInspection,
  dbSavePhotoBlob,
  dbGetPhotoBlob,
  dbMarkPhotoUploaded,
  dbEnqueueSync,
  dbGetPendingSync,
  dbRequeueStalledSync,
  dbUpdateSyncEntry,
  dbGetPendingSyncCount,
  dbGetUnuploadedPhotoCount,
  MAX_SYNC_ATTEMPTS,
} from './services/db';
export type { SyncQueueEntry } from './services/db';

export {
  startBackgroundSync,
  processSyncQueue,
  setApiUrl,
} from './services/sync';

export {
  listInspectorsForSite,
  listAllInspectorsForSite,
  addInspector,
  updateInspector,
  deactivateInspector,
} from './services/inspectors';

// Hooks
export { useInspection, emptyInspection } from './hooks/useInspection';
export type { Action } from './hooks/useInspection';

// State machines
export { transitionInspection } from './state/inspectionMachine';
export type { InspectionEvent } from './state/inspectionMachine';
export { transitionPallet } from './state/palletMachine';
export type { PalletEvent } from './state/palletMachine';

// Rules
export { isBatchCodeValid } from './rules/batchCodeMatching';
export { validatePhotoQuality } from './rules/photoQuality';
export { isValidStopSticker } from './rules/stopStickerValidation';
export { isInspectionComplete } from './rules/inspectionCompletion';
export { isValidHandoff } from './rules/handoffValidation';
export {
  PALLET_PHOTO_REQUIREMENTS,
  RETURNS_PALLET_PHOTO_REQUIREMENTS,
  getPhotoLabel,
} from './rules/photoRequirements';
export type { PhotoRequirement } from './rules/photoRequirements';

// Camera
export { useCameraCapture } from './camera/useCameraCapture';
export { compressPhoto } from './camera/compressPhoto';
export { checkImageQuality } from './camera/imageQuality';
export type { QualityIssue, QualityCheckResult, QualityIssueType } from './camera/imageQuality';
export {
  parseExifOrientationFromBuffer,
  readExifOrientation,
  uprightSizeForOrientation,
  setOrientationTransform,
  mapPointThroughOrientation,
} from './camera/exifOrientation';

// Camera components
export { SlotPhotoCapture, MultiPhotoCapture } from './camera/PhotoCapture';

// UI Components
export { InspectorPicker } from './components/InspectorPicker';
export { SuggestableField } from './components/SuggestableField';
export { QualityFlagButton } from './components/QualityFlagButton';
export { ImageQualityModal } from './components/ImageQualityModal';
export { StagingLanesMap } from './components/StagingLanesMap';
export { DashboardKPIBoxes } from './components/DashboardKPIBoxes';
export type { DashboardKPI } from './components/DashboardKPIBoxes';
export { DashboardTabs } from './components/DashboardTabs';
export type { DashboardTab } from './components/DashboardTabs';
export { KanbanBoard } from './components/KanbanBoard';
export type { KanbanColumnDef, KanbanCardDef, KanbanBoardProps } from './components/KanbanBoard';

// Ontology client (kept for potential future backend integration)
export { ontologyClient, setOntologyApiBase } from './client';
