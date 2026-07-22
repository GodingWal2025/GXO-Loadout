import { useEffect, useState } from 'react';
import type { Inspector } from '../types/inspection';
import { listInspectorsForSite } from '../services/inspectors';
import { useT } from '../i18n/LanguageContext';

interface Props {
  siteId: string;
  value: string;
  placeholder?: string;
  onChange: (name: string) => void;
}

export function InspectorPicker({ siteId, value, placeholder, onChange }: Props) {
  const t = useT();
  const [inspectors, setInspectors] = useState<Inspector[]>([]);

  useEffect(() => {
    const refresh = () => setInspectors(listInspectorsForSite(siteId));
    refresh();
    // Refresh live when the background sync pulls inspectors from other devices
    window.addEventListener('loadout-inspectors-updated', refresh);
    return () => window.removeEventListener('loadout-inspectors-updated', refresh);
  }, [siteId]);

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder || t('inspectorPicker.placeholder', 'Select inspector…')}</option>
      {inspectors.map((i) => (
        <option key={i.id} value={i.name}>{i.name}</option>
      ))}
    </select>
  );
}
