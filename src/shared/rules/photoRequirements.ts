import type { PalletType } from '../types/inspection';

// Define the specific angles/shots you need to capture
export type PhotoRequirement = 
    | 'FRONT_FULL_VIEW' 
    | 'BACK_FULL_VIEW' 
    | 'LOT_LABEL_CLOSEUP' 
    | 'SEAL_INTACT_VIEW' 
    | 'BASE_WOOD_CONDITION' 
    | 'ALL_MIXED_SKUS_VISIBLE'
    | 'BAG_FLAP'
    | 'FRONT_VIEW'
    | 'SIDE_VIEW_1'
    | 'BACK_VIEW'
    | 'SIDE_VIEW_2'
    | 'PLACARD'
    | 'LOT_LABEL_CLOSEUP_1'
    | 'LOT_LABEL_CLOSEUP_2'
    | 'LOT_LABEL_CLOSEUP_3'
    | 'BAG_FLAP_1'
    | 'BAG_FLAP_2'
    | 'BAG_FLAP_3';

// Map the pallet types to their exact required shots
export const PALLET_PHOTO_REQUIREMENTS: Record<PalletType, PhotoRequirement[]> = {
    // Group 1: Bags
    'Full Bag Pallet': ['BAG_FLAP', 'FRONT_VIEW', 'SIDE_VIEW_1', 'BACK_VIEW', 'SIDE_VIEW_2'],
    'Partial Bag Pallet': ['BAG_FLAP', 'FRONT_VIEW', 'SIDE_VIEW_1', 'BACK_VIEW', 'SIDE_VIEW_2'],
    
    // Group 2: Bulk
    'Seedpak': ['PLACARD', 'SIDE_VIEW_1', 'SIDE_VIEW_2'],
    'Minibulk': ['PLACARD', 'SIDE_VIEW_1', 'SIDE_VIEW_2'],
    
    // Group 3: Mixed
    'Mixed Bag Pallet': ['FRONT_FULL_VIEW', 'ALL_MIXED_SKUS_VISIBLE']
};

export const RETURNS_PALLET_PHOTO_REQUIREMENTS: PhotoRequirement[] = [
    'BAG_FLAP',
    'FRONT_VIEW',
    'SIDE_VIEW_1',
    'BACK_VIEW',
    'SIDE_VIEW_2'
];

// Helper function to get readable labels for the UI
export const getPhotoLabel = (req: PhotoRequirement): string => {
    const labels: Record<PhotoRequirement, string> = {
        'FRONT_FULL_VIEW': "Front View (Entire Pallet)",
        'BACK_FULL_VIEW': "Back View (Stretch Wrap)",
        'LOT_LABEL_CLOSEUP': "Lot / Batch Label",
        'SEAL_INTACT_VIEW': "Top Seal / Cap Intact",
        'BASE_WOOD_CONDITION': "Bottom Wood Pallet Condition",
        'ALL_MIXED_SKUS_VISIBLE': "All Mixed SKUs Clearly Visible",
        'BAG_FLAP': "Bag Flap",
        'FRONT_VIEW': "Front",
        'SIDE_VIEW_1': "Side 1",
        'BACK_VIEW': "Back",
        'SIDE_VIEW_2': "Side 2",
        'PLACARD': "Placard",
        'LOT_LABEL_CLOSEUP_1': "Batch Label 1",
        'LOT_LABEL_CLOSEUP_2': "Batch Label 2",
        'LOT_LABEL_CLOSEUP_3': "Batch Label 3",
        'BAG_FLAP_1': "Bag Flap 1",
        'BAG_FLAP_2': "Bag Flap 2",
        'BAG_FLAP_3': "Bag Flap 3"
    };
    return labels[req];
};
