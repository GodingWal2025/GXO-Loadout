import React, { useState, useEffect } from 'react';
import {
  COMPLETE_DOMAIN_GRAPH,
  OUTBOUND_INSPECTION_GRAPH,
  RETURNS_INSPECTION_GRAPH,
  INBOUND_INSPECTION_GRAPH,
  RETAG_INSPECTION_GRAPH,
  DISCARD_INSPECTION_GRAPH,
  buildLiveOntologyGraph,
  type OntologyGraph,
} from '../shared/types/ontology';
import { dbListAllInspections, dbListInventoryItems } from '../shared/services/db';
import { listAllSites } from '../services/sites';
import { listAllStagingLocations } from '../services/stagingLocations';
import { OntologyGraphViewer } from '../components/OntologyGraphViewer';
import { getDeviceConfig } from '../lib/deviceConfig';

export type OntologyPresetMode =
  | 'COMPLETE'
  | 'OUTBOUND'
  | 'RETURNS'
  | 'INBOUND'
  | 'RETAG'
  | 'DISCARD'
  | 'LIVE';

export const OntologyRoute: React.FC = () => {
  const config = getDeviceConfig();

  // Layout preset mode: 'COMPLETE' | 'OUTBOUND' | 'RETURNS' | 'INBOUND' | 'RETAG' | 'DISCARD' | 'LIVE'
  const [layoutMode, setLayoutMode] = useState<OntologyPresetMode>('COMPLETE');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Live graph state
  const [liveGraph, setLiveGraph] = useState<OntologyGraph | null>(null);
  const [loadingLive, setLoadingLive] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    async function loadLive() {
      if (layoutMode !== 'LIVE') return;
      setLoadingLive(true);
      try {
        const [inspections, inventory, sites] = await Promise.all([
          dbListAllInspections(),
          dbListInventoryItems(),
          Promise.resolve(listAllSites()),
        ]);

        const currentSiteId = config?.siteId || '';
        const locations = currentSiteId ? listAllStagingLocations(currentSiteId) : [];

        const generated = buildLiveOntologyGraph(inspections, inventory, sites, locations);
        if (mounted) setLiveGraph(generated);
      } catch (err) {
        console.error('Failed to generate live ontology graph', err);
      } finally {
        if (mounted) setLoadingLive(false);
      }
    }

    loadLive();
    return () => {
      mounted = false;
    };
  }, [layoutMode, config?.siteId]);

  const activeGraph: OntologyGraph =
    layoutMode === 'OUTBOUND'
      ? OUTBOUND_INSPECTION_GRAPH
      : layoutMode === 'RETURNS'
        ? RETURNS_INSPECTION_GRAPH
        : layoutMode === 'INBOUND'
          ? INBOUND_INSPECTION_GRAPH
          : layoutMode === 'RETAG'
            ? RETAG_INSPECTION_GRAPH
            : layoutMode === 'DISCARD'
              ? DISCARD_INSPECTION_GRAPH
              : layoutMode === 'LIVE'
                ? liveGraph || { nodes: [], edges: [] }
                : COMPLETE_DOMAIN_GRAPH;

  return (
    <main className="page ontology-page">
      {/* Header Banner */}
      <div className="ontology-header">
        <div className="ontology-header-title">
          <h1>Domain Ontology Explorer</h1>
          <p className="soft">
            Interactive visualization of GXO-Loadout objects, spatial nodes, logistics orders, physical packaging assets, quality flags, and machine learning components.
          </p>
        </div>

        {/* Layout Presets */}
        <div className="ontology-preset-selector">
          <button
            type="button"
            className={`btn ${layoutMode === 'COMPLETE' ? 'btn--primary' : 'btn--secondary'}`}
            onClick={() => setLayoutMode('COMPLETE')}
          >
            🗺️ Complete Domain Map
          </button>
          <button
            type="button"
            className={`btn ${layoutMode === 'OUTBOUND' ? 'btn--primary' : 'btn--secondary'}`}
            onClick={() => setLayoutMode('OUTBOUND')}
          >
            📦 Outbound Shipment
          </button>
          <button
            type="button"
            className={`btn ${layoutMode === 'RETURNS' ? 'btn--primary' : 'btn--secondary'}`}
            onClick={() => setLayoutMode('RETURNS')}
          >
            🔄 Returns Product
          </button>
          <button
            type="button"
            className={`btn ${layoutMode === 'INBOUND' ? 'btn--primary' : 'btn--secondary'}`}
            onClick={() => setLayoutMode('INBOUND')}
          >
            📥 Inbound Dock
          </button>
          <button
            type="button"
            className={`btn ${layoutMode === 'RETAG' ? 'btn--primary' : 'btn--secondary'}`}
            onClick={() => setLayoutMode('RETAG')}
          >
            🏷️ Retag Labeling
          </button>
          <button
            type="button"
            className={`btn ${layoutMode === 'DISCARD' ? 'btn--primary' : 'btn--secondary'}`}
            onClick={() => setLayoutMode('DISCARD')}
          >
            🗑️ Discard Scrap
          </button>
          <button
            type="button"
            className={`btn ${layoutMode === 'LIVE' ? 'btn--primary' : 'btn--secondary'}`}
            onClick={() => setLayoutMode('LIVE')}
          >
            ⚡ Live Workspace Data
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="ontology-toolbar">
        {/* Category Pill Filters */}
        <div className="ontology-category-pills">
          {['ALL', 'Facility', 'Order', 'Asset', 'Audit', 'AI'].map((cat) => (
            <button
              key={cat}
              type="button"
              className={`ontology-pill ${selectedCategory === cat ? 'active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat === 'ALL' ? 'All Domains' : cat}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="ontology-search-box">
          <input
            type="text"
            className="input"
            placeholder="Search nodes or object types..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => setSearchQuery('')}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Graph Display Area */}
      {layoutMode === 'LIVE' && loadingLive ? (
        <div className="ontology-loading-state">
          <div className="soft">Building live ontology graph from local IndexedDB records...</div>
        </div>
      ) : activeGraph.nodes.length === 0 ? (
        <div className="ontology-empty-state">
          <h3>No Live Data Records Found</h3>
          <p className="soft">
            No active inspections or inventory items are currently stored in local IndexedDB. Start an inspection or import inventory to view live data nodes!
          </p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setLayoutMode('COMPLETE')}
          >
            Switch to Complete Domain Map
          </button>
        </div>
      ) : (
        <OntologyGraphViewer
          graph={activeGraph}
          selectedCategory={selectedCategory}
          searchQuery={searchQuery}
        />
      )}
    </main>
  );
};
