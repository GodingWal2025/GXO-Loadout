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

// ============================================================
// Ontology Core Graph Types
// ============================================================

export type OntologyDomainCategory = 'Facility' | 'Order' | 'Asset' | 'Audit' | 'AI';

export type OntologyObjectType =
  | 'Site'
  | 'StagingLane'
  | 'StagingLocation'
  | 'Inspector'
  | 'Inspection'
  | 'Picklist'
  | 'PicklistLineItem'
  | 'BOLData'
  | 'BOLLineItem'
  | 'Delivery'
  | 'CrossReferenceResult'
  | 'PalletInspection'
  | 'BatchSection'
  | 'InventoryItem'
  | 'InspectionPhoto'
  | 'QualityFlag'
  | 'HandoffEntry'
  | 'Suggestable'
  | 'VisionInferenceResult'
  | 'TrainingSample';

export interface OntologyNode {
  id: string;
  type: OntologyObjectType;
  category: OntologyDomainCategory;
  label: string;
  properties: Record<string, unknown>;
}

export interface OntologyEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation:
    | 'HOSTS'
    | 'ASSIGN_TO'
    | 'EXECUTES'
    | 'OCCUPIES'
    | 'CONTAINS'
    | 'GENERATES'
    | 'VERIFIES'
    | 'FLAGS'
    | 'GROUPS_BY'
    | 'COMPARES'
    | 'REFERENCES'
    | 'GOVERNED_BY'
    | 'PREDICTS'
    | 'COLLECTS';
  label?: string;
}

export interface OntologyGraph {
  nodes: OntologyNode[];
  edges: OntologyEdge[];
}

// ============================================================
// Predefined Static Domain Ontology Graphs
// ============================================================

