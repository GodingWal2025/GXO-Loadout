import { useState } from 'react';
import { StagingLaneObject } from '../types/ontology';
import { useT } from '../i18n/LanguageContext';
import './StagingLanesMap.css';

interface StagingLanesMapProps {
  onLaneClick?: (lane: StagingLaneObject) => void;
}

type LoadType = 'INBOUND' | 'OUTBOUND' | 'RETURN';

interface MockLoadDetail {
  type: LoadType;
  carrier: string;
  expectedPalletCount: number;
  status: string;
  currentLoadId: string;
}

const mockLoadDetails: Record<string, MockLoadDetail> = {
  // West
  'STW05': { type: 'INBOUND', carrier: 'FedEx Freight', expectedPalletCount: 12, status: 'LOADING', currentLoadId: 'LD-9901' },
  'STW15': { type: 'OUTBOUND', carrier: 'XPO Logistics', expectedPalletCount: 24, status: 'STAGED', currentLoadId: 'LD-9902' },
  'STW20': { type: 'RETURN', carrier: 'UPS Supply Chain', expectedPalletCount: 8, status: 'PENDING', currentLoadId: 'LD-9903' },
  'STW25': { type: 'OUTBOUND', carrier: 'J.B. Hunt', expectedPalletCount: 26, status: 'STAGED', currentLoadId: 'LD-9904' },
  'STW31': { type: 'INBOUND', carrier: 'Old Dominion', expectedPalletCount: 18, status: 'STAGED', currentLoadId: 'LD-9905' },
  'STW32': { type: 'OUTBOUND', carrier: 'FedEx Freight', expectedPalletCount: 22, status: 'LOADING', currentLoadId: 'LD-9906' },
  'STW36': { type: 'RETURN', carrier: 'XPO Logistics', expectedPalletCount: 4, status: 'STAGED', currentLoadId: 'LD-9907' },
  // East
  'STG01': { type: 'INBOUND', carrier: 'UPS Supply Chain', expectedPalletCount: 15, status: 'LOADING', currentLoadId: 'LD-8801' },
  'STG05': { type: 'OUTBOUND', carrier: 'J.B. Hunt', expectedPalletCount: 26, status: 'STAGED', currentLoadId: 'LD-8802' },
  'STG21': { type: 'INBOUND', carrier: 'FedEx Freight', expectedPalletCount: 20, status: 'LOADING', currentLoadId: 'LD-8803' },
  'STG31A': { type: 'RETURN', carrier: 'Old Dominion', expectedPalletCount: 5, status: 'STAGED', currentLoadId: 'LD-8804' },
};

interface MockDockDetail {
  inUse: boolean;
  type?: LoadType;
  error?: boolean;
}

const mockDocks: Record<string, MockDockDetail> = {
  // West
  'A0': { inUse: false, error: true },
  'A4': { inUse: false, error: true },
  'A15': { inUse: false, error: true },
  'A5': { inUse: true, type: 'INBOUND' },
  'A12': { inUse: true, type: 'OUTBOUND' },
  'A16': { inUse: true, type: 'RETURN' },
  // East
  'C2': { inUse: true, type: 'INBOUND' },
  'C5': { inUse: true, type: 'OUTBOUND' },
  'C6': { inUse: true, type: 'RETURN' },
};

