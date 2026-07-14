import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getDeviceConfig } from '../lib/deviceConfig';
import { InspectorPicker } from '../shared';
import { emptyInspection } from '../shared';
import { dbSaveInspection } from '../shared';
import { listActiveStagingLocations, type StagingLocation } from '../services/stagingLocations';
import { listInspectorsForSite } from '../shared';
import type { InspectionType } from '../shared';
import { INSPECTION_TYPE_LABELS, INSPECTION_TYPE_DESCRIPTIONS } from '../shared';

function SearchableMultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (s: string[]) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const filteredOptions = options.filter(
    (opt) =>
      opt.toLowerCase().includes(query.toLowerCase()) &&
      !selected.includes(opt)
  );

  const toggleSelect = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter((x) => x !== opt));
    } else {
      onChange([...selected, opt]);
    }
    setQuery('');
  };

  return (
    <div className="searchable-multi-select" style={{ position: 'relative' }}>
      <div className="field__label">{label}</div>
      
      {/* Selected Pills */}
      {selected.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {selected.map((val) => (
            <span
              key={val}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 16,
                background: 'var(--accent-bg)',
                color: 'var(--accent)',
                fontSize: 14,
                fontWeight: 600,
                border: '1px solid var(--accent)'
              }}
            >
              {val}
              <button
                type="button"
                onClick={() => toggleSelect(val)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 12,
                  lineHeight: 1,
                  marginLeft: 4,
                  fontWeight: 'bold'
                }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search Input */}
      <input
        type="text"
        placeholder={placeholder || "Search & select..."}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => {
          // Use setTimeout so click events on options register before closing
          setTimeout(() => setIsOpen(false), 200);
        }}
      />

      {/* Dropdown Options */}
      {isOpen && filteredOptions.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 10,
            background: 'var(--paper)',
            border: '1px solid var(--rule)',
            borderRadius: 4,
            maxHeight: 200,
            overflowY: 'auto',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            marginTop: 4,
          }}
        >
          {filteredOptions.map((opt) => (
            <div
              key={opt}
              onMouseDown={(e) => {
                // Prevent input blur before click registers
                e.preventDefault();
              }}
              onClick={() => toggleSelect(opt)}
              style={{
                padding: '10px 16px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--rule-soft)',
              }}
              className="dropdown-item"
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function NewInspectionRoute() {
  const navigate = useNavigate();
  const params = useParams<{ type: string }>();
  const config = useMemo(() => getDeviceConfig(), []);
  
  const [pickerName, setPickerName] = useState('');
  const [selectedInspectors, setSelectedInspectors] = useState<string[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  
  const [inspectors, setInspectors] = useState<{id: string, name: string}[]>([]);
  const [stagingLocations, setStagingLocations] = useState<StagingLocation[]>([]);
  const [creating, setCreating] = useState(false);
  const [returnsBrand, setReturnsBrand] = useState<'Dekalb' | 'Channel' | ''>('');

  useEffect(() => {
    if (config) {
      setStagingLocations(listActiveStagingLocations(config.siteId));
      setInspectors(listInspectorsForSite(config.siteId));
    }
  }, [config]);

  if (!config) {
    navigate('/setup');
    return null;
  }

  const inspectionType = (params.type as InspectionType) || 'outbound';
  const validType = ['outbound', 'inbound', 'returns', 'retag'].includes(inspectionType);

  if (!validType) {
    return (
      <main style={{ maxWidth: 560 }}>
        <div className="page-head">
          <h1 className="page-head__title">Unknown workflow</h1>
        </div>
        <Link to="/" className="btn">← Back to home</Link>
      </main>
    );
  }

  // Retag is stubbed for now
  if (inspectionType === 'retag') {
    return (
      <main style={{ maxWidth: 560 }}>
        <div className="page-head">
          <div>
            <h1 className="page-head__title">
              {INSPECTION_TYPE_LABELS[inspectionType]} <em>workflow</em>
            </h1>
            <div className="page-head__sub">{INSPECTION_TYPE_DESCRIPTIONS[inspectionType]}</div>
          </div>
        </div>

        <div className="banner banner--info">
          <span className="banner__icon">🚧</span>
          <div className="banner__body">
            <strong>Coming soon.</strong> The {INSPECTION_TYPE_LABELS[inspectionType]} workflow
            isn't built yet. Spec out the workflow with us and we'll build it.
          </div>
        </div>

        <div className="empty" style={{ marginTop: 16 }}>
          <div className="empty__title">What we need from you to build this</div>
          <div className="empty__sub" style={{ marginTop: 8 }}>
            <ul style={{ textAlign: 'left', listStylePosition: 'inside' }}>
              <li>What fields are captured?</li>
              <li>What photos are required?</li>
              <li>What's the step-by-step workflow?</li>
              <li>What does "complete" look like?</li>
            </ul>
          </div>
        </div>

        <div className="flex gap-8 mt-24">
          <Link to="/" className="btn">← Back to home</Link>
        </div>
      </main>
    );
  }

  // Outbound / Inbound / Returns workflow
  const canStart = (inspectionType === 'returns' ? returnsBrand !== '' : pickerName !== '') && selectedInspectors.length > 0 && selectedLocations.length > 0;

  const start = async () => {
    if (!canStart) return;
    setCreating(true);
    try {
      const inspection = {
        ...emptyInspection(config.siteId, inspectionType),
        pickerName: inspectionType === 'returns' ? undefined : pickerName,
        startedBy: selectedInspectors.join(', '),
        currentInspector: selectedInspectors.join(', '),
        lastEditedBy: selectedInspectors.join(', '),
        stagingLocation: selectedLocations.join(', '),
        returnsBrand: inspectionType === 'returns' ? (returnsBrand as 'Dekalb' | 'Channel') : undefined,
      };

      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout saving to IndexedDB! Is another tab blocking it?")), 5000));
      await Promise.race([
        dbSaveInspection(inspection),
        timeout
      ]);
      
      if (inspectionType === 'returns') {
        navigate(`/inspection/${inspection.id}/capture-returns-bol`);
      } else {
        navigate(`/inspection/${inspection.id}/capture-bol`);
      }
    } catch (e: any) {
      console.error(e);
      const msg = e && e.message ? e.message : String(e);
      alert('Error starting inspection: ' + msg);
      setCreating(false);
    }
  };

  return (
    <main style={{ maxWidth: 560 }}>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            New <em>{INSPECTION_TYPE_LABELS[inspectionType]} inspection</em>
          </h1>
          <div className="page-head__sub">Step 1 of {inspectionType === 'returns' ? 5 : 4} · Names and location</div>
        </div>
      </div>

      {inspectionType !== 'returns' && (
        <div className="field">
          <div className="field__label">Picker (who pulled the load)</div>
          <InspectorPicker
            siteId={config.siteId}
            value={pickerName}
            placeholder="Select picker…"
            onChange={setPickerName}
          />
        </div>
      )}

      <div className="field">
        <SearchableMultiSelect 
          label="Inspector(s)"
          options={inspectors.map(i => i.name)}
          selected={selectedInspectors}
          onChange={setSelectedInspectors}
          placeholder="Search and select inspectors..."
        />
        <div className="field__hint" style={{ marginTop: 8 }}>
          Select all inspectors working on this load. If you don't see your name, ask a manager to add you.
        </div>
      </div>

      {inspectionType === 'returns' && (
        <div className="field">
          <div className="field__label">Returns Brand</div>
          <div style={{ display: 'flex', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input 
                type="radio" 
                name="returnsBrand" 
                value="Dekalb" 
                checked={returnsBrand === 'Dekalb'} 
                onChange={() => setReturnsBrand('Dekalb')} 
              />
              Dekalb
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input 
                type="radio" 
                name="returnsBrand" 
                value="Channel" 
                checked={returnsBrand === 'Channel'} 
                onChange={() => setReturnsBrand('Channel')} 
              />
              Channel
            </label>
          </div>
        </div>
      )}

      <div className="field">
        {stagingLocations.length === 0 ? (
          <div>
            <div className="field__label">Staging location(s)</div>
            <div className="banner banner--warn" style={{ marginBottom: 0 }}>
              <span className="banner__icon">⚠</span>
              <div className="banner__body">
                No staging locations defined for this site. Ask a manager to add them.
              </div>
            </div>
          </div>
        ) : (
          <SearchableMultiSelect 
            label="Staging location(s)"
            options={stagingLocations.map(l => l.name)}
            selected={selectedLocations}
            onChange={setSelectedLocations}
            placeholder="Search and select lanes..."
          />
        )}
      </div>

      <div className="flex gap-8 mt-24">
        <Link to="/" className="btn btn--ghost">Cancel</Link>
        <button
          className="btn btn--accent btn--lg"
          onClick={start}
          disabled={!canStart || creating}
        >
          {creating ? 'Starting…' : `Continue → Capture ${inspectionType === 'returns' ? 'Returns BOL' : 'BOL'}`}
        </button>
      </div>
    </main>
  );
}
