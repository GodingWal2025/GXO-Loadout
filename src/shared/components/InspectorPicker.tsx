import { useEffect, useState } from 'react';
import type { Inspector } from '../types/inspection';
import { listInspectorsForSite } from '../services/inspectors';

interface Props {
  siteId: string;
  value: string;
  placeholder?: string;
  onChange: (name: string) => void;
}

export function InspectorPicker({ siteId, value, placeholder, onChange }: Props) {
  const [inspectors, setInspectors] = useState<Inspector[]>([]);

  useEffect(() => {
    setInspectors(listInspectorsForSite(siteId));
  }, [siteId]);

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder || 'Select inspector…'}</option>
      {inspectors.map((i) => (
        <option key={i.id} value={i.name}>{i.name}</option>
      ))}
    </select>
  );
}
