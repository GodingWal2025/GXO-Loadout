import { useState } from 'react';
import type { Inspection } from '../shared/types/inspection';
import { useT } from '../shared/i18n/LanguageContext';
import { generateId } from '../shared/utils/uuid';
import { downloadInspectionEvidence } from '../lib/inspectionEvidence';

/**
 * Shared audit-history panel for handoffs and resolution notes. Notes are
 * append-only from this component; the route that renders it remains responsible
 * for persisting the new entry on the inspection record.
 */
export function InspectionOperationsPanel({ inspection, onNote, showEvidenceDownload = false }: {
  inspection: Inspection;
  onNote?: (note: NonNullable<Inspection['operationalNotes']>[number]) => void;
  showEvidenceDownload?: boolean;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'handoff' | 'resolution'>('handoff');
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');

  // Evidence export is optional because it belongs on the final review page,
  // while the note history is useful during the entire workflow.
  async function exportEvidence() {
    setExporting(true); setMessage('');
    try {
      const missing = await downloadInspectionEvidence(inspection, t);
      setMessage(missing ? t('ops.missingExport', 'Exported with {count} missing images. Reconnect and export again for a complete package.', { count: missing }) : t('ops.exported', 'Evidence package downloaded.'));
    } catch { setMessage(t('ops.exportFailed', 'Export failed. Please try again.')); }
    finally { setExporting(false); }
  }
  return <section className="section operations-panel">
    {showEvidenceDownload && <>
      <div className="section__head">
        <button className="btn btn--sm" disabled={exporting} onClick={() => void exportEvidence()}>{exporting ? t('ops.exporting', 'Preparing evidence…') : t('ops.export', 'Download evidence package')}</button>
      </div>
      {message && <p role="status">{message}</p>}
    </>}
    <details><summary>{t('ops.notes', 'Handoff and resolution notes')}</summary>
      <ul>{(inspection.handoffLog || []).filter(entry => entry.note).map((entry, index) => <li key={`handoff-${index}`}><strong>{entry.fromInspector} → {entry.toInspector}</strong> · {new Date(entry.at).toLocaleString()}<p>{entry.note}</p></li>)}
        {(inspection.operationalNotes || []).map(note => <li key={note.id}><strong>{note.by}</strong> · {new Date(note.at).toLocaleString()} · {note.kind === 'handoff' ? t('ops.handoffNote', 'Handoff note') : t('ops.resolutionNote', 'Resolution note')}<p style={{ whiteSpace: 'pre-wrap' }}>{note.text}</p></li>)}</ul>
      {onNote && <form onSubmit={event => { event.preventDefault(); if (!text.trim()) return; onNote({ id: generateId(), at: new Date().toISOString(), by: inspection.currentInspector || inspection.startedBy || 'unknown', kind, text: text.trim() }); setText(''); }}>
        <label>{t('ops.noteType', 'Note type')}<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="handoff">{t('ops.handoffNote', 'Handoff note')}</option><option value="resolution">{t('ops.resolutionNote', 'Resolution note')}</option></select></label>
        <label>{t('ops.noteText', 'What does the next person need to know?')}<textarea value={text} onChange={event => setText(event.target.value)} maxLength={2000} required rows={3} /></label>
        <button className="btn btn--sm" disabled={!text.trim()}>{t('ops.addNote', 'Save note')}</button>
      </form>}
    </details>
  </section>;
}
