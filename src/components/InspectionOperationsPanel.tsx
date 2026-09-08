import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { Inspection } from '../shared/types/inspection';
import { inspectionReadiness, reconcileInspection } from '../shared/rules/operations';
import { useT } from '../shared/i18n/LanguageContext';
import { generateId } from '../shared/utils/uuid';
import { downloadInspectionEvidence } from '../lib/inspectionEvidence';

export function InspectionOperationsPanel({ inspection, onNote }: {
  inspection: Inspection;
  onNote?: (note: NonNullable<Inspection['operationalNotes']>[number]) => void;
}) {
  const t = useT();
  const location = useLocation();
  useEffect(() => {
    if (location.hash === '#reconciliation') document.getElementById('reconciliation')?.scrollIntoView({ block: 'start' });
  }, [location.hash]);
  const issues = inspectionReadiness(inspection, t);
  const rows = reconcileInspection(inspection);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'handoff' | 'resolution'>('handoff');
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  async function exportEvidence() {
    setExporting(true); setMessage('');
    try {
      const missing = await downloadInspectionEvidence(inspection, t);
      setMessage(missing ? t('ops.missingExport', 'Exported with {count} missing images. Reconnect and export again for a complete package.', { count: missing }) : t('ops.exported', 'Evidence package downloaded.'));
    } catch { setMessage(t('ops.exportFailed', 'Export failed. Please try again.')); }
    finally { setExporting(false); }
  }
  return <section className="section operations-panel">
    <div className="section__head"><h2 className="section__title">{t('ops.readiness', 'Load readiness')}</h2>
      <button className="btn btn--sm" disabled={exporting} onClick={() => void exportEvidence()}>{exporting ? t('ops.exporting', 'Preparing evidence…') : t('ops.export', 'Download evidence package')}</button>
    </div>
    <p role="status" className={issues.length ? 'pill pill--warn' : 'pill pill--success'}>{issues.length ? t('ops.readinessCount', '{count} items need attention', { count: issues.length }) : inspection.type === 'outbound' ? t('ops.ready', 'Ready to load — checklist clear') : t('ops.readyReview', 'Ready for final review — checklist clear')}</p>
    {message && <p role="status">{message}</p>}
    <details open={issues.length > 0}><summary>{t('ops.openIssues', 'Items needing attention')}</summary>
      <ul className="readiness-list">{issues.map(issue => <li key={issue.id}><Link to={issue.to}>{issue.label} →</Link></li>)}</ul>
    </details>
    <details id="reconciliation" open={location.hash === '#reconciliation'}><summary>{t('ops.reconciliation', 'Expected versus actual')}</summary>
      <p className="small soft">{t('ops.unitsHint', 'Each row keeps its own unit. A dash means no expected quantity was recorded.')}</p>
      <div className="operations-table"><table className="data"><thead><tr>
        <th>{t('ops.delivery', 'Delivery')}</th><th>SKU</th><th>{t('ops.batch', 'Batch')}</th><th>{t('ops.product', 'Product')}</th><th>{t('ops.expected', 'Expected')}</th><th>{t('ops.actual', 'Actual')}</th><th>{t('ops.unit', 'Unit')}</th><th>{t('ops.difference', 'Difference')}</th>
      </tr></thead><tbody>{rows.map(row => <tr key={row.id} className={row.unexpected || (!row.unknownExpected && Math.abs(row.actual - row.expected) > 0.001) ? 'reconciliation-alert' : ''}>
        <td>{row.delivery || '—'}</td><td>{row.sku || '—'}</td><td>{row.batch || '—'}</td><td>{row.description}</td><td>{row.unknownExpected ? '—' : row.expected.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td><td>{row.actual.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td><td>{row.unit}</td><td>{row.unexpected ? t('ops.unexpected', 'Unexpected product') : row.unknownExpected ? '—' : (row.actual - row.expected).toLocaleString(undefined, { maximumFractionDigits: 2, signDisplay: 'exceptZero' })}</td>
      </tr>)}</tbody></table></div>
    </details>
    <details><summary>{t('ops.notes', 'Handoff and resolution notes')}</summary>
      <ul>{(inspection.handoffLog || []).filter(entry => entry.note).map((entry, index) => <li key={`handoff-${index}`}><strong>{entry.fromInspector} → {entry.toInspector}</strong> · {new Date(entry.at).toLocaleString()}<p>{entry.note}</p></li>)}
        {(inspection.operationalNotes || []).map(note => <li key={note.id}><strong>{note.by}</strong> · {new Date(note.at).toLocaleString()} · {note.kind === 'handoff' ? t('ops.handoffNote', 'Handoff note') : t('ops.resolutionNote', 'Resolution note')}<p style={{ whiteSpace: 'pre-wrap' }}>{note.text}</p></li>)}</ul>
      {onNote && <form onSubmit={event => { event.preventDefault(); if (!text.trim()) return; onNote({ id: generateId(), at: new Date().toISOString(), by: inspection.currentInspector || inspection.startedBy || 'unknown', kind, text: text.trim() }); setText(''); }}>
        <label>{t('ops.noteType', 'Note type')}<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="handoff">{t('ops.handoffNote', 'Handoff note')}</option><option value="resolution">{t('ops.resolutionNote', 'Resolution note')}</option></select></label>
        <label>{t('ops.noteText', 'What does the next person need to know?')}<textarea value={text} onChange={event => setText(event.target.value)} maxLength={2000} required rows={3} /></label>
        <p className="small soft">{t('ops.notePolicy', 'Notes preserve the history. Correct the underlying issue to clear the readiness checklist.')}</p>
        <button className="btn btn--sm" disabled={!text.trim()}>{t('ops.addNote', 'Save note')}</button>
      </form>}
    </details>
  </section>;
}