export function StagingLanesMap({ onLaneClick }: StagingLanesMapProps) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<'east' | 'west'>('west');
  const [selectedLane, setSelectedLane] = useState<string | null>(null);

  const handleLaneClick = (name: string) => {
    setSelectedLane(name);
    
    onLaneClick?.({
      id: `lane-${name}`,
      objectType: 'StagingLane',
      properties: {
        name,
        zoneCode: 'UNK',
        status: mockLoadDetails[name] ? 'STAGED' : 'EMPTY',
        coordinates: { x: 0, y: 0, width: 1, length: 1 },
        currentLoadId: mockLoadDetails[name]?.currentLoadId || null,
        siteId: null
      }
    });
  };

  const getLaneStatusClass = (name: string) => {
    const details = mockLoadDetails[name];
    if (details) {
      return `type-${details.type.toLowerCase()}`;
    }
    return 'status-empty';
  };

  const renderVerticalLane = (name: string) => (
    <div
      key={name}
      className={`staging-lane-card ${getLaneStatusClass(name)}`}
      onClick={() => handleLaneClick(name)}
      title={name}
    >
      <span className="lane-name-text">{name}</span>
    </div>
  );

  const renderHorizontalLane = (name: string) => (
    <div
      key={name}
      className={`horizontal-lane ${getLaneStatusClass(name)}`}
      onClick={() => handleLaneClick(name)}
    >
      {name}
    </div>
  );

  const renderDockDoor = (name: string, className = 'dock-door') => {
    const dock = mockDocks[name];
    let dockClass = className;
    
    if (dock) {
      if (dock.error) dockClass += ' status-error';
      else if (dock.inUse && dock.type) dockClass += ` type-${dock.type.toLowerCase()}`;
    } else {
      dockClass += ' status-empty';
    }

    return (
      <div key={name} className={dockClass}>
        {name}
      </div>
    );
  };

  return (
    <div className="staging-lanes-container">
      <div className="warehouse-tabs">
        <button 
          className={`warehouse-tab ${activeTab === 'east' ? 'active' : ''}`}
          onClick={() => setActiveTab('east')}
        >
          <span className="warehouse-tab-icon">📦</span> {t('lanes.eastWarehouse', 'East Warehouse')}
        </button>
        <button 
          className={`warehouse-tab ${activeTab === 'west' ? 'active' : ''}`}
          onClick={() => setActiveTab('west')}
        >
          <span className="warehouse-tab-icon">📦</span> {t('lanes.westWarehouse', 'West Warehouse')}
        </button>
      </div>

      {activeTab === 'west' && (
        <div className="warehouse-layout west-layout">
          <div className="warehouse-title">{t('lanes.westWarehouse', 'West Warehouse')}</div>
          
          <div className="dock-doors-row">
            {Array.from({ length: 17 }).map((_, i) => renderDockDoor(`A${i}`))}
          </div>

          <div className="staging-lanes-row">
            <div className="lanes-group">
              {Array.from({ length: 17 }).map((_, i) => renderVerticalLane(`STW${String(i + 1).padStart(2, '0')}`))}
            </div>
            <div className="vertical-separator" />
            <div className="lanes-group">
              {Array.from({ length: 25 }).map((_, i) => renderVerticalLane(`STW${String(i + 18).padStart(2, '0')}`))}
            </div>
          </div>

          <div className="watermark-address">
            600 East 14th St<br />
            Albert Lea, MN 56007
          </div>
        </div>
      )}

      {activeTab === 'east' && (
        <div className="warehouse-layout east-layout">
          <div className="warehouse-title" style={{ left: '50%' }}>{t('lanes.eastWarehouse', 'East Warehouse')}</div>
          
          <div className="east-left-column">
            {['C6', 'C5', 'C4', 'C3', 'C2', 'C1'].map(name => renderDockDoor(name, 'east-dock-door'))}
          </div>

          <div className="east-main-content">
            <div className="east-top-lanes">
              <div className="top-lane-group">
                {['STG31B', 'STG32B', 'STG33B'].map(renderHorizontalLane)}
              </div>
              <div className="top-lane-group">
                {['STG31A', 'STG32A', 'STG33A'].map(renderHorizontalLane)}
              </div>
            </div>

            <div className="lanes-group">
              {Array.from({ length: 27 }).map((_, i) => renderVerticalLane(`STG${String(i + 1).padStart(2, '0')}`))}
            </div>
          </div>

          <div className="watermark-address">
            600 East 14th St<br />
            Albert Lea, MN 56007
          </div>
        </div>
      )}

      {/* Lane Details Modal */}
      {selectedLane && (
        <div className="lane-modal-overlay" onClick={() => setSelectedLane(null)}>
          <div className="lane-modal-content" onClick={e => e.stopPropagation()}>
            <div className="lane-modal-header">
              <h3 className="lane-modal-title">{t('lanes.laneTitle', 'Lane {name}', { name: selectedLane })}</h3>
              <button className="lane-modal-close" onClick={() => setSelectedLane(null)}>×</button>
            </div>
            <div className="lane-modal-body">
              {mockLoadDetails[selectedLane] ? (
                <>
                  <div className="modal-detail-row">
                    <span className="modal-detail-label">{t('lanes.loadType', 'Load Type')}</span>
                    <span className={`modal-badge type-${mockLoadDetails[selectedLane].type.toLowerCase()}`}>
                      {mockLoadDetails[selectedLane].type}
                    </span>
                  </div>
                  <div className="modal-detail-row">
                    <span className="modal-detail-label">{t('lanes.status', 'Status')}</span>
                    <span className="modal-detail-value">{mockLoadDetails[selectedLane].status}</span>
                  </div>
                  <div className="modal-detail-row">
                    <span className="modal-detail-label">{t('lanes.loadId', 'Load ID')}</span>
                    <span className="modal-detail-value">{mockLoadDetails[selectedLane].currentLoadId}</span>
                  </div>
                  <div className="modal-detail-row">
                    <span className="modal-detail-label">{t('lanes.carrier', 'Carrier')}</span>
                    <span className="modal-detail-value">{mockLoadDetails[selectedLane].carrier}</span>
                  </div>
                  <div className="modal-detail-row">
                    <span className="modal-detail-label">{t('lanes.expectedPallets', 'Expected Pallets')}</span>
                    <span className="modal-detail-value">{mockLoadDetails[selectedLane].expectedPalletCount}</span>
                  </div>
                </>
              ) : (
                <div className="modal-detail-row" style={{ justifyContent: 'center', padding: '20px', color: '#6b7280' }}>
                  {t('lanes.empty', 'This lane is currently empty.')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