export const COMPLETE_DOMAIN_GRAPH: OntologyGraph = {
  nodes: [
    { id: 'node-site', type: 'Site', category: 'Facility', label: 'Facility Site', properties: { description: 'Physical warehouse site node' } },
    { id: 'node-lane', type: 'StagingLane', category: 'Facility', label: 'Staging Lane Object', properties: { status: 'STAGED', zoneCode: 'ZONE-A' } },
    { id: 'node-loc', type: 'StagingLocation', category: 'Facility', label: 'Staging Location', properties: { active: true } },
    { id: 'node-inspector', type: 'Inspector', category: 'Facility', label: 'Inspector User', properties: { active: true } },
    { id: 'node-inspection', type: 'Inspection', category: 'Order', label: 'Inspection Session', properties: { types: ['outbound', 'inbound', 'returns', 'retag', 'discard'] } },
    { id: 'node-picklist', type: 'Picklist', category: 'Order', label: 'Picklist Manifest', properties: { source: 'SAP Printout' } },
    { id: 'node-picklist-line', type: 'PicklistLineItem', category: 'Order', label: 'Picklist Line Item', properties: { fields: ['sku', 'batchCode', 'expectedQuantity', 'uom'] } },
    { id: 'node-bol', type: 'BOLData', category: 'Order', label: 'BOL Manifest', properties: { carrier: 'Truckload' } },
    { id: 'node-bol-line', type: 'BOLLineItem', category: 'Order', label: 'BOL Line Item', properties: { fields: ['sku', 'quantity', 'shipmentNumber', 'deliveryNumber'] } },
    { id: 'node-delivery', type: 'Delivery', category: 'Order', label: 'Delivery Stop Assignment', properties: { multiStop: true } },
    { id: 'node-crossref', type: 'CrossReferenceResult', category: 'Order', label: 'Cross-Reference Matrix', properties: { matches: true } },
    { id: 'node-pallet', type: 'PalletInspection', category: 'Asset', label: 'Pallet Inspection Unit', properties: { types: ['Full', 'Partial', 'Mixed', 'Seedpak', 'Minibulk'] } },
    { id: 'node-batch-sec', type: 'BatchSection', category: 'Asset', label: 'Batch Section', properties: { count: '1 to 3 per pallet' } },
    { id: 'node-inventory', type: 'InventoryItem', category: 'Asset', label: 'Master Inventory Stock', properties: { fields: ['sku', 'batch', 'description'] } },
    { id: 'node-photo', type: 'InspectionPhoto', category: 'Audit', label: 'Inspection Photo Proof', properties: { categories: ['Side', 'Flap', 'Placard', 'LPN', 'Lane'] } },
    { id: 'node-quality-flag', type: 'QualityFlag', category: 'Audit', label: 'Quality Flag Defect', properties: { reasons: ['damaged', 'wrong_label', 'qty_mismatch'] } },
    { id: 'node-handoff', type: 'HandoffEntry', category: 'Audit', label: 'Inspector Shift Handoff', properties: { tracks: 'palletsCompleted' } },
    { id: 'node-suggestable', type: 'Suggestable', category: 'AI', label: 'Suggestable Field Wrapper', properties: { sources: ['manual', 'empty', 'ml'] } },
    { id: 'node-vision', type: 'VisionInferenceResult', category: 'AI', label: 'Vision AI Inference', properties: { backends: ['RF-DETR', 'OWLv2'] } },
    { id: 'node-training', type: 'TrainingSample', category: 'AI', label: 'Ground Truth Training Sample', properties: { views: '4 sides + flap' } },
  ],
  edges: [
    { id: 'e1', sourceId: 'node-site', targetId: 'node-lane', relation: 'HOSTS', label: 'hosts' },
    { id: 'e2', sourceId: 'node-site', targetId: 'node-loc', relation: 'HOSTS', label: 'hosts' },
    { id: 'e3', sourceId: 'node-site', targetId: 'node-inspector', relation: 'ASSIGN_TO', label: 'assigns' },
    { id: 'e4', sourceId: 'node-site', targetId: 'node-inspection', relation: 'EXECUTES', label: 'executes' },
    { id: 'e5', sourceId: 'node-lane', targetId: 'node-inspection', relation: 'OCCUPIES', label: 'staged at' },
    { id: 'e6', sourceId: 'node-inspection', targetId: 'node-picklist', relation: 'CONTAINS', label: 'captures' },
    { id: 'e7', sourceId: 'node-inspection', targetId: 'node-bol', relation: 'CONTAINS', label: 'captures' },
    { id: 'e8', sourceId: 'node-inspection', targetId: 'node-crossref', relation: 'GENERATES', label: 'computes' },
    { id: 'e9', sourceId: 'node-inspection', targetId: 'node-pallet', relation: 'VERIFIES', label: 'verifies' },
    { id: 'e10', sourceId: 'node-inspection', targetId: 'node-handoff', relation: 'CONTAINS', label: 'logs' },
    { id: 'e11', sourceId: 'node-inspection', targetId: 'node-quality-flag', relation: 'FLAGS', label: 'flags issue' },
    { id: 'e12', sourceId: 'node-picklist', targetId: 'node-picklist-line', relation: 'CONTAINS', label: 'line items' },
    { id: 'e13', sourceId: 'node-bol', targetId: 'node-bol-line', relation: 'CONTAINS', label: 'line items' },
    { id: 'e14', sourceId: 'node-bol', targetId: 'node-delivery', relation: 'GROUPS_BY', label: 'groups stops' },
    { id: 'e15', sourceId: 'node-picklist-line', targetId: 'node-delivery', relation: 'ASSIGN_TO', label: 'destination' },
    { id: 'e16', sourceId: 'node-bol-line', targetId: 'node-delivery', relation: 'ASSIGN_TO', label: 'destination' },
    { id: 'e17', sourceId: 'node-crossref', targetId: 'node-picklist-line', relation: 'COMPARES', label: 'compares sum' },
    { id: 'e18', sourceId: 'node-crossref', targetId: 'node-bol-line', relation: 'COMPARES', label: 'against sum' },
    { id: 'e19', sourceId: 'node-pallet', targetId: 'node-delivery', relation: 'ASSIGN_TO', label: 'assigned to stop' },
    { id: 'e20', sourceId: 'node-pallet', targetId: 'node-batch-sec', relation: 'CONTAINS', label: '1-3 sections' },
    { id: 'e21', sourceId: 'node-pallet', targetId: 'node-photo', relation: 'CONTAINS', label: '4-6 photos' },
    { id: 'e22', sourceId: 'node-pallet', targetId: 'node-quality-flag', relation: 'FLAGS', label: 'defect' },
    { id: 'e23', sourceId: 'node-batch-sec', targetId: 'node-inventory', relation: 'REFERENCES', label: 'SKU/batch' },
    { id: 'e24', sourceId: 'node-picklist-line', targetId: 'node-suggestable', relation: 'GOVERNED_BY', label: 'uses ML wrapper' },
    { id: 'e25', sourceId: 'node-batch-sec', targetId: 'node-vision', relation: 'PREDICTS', label: 'audits layer AI' },
    { id: 'e26', sourceId: 'node-vision', targetId: 'node-photo', relation: 'REFERENCES', label: 'derived from' },
    { id: 'e27', sourceId: 'node-photo', targetId: 'node-training', relation: 'COLLECTS', label: 'training data' },
  ],
};

