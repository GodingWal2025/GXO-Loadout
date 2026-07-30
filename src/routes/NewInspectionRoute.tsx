import { useEffect, useState, useMemo } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { getDeviceConfig } from '../lib/deviceConfig';
import { InspectorPicker } from '../shared';
import { emptyInspection } from '../shared';
import { dbGetInspection, dbSaveInspection } from '../shared';
import { listActiveStagingLocations, type StagingLocation } from '../services/stagingLocations';
import { listInspectorsForSite } from '../shared';
import type { Inspection, InspectionType } from '../shared';
import { STUBBED_INSPECTION_TYPES } from '../shared';
import { useT } from '../shared/i18n/LanguageContext';

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
  const t = useT();
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
        placeholder={placeholder || t('newInspection.searchSelect', 'Search & select...')}
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
  const location = useLocation();
  const t = useT();
  // Two modes on one screen: no :id → create a new inspection; :id → edit the
  // names and location of an inspection that already exists (step 1 revisited
  // from a later step). Editing must never mint a second record.
  const params = useParams<{ type?: string; id?: string }>();
  const config = useMemo(() => getDeviceConfig(), []);
  // Where the inspector came from, planted by StepBackLink, so "Save changes"
  // returns them to that exact step.
  const cameFrom = (location.state as { from?: string } | null)?.from;

  // Display-only labels/descriptions for each inspection type. The stored
  // `inspectionType` value stays the untranslated English enum.
  const typeLabels: Record<InspectionType, string> = {
    outbound: t('newInspection.typeOutbound', 'Outbound'),
    inbound: t('newInspection.typeInbound', 'Inbound'),
    returns: t('newInspection.typeReturns', 'Returns'),
    retag: t('newInspection.typeRetag', 'Retag'),
    discard: t('newInspection.typeDiscard', 'Discard'),
  };
  const typeDescriptions: Record<InspectionType, string> = {
    outbound: t(
      'newInspection.descOutbound',
      'Verify a load against the printed picklist before it ships.'
    ),
    inbound: t('newInspection.descInbound', 'Receive and verify incoming loads.'),
    returns: t('newInspection.descReturns', 'Process returned product back into inventory.'),
    retag: t('newInspection.descRetag', 'Re-label or correct existing inventory.'),
    discard: t(
      'newInspection.descDiscard',
      'Remove damaged or expired product from inventory.'
    ),
  };


  const [pickerName, setPickerName] = useState('');
  const [selectedInspectors, setSelectedInspectors] = useState<string[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  
  const [inspectors, setInspectors] = useState<{id: string, name: string}[]>([]);
  const [stagingLocations, setStagingLocations] = useState<StagingLocation[]>([]);
  const [creating, setCreating] = useState(false);
  const [returnsBrand, setReturnsBrand] = useState<'Dekalb' | 'Channel' | ''>('');
  const [editing, setEditing] = useState<Inspection | null>(null);

  // Edit mode: load the existing record and prefill every field from it.
  // `startedBy` and `stagingLocation` are ', ' joined strings on the record.
  useEffect(() => {
    if (!params.id) return;
    dbGetInspection(params.id).then((i) => {
      if (!i) {
        navigate('/');
        return;
      }
      setEditing(i);
      setPickerName(i.pickerName || '');
      setSelectedInspectors(i.startedBy ? i.startedBy.split(', ').filter(Boolean) : []);
      setSelectedLocations(
        i.stagingLocation ? i.stagingLocation.split(', ').filter(Boolean) : []
      );
      setReturnsBrand(i.returnsBrand || '');
    });
  }, [params.id, navigate]);

  useEffect(() => {
    if (!config) return;
    const refresh = () => {
      setStagingLocations(listActiveStagingLocations(config.siteId));
      setInspectors(listInspectorsForSite(config.siteId));
    };
    refresh();
    // Refresh live when the background sync pulls data from other devices
    window.addEventListener('loadout-inspectors-updated', refresh);
    window.addEventListener('loadout-staging-locations-updated', refresh);
    return () => {
      window.removeEventListener('loadout-inspectors-updated', refresh);
      window.removeEventListener('loadout-staging-locations-updated', refresh);
    };
  }, [config]);

  if (!config) {
    navigate('/setup');
    return null;
  }

  // Nothing to render until the record being edited is in hand.
  if (params.id && !editing) return null;

  // In edit mode the type comes off the record, never off the URL.
  const inspectionType = editing
    ? editing.type
    : (params.type as InspectionType) || 'outbound';
  const validType = ['outbound', 'inbound', 'returns', 'retag', 'discard'].includes(
    inspectionType
  );

  if (!validType) {
    return (
      <main style={{ maxWidth: 560 }}>
        <div className="page-head">
          <h1 className="page-head__title">{t('newInspection.unknownWorkflow', 'Unknown workflow')}</h1>
        </div>
        <Link to="/" className="btn">{t('newInspection.backToHome', '← Back to home')}</Link>
      </main>
    );
  }

  // Inbound, Retag and Discard aren't built yet — see STUBBED_INSPECTION_TYPES.
  // The tiles stay on the home screen so they're discoverable and so the spec
  // questions below reach whoever clicks them, rather than hiding the gap.
  if (STUBBED_INSPECTION_TYPES.includes(inspectionType)) {
    return (
      <main style={{ maxWidth: 560 }}>
        <div className="page-head">
          <div>
            <h1 className="page-head__title">
              {t('newInspection.workflowTitle', '{type} workflow', {
                type: typeLabels[inspectionType],
              })}
            </h1>
            <div className="page-head__sub">{typeDescriptions[inspectionType]}</div>
          </div>
        </div>

        <div className="banner banner--info">
          <span className="banner__icon">🚧</span>
          <div className="banner__body">
            <strong>{t('newInspection.comingSoon', 'Coming soon.')}</strong>{' '}
            {t(
              'newInspection.comingSoonBody',
              "The {type} workflow isn't built yet. Spec out the workflow with us and we'll build it.",
              { type: typeLabels[inspectionType] }
            )}
          </div>
        </div>

        <div className="empty" style={{ marginTop: 16 }}>
          <div className="empty__title">
            {t('newInspection.needFromYou', 'What we need from you to build this')}
          </div>
          <div className="empty__sub" style={{ marginTop: 8 }}>
            <ul style={{ textAlign: 'left', listStylePosition: 'inside' }}>
              <li>{t('newInspection.q1', 'What fields are captured?')}</li>
              <li>{t('newInspection.q2', 'What photos are required?')}</li>
              <li>{t('newInspection.q3', "What's the step-by-step workflow?")}</li>
              <li>{t('newInspection.q4', 'What does "complete" look like?')}</li>
            </ul>
          </div>
        </div>

        <div className="flex gap-8 mt-24">
          <Link to="/" className="btn">{t('newInspection.backToHome', '← Back to home')}</Link>
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
      alert(t('newInspection.startError', 'Error starting inspection: {message}', { message: msg }));
      setCreating(false);
    }
  };

  // Edit mode: patch the loaded record in place. Everything not on this screen
  // (pallets, picklist, bol, photos) rides along untouched via the spread.
  const saveChanges = async () => {
    if (!canStart || !editing) return;
    setCreating(true);
    try {
      const updated: Inspection = {
        ...editing,
        pickerName: inspectionType === 'returns' ? undefined : pickerName,
        startedBy: selectedInspectors.join(', '),
        currentInspector: selectedInspectors.join(', '),
        lastEditedBy: selectedInspectors.join(', '),
        stagingLocation: selectedLocations.join(', '),
        returnsBrand: inspectionType === 'returns' ? (returnsBrand as 'Dekalb' | 'Channel') : undefined,
        lastEditedAt: new Date().toISOString(),
      };
      await dbSaveInspection(updated);

      if (cameFrom) navigate(cameFrom);
      else navigate(-1);
    } catch (e: any) {
      console.error(e);
      const msg = e && e.message ? e.message : String(e);
      alert(t('newInspection.saveError', 'Error saving inspection: {message}', { message: msg }));
      setCreating(false);
    }
  };

  return (
    <main style={{ maxWidth: 560 }}>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            {editing
              ? t('newInspection.editTitleLead', 'Edit')
              : t('newInspection.titleLead', 'New')}{' '}
            <em>
              {t('newInspection.titleEm', '{type} inspection', {
                type: typeLabels[inspectionType],
              })}
            </em>
          </h1>
          <div className="page-head__sub">
            {t('newInspection.stepLine', 'Step 1 of {total} · Names and location', {
              total: inspectionType === 'returns' ? 5 : 4,
            })}
          </div>
        </div>
      </div>

      {inspectionType !== 'returns' && (
        <div className="field">
          <div className="field__label">
            {t('newInspection.pickerLabel', 'Picker (who pulled the load)')}
          </div>
          <InspectorPicker
            siteId={config.siteId}
            value={pickerName}
            placeholder={t('newInspection.pickerPlaceholder', 'Select picker…')}
            onChange={setPickerName}
          />
        </div>
      )}

      <div className="field">
        <SearchableMultiSelect 
          label={t('newInspection.inspectorsLabel', 'Inspector(s)')}
          options={inspectors.map(i => i.name)}
          selected={selectedInspectors}
          onChange={setSelectedInspectors}
          placeholder={t('newInspection.inspectorsPlaceholder', 'Search and select inspectors...')}
        />
        <div className="field__hint" style={{ marginTop: 8 }}>
          {t(
            'newInspection.inspectorsHint',
            "Select all inspectors working on this load. If you don't see your name, ask a manager to add you."
          )}
        </div>
      </div>

      {inspectionType === 'returns' && (
        <div className="field">
          <div className="field__label">{t('newInspection.returnsBrandLabel', 'Returns Brand')}</div>
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
            <div className="field__label">
              {t('newInspection.stagingLabel', 'Staging location(s)')}
            </div>
            <div className="banner banner--warn" style={{ marginBottom: 0 }}>
              <span className="banner__icon">⚠</span>
              <div className="banner__body">
                {t(
                  'newInspection.noStagingLocations',
                  'No staging locations defined for this site. Ask a manager to add them.'
                )}
              </div>
            </div>
          </div>
        ) : (
          <SearchableMultiSelect
            label={t('newInspection.stagingLabel', 'Staging location(s)')}
            options={stagingLocations.map(l => l.name)}
            selected={selectedLocations}
            onChange={setSelectedLocations}
            placeholder={t('newInspection.stagingPlaceholder', 'Search and select lanes...')}
          />
        )}
      </div>

      <div className="flex gap-8 mt-24">
        {editing ? (
          <button
            className="btn btn--ghost"
            onClick={() => (cameFrom ? navigate(cameFrom) : navigate(-1))}
          >
            {t('newInspection.cancel', 'Cancel')}
          </button>
        ) : (
          <Link to="/" className="btn btn--ghost">{t('newInspection.cancel', 'Cancel')}</Link>
        )}
        <button
          className="btn btn--accent btn--lg"
          onClick={editing ? saveChanges : start}
          disabled={!canStart || creating}
        >
          {editing
            ? creating
              ? t('newInspection.saving', 'Saving…')
              : t('newInspection.saveChanges', 'Save changes')
            : creating
              ? t('newInspection.starting', 'Starting…')
              : inspectionType === 'returns'
                ? t('newInspection.continueReturnsBol', 'Continue → Capture Returns BOL')
                : t('newInspection.continueBol', 'Continue → Capture BOL')}
        </button>
      </div>
    </main>
  );
}
