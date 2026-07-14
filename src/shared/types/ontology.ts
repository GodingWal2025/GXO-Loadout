export interface StagingLaneObject {
    id: string;
    objectType: 'StagingLane';
    properties: {
        name: string;
        zoneCode: string;
        status: 'EMPTY' | 'STAGED' | 'RESERVED' | 'BLOCKED';
        coordinates: { x: number; y: number; width: number; length: number };
        currentLoadId: string | null;
        siteId: string | null;
    };
}

export const LANE_STATUS = {
    EMPTY: 'EMPTY',
    STAGED: 'STAGED',
    BLOCKED: 'BLOCKED',
    RESERVED: 'RESERVED'
} as const;

export interface AssignLaneActionParams {
    laneId: string;
    loadId: string;
    status: string;
}