export const OUTBOUND_INSPECTION_GRAPH: OntologyGraph = {
  nodes: [
    { id: 'ob-site', type: 'Site', category: 'Facility', label: 'Site Facility', properties: { active: true } },
    { id: 'ob-lane', type: 'StagingLane', category: 'Facility', label: 'Staging Lane', properties: { status: 'STAGED' } },
    {
      id: 'ob-shipment',
      type: 'Inspection',
      category: 'Order',
      label: 'Shipment (Outbound Load)',
      properties: {
        entity: 'Shipment',
        type: 'outbound',
        status: 'IN_PROGRESS',
        description: 'Outbound inspection shipment container',
      },
    },
    {
      id: 'ob-stop',
      type: 'Delivery',
      category: 'Order',
      label: 'Stop (Delivery Destination)',
      properties: {
        entity: 'Stop',
        relationships: ['Belongs to Shipment', 'Contains Deliveries'],
      },
    },
    {
      id: 'ob-delivery',
      type: 'Delivery',
      category: 'Order',
      label: 'Delivery',
      properties: {
        entity: 'Delivery',
        relationships: ['Belongs to Stop', 'Contains SKUs'],
      },
    },
    {
      id: 'ob-sku',
      type: 'PicklistLineItem',
      category: 'Order',
      label: 'SKU Item',
      properties: {
        entity: 'SKU',
        fields: ['Batch', 'Quantity', 'UOM', 'Packing UOM/Quantity'],
        mapsTo: 'LoadOut Inventory (Material #)',
      },
    },
    {
      id: 'ob-mat-desc',
      type: 'InventoryItem',
      category: 'Asset',
      label: 'Material Description',
      properties: {
        mapsTo: 'LoadOut Inventory (Material Description)',
      },
    },
    {
      id: 'ob-pallet',
      type: 'PalletInspection',
      category: 'Asset',
      label: 'Pallet',
      properties: {
        entity: 'Pallet',
        fields: ['SKU', 'Batch', 'UOM'],
        types: ['Full Bag Pallet', 'Partial Bag Pallet', 'Mixed Bag Pallet', 'SeedPak', 'Minibulk'],
      },
    },
    {
      id: 'ob-batch',
      type: 'BatchSection',
      category: 'Asset',
      label: 'Batch (Lot Code)',
      properties: {
        entity: 'Batch',
        description: 'Batch section within pallet',
      },
    },
    {
      id: 'ob-uom-specs',
      type: 'PicklistLineItem',
      category: 'Asset',
      label: 'UOM & Unit Specs',
      properties: {
        units: {
          BG: 'Single Bag (Base Unit)',
          PL: 'Pallet = 60 Bags (54x40 = 87674223)',
          SP: 'SeedPak = Tote (Material 90905613)',
          MB: 'Minibulk = Tote 40x40 (Material 87675793)',
          C62: 'C62 = Pallet Unit without Batch',
        },
        materialCodes: {
          Minibulk_MB_40x40: '87675793',
          SeedPak_SP: '90905613',
          Pallet_54x40: '87674223',
        },
      },
    },
    { id: 'ob-photo-doc', type: 'InspectionPhoto', category: 'Audit', label: 'Document Photos (Picklist/BOL)', properties: { category: 'Picklist' } },
    { id: 'ob-photo-pallet', type: 'InspectionPhoto', category: 'Audit', label: 'Pallet Photos (Sides & Flap)', properties: { category: 'Pallet_Side' } },
    { id: 'ob-quality', type: 'QualityFlag', category: 'Audit', label: 'Quality Flag Defect', properties: { reason: 'damaged_product' } },
    { id: 'ob-ai', type: 'VisionInferenceResult', category: 'AI', label: 'Pallet Bag Detector AI', properties: { confidence: 0.95 } },
  ],
  edges: [
    { id: 'obe1', sourceId: 'ob-site', targetId: 'ob-lane', relation: 'HOSTS', label: 'hosts' },
    { id: 'obe2', sourceId: 'ob-site', targetId: 'ob-shipment', relation: 'EXECUTES', label: 'executes shipment' },
    { id: 'obe3', sourceId: 'ob-lane', targetId: 'ob-shipment', relation: 'OCCUPIES', label: 'staged at' },

    // Shipment -> Stop -> Delivery -> SKU -> Batch/Qty/UOM
    { id: 'obe4', sourceId: 'ob-shipment', targetId: 'ob-stop', relation: 'CONTAINS', label: 'has stops' },
    { id: 'obe5', sourceId: 'ob-stop', targetId: 'ob-delivery', relation: 'CONTAINS', label: 'has deliveries' },
    { id: 'obe6', sourceId: 'ob-delivery', targetId: 'ob-sku', relation: 'CONTAINS', label: 'contains SKUs' },
    { id: 'obe7', sourceId: 'ob-sku', targetId: 'ob-batch', relation: 'CONTAINS', label: 'has batch' },
    { id: 'obe8', sourceId: 'ob-sku', targetId: 'ob-uom-specs', relation: 'GOVERNED_BY', label: 'packing UOM / Qty' },
    { id: 'obe9', sourceId: 'ob-sku', targetId: 'ob-mat-desc', relation: 'REFERENCES', label: 'maps to LoadOut Inventory' },

    // Pallet -> SKU, Batch, UOM
    { id: 'obe10', sourceId: 'ob-shipment', targetId: 'ob-pallet', relation: 'VERIFIES', label: 'verifies pallets' },
    { id: 'obe11', sourceId: 'ob-pallet', targetId: 'ob-sku', relation: 'CONTAINS', label: 'has SKU' },
    { id: 'obe12', sourceId: 'ob-pallet', targetId: 'ob-batch', relation: 'CONTAINS', label: 'has batch' },
    { id: 'obe13', sourceId: 'ob-pallet', targetId: 'ob-uom-specs', relation: 'GOVERNED_BY', label: 'has UOM' },

    // Photos & Audit
    { id: 'obe14', sourceId: 'ob-shipment', targetId: 'ob-photo-doc', relation: 'CONTAINS', label: 'picklist/BOL photos' },
    { id: 'obe15', sourceId: 'ob-pallet', targetId: 'ob-photo-pallet', relation: 'CONTAINS', label: '4-6 pallet photos' },
    { id: 'obe16', sourceId: 'ob-pallet', targetId: 'ob-quality', relation: 'FLAGS', label: 'defect flag' },
    { id: 'obe17', sourceId: 'ob-batch', targetId: 'ob-ai', relation: 'PREDICTS', label: 'AI bag count assist' },
    { id: 'obe18', sourceId: 'ob-ai', targetId: 'ob-photo-pallet', relation: 'REFERENCES', label: 'derived from photos' },
  ],
};

// ============================================================
// Dynamic Live Graph Generator from Local Application State
// ============================================================

export function buildLiveOntologyGraph(
  inspections: any[],
  inventory: any[],
  sites: any[],
  stagingLocations: any[]
): OntologyGraph {
  const nodes: OntologyNode[] = [];
  const edges: OntologyEdge[] = [];
  let edgeIdSeq = 1;

  // 1. Facility Sites
  for (const site of sites) {
    const siteNodeId = `live-site-${site.id}`;
    nodes.push({
      id: siteNodeId,
      type: 'Site',
      category: 'Facility',
      label: site.name || `Site ${site.id}`,
      properties: site,
    });

    // Staging Locations under site
    const siteLocations = stagingLocations.filter((loc) => loc.siteId === site.id);
    for (const loc of siteLocations) {
      const locNodeId = `live-loc-${loc.id}`;
      nodes.push({
        id: locNodeId,
        type: 'StagingLocation',
        category: 'Facility',
        label: `Staging: ${loc.name}`,
        properties: loc,
      });
      edges.push({
        id: `le-${edgeIdSeq++}`,
        sourceId: siteNodeId,
        targetId: locNodeId,
        relation: 'HOSTS',
        label: 'hosts location',
      });
    }
  }

  // 2. Active Inspections
  for (const insp of inspections.slice(0, 10)) { // limit to top 10 for performance
    const inspNodeId = `live-insp-${insp.id}`;
    const siteNodeId = `live-site-${insp.siteId}`;

    nodes.push({
      id: inspNodeId,
      type: 'Inspection',
      category: 'Order',
      label: `Inspection ${insp.id.slice(0, 8)} (${insp.type})`,
      properties: {
        id: insp.id,
        type: insp.type,
        status: insp.status,
        startedAt: insp.startedAt,
        completedAt: insp.completedAt,
        pickerName: insp.pickerName,
        currentInspector: insp.currentInspector,
        stagingLocation: insp.stagingLocation,
        palletCount: insp.pallets?.length || 0,
      },
    });

    if (sites.some((s) => s.id === insp.siteId)) {
      edges.push({
        id: `le-${edgeIdSeq++}`,
        sourceId: siteNodeId,
        targetId: inspNodeId,
        relation: 'EXECUTES',
        label: 'executes load',
      });
    }

    // Picklist
    if (insp.picklist?.lineItems?.length) {
      const picklistNodeId = `live-picklist-${insp.id}`;
      nodes.push({
        id: picklistNodeId,
        type: 'Picklist',
        category: 'Order',
        label: `Picklist: Load ${insp.picklist.loadNumber?.value || 'N/A'}`,
        properties: insp.picklist,
      });
      edges.push({
        id: `le-${edgeIdSeq++}`,
        sourceId: inspNodeId,
        targetId: picklistNodeId,
        relation: 'CONTAINS',
        label: 'has picklist',
      });

      // Picklist Lines
      for (const line of insp.picklist.lineItems.slice(0, 5)) {
        const lineNodeId = `live-pickline-${line.id}`;
        nodes.push({
          id: lineNodeId,
          type: 'PicklistLineItem',
          category: 'Order',
          label: `Item: ${line.sku?.value || 'SKU'} (${line.expectedQuantity?.value || 0} ${line.uom})`,
          properties: line,
        });
        edges.push({
          id: `le-${edgeIdSeq++}`,
          sourceId: picklistNodeId,
          targetId: lineNodeId,
          relation: 'CONTAINS',
          label: 'line item',
        });
      }
    }

    // Pallets
    for (const pallet of insp.pallets || []) {
      const palletNodeId = `live-pallet-${insp.id}-${pallet.palletNumber}`;
      nodes.push({
        id: palletNodeId,
        type: 'PalletInspection',
        category: 'Asset',
        label: `Pallet #${pallet.palletNumber} (${pallet.palletType})`,
        properties: pallet,
      });
      edges.push({
        id: `le-${edgeIdSeq++}`,
        sourceId: inspNodeId,
        targetId: palletNodeId,
        relation: 'VERIFIES',
        label: 'verifies pallet',
      });

      // Batch Sections
      for (const sec of pallet.batchSections || []) {
        const secNodeId = `live-sec-${sec.id}`;
        nodes.push({
          id: secNodeId,
          type: 'BatchSection',
          category: 'Asset',
          label: `Batch: ${sec.batchCode?.value || 'N/A'}`,
          properties: sec,
        });
        edges.push({
          id: `le-${edgeIdSeq++}`,
          sourceId: palletNodeId,
          targetId: secNodeId,
          relation: 'CONTAINS',
          label: 'contains section',
        });
      }

      // Photos
      for (const photo of pallet.photos || []) {
        const photoNodeId = `live-photo-${photo.id}`;
        nodes.push({
          id: photoNodeId,
          type: 'InspectionPhoto',
          category: 'Audit',
          label: `Photo: ${photo.category} (${photo.slotKey || 'general'})`,
          properties: photo,
        });
        edges.push({
          id: `le-${edgeIdSeq++}`,
          sourceId: palletNodeId,
          targetId: photoNodeId,
          relation: 'CONTAINS',
          label: 'photo proof',
        });
      }
    }
  }

  // 3. Master Inventory Stock
  for (const inv of inventory.slice(0, 8)) {
    const invNodeId = `live-inv-${inv.id}`;
    nodes.push({
      id: invNodeId,
      type: 'InventoryItem',
      category: 'Asset',
      label: `Stock: SKU ${inv.sku} / Lot ${inv.batch}`,
      properties: inv,
    });
  }

  return { nodes, edges };
}


