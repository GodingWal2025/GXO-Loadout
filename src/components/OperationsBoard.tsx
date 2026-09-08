import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Inspection } from '../shared/types/inspection';
import { dbListAllInspections } from '../shared/services/db';
import { inspectionReadiness, lastCompletedStep, flagReasonLabel } from '../shared/rules/operations';
import { listInspectionFlags } from '../shared/rules/inspectionFlags';
import { useT } from '../shared/i18n/LanguageContext';

/** Live operational queue, independent of the dashboard's historical date range. */
export function OperationsBoard({ siteId, supervisor = false }: { siteId?: string; supervisor?: boolean }) {
  const t = useT();
  const typeLabels: Record<Inspection['type'], string> = {
    outbound: t('home.typeOutbound', 'Outbound'), inbound: t('home.typeInbound', 'Inbound'),
    returns: t('home.typeReturns', 'Returns'), retag: t('home.typeRetag', 'Retag'), discard: t('home.typeDiscard', 'Discard'),
  };
  const [records, setRecords] = useState<Inspection[]>([]);
  const [search, setSearch] = useState('');
  const [staleHours, setStaleHours] = useState(2);
  const [onlyStale, setOnlyStale] = useState(false);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let active = true;
    const load = () => void dbListAllInspections().then(items => { if (active) { setRecords(items); setError(false); } }).catch(() => { if (active) setError(true); });
    load();
    window.addEventListener('loadout-data-updated', load);
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => { active = false; window.removeEventListener('loadout-data-updated', load); clearInterval(timer); };
  }, []);
  const current = records.filter(record => !record.archived && record.status !== 'CANCELLED' && (!siteId || siteId === 'all' || record.siteId === siteId));
  const ranked = current.map(record => {
    const issues = inspectionReadiness(record, t);
    const open = record.status === 'PENDING' || record.status === 'IN_PROGRESS';
    const age = Math.max(0, now - Date.parse(record.lastEditedAt || record.startedAt));
    const stale = open && age >= staleHours * 3600000;
    const flags = listInspectionFlags(record).length;
    return { record, issues, age, stale, flags, open };
  }).filter(row => supervisor ? (row.open && (row.issues.length > 0 || row.stale)) || row.flags > 0 : row.open)
    .filter(row => !onlyStale || row.stale)
    .filter(({ record }) => JSON.stringify([record.id, record.picklist.loadNumber.value, record.bol.loadNumber.value, record.inbound?.bolNumber.value, record.returnsBol?.bolNumber.value, record.currentInspector, record.stagingLocation]).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.flags - a.flags || Number(b.stale) - Number(a.stale) || b.issues.length - a.issues.length || b.age - a.age);
  const reasons = new Map<string, number>();
  for (const record of current.filter(record => Date.parse(record.lastEditedAt || record.startedAt) >= now - 14 * 86400000)) {
    for (const flag of listInspectionFlags(record)) { const reason = flag.reason || flag.source; reasons.set(reason, (reasons.get(reason) || 0) + 1); }
  }
  return <section className="section">
    <div className="section__head"><h2 className="section__title">{supervisor ? t('ops.supervisor', 'Supervisor attention queue') : t('ops.shift', 'Shift handoff')}</h2></div>
    <p className="small soft">{t('ops.queueHint', 'Highest priority first: flagged loads, stalled work, then remaining checklist items. Updates from this device and cloud sync appear automatically.')}</p>
    <div className="operations-filters">
      <label>{t('ops.searchLoads', 'Find load, inspector, or lane')}<input value={search} onChange={event => setSearch(event.target.value)} type="search" /></label>
      <label>{t('ops.staleAfter', 'Stalled after (hours)')}<input type="number" min={1} max={72} value={staleHours} onChange={event => setStaleHours(Math.max(1, Math.min(72, Number(event.target.value) || 1)))} /></label>
      <label><input type="checkbox" checked={onlyStale} onChange={event => setOnlyStale(event.target.checked)} /> {t('ops.onlyStalled', 'Only stalled inspections')}</label>
    </div>
    {error && <p role="alert">{t('ops.queueError', 'Could not load inspections. Reopen this screen to retry.')}</p>}
    {supervisor && <p>{t('ops.repeated', 'Repeated flags in the last 14 days:')} {[...reasons].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]).map(([reason, count]) => `${flagReasonLabel(reason, t)} (${count})`).join(' · ') || '—'}</p>}
    {!error && !ranked.length && <p>{t('ops.noQueue', 'No inspections match this queue.')}</p>}
    <div className="operations-queue">{ranked.map(({ record, issues, stale, flags }) => {
      const number = record.picklist.loadNumber.value || record.bol.loadNumber.value || record.inbound?.bolNumber.value || record.returnsBol?.bolNumber.value || record.id.slice(0, 8);
      const note = record.operationalNotes?.filter(entry => entry.kind === 'handoff').slice(-1)[0];
      const handoff = record.handoffLog?.slice(-1)[0];
      const latestNote = note && (!handoff?.note || note.at >= handoff.at) ? note.text : handoff?.note;
      return <article className="card" key={record.id}>
        <h3><Link to={`/inspection/${record.id}${record.type === 'inbound' ? '/verify-inbound' : ''}`}>#{number} →</Link></h3>
        <p>{record.currentInspector || record.startedBy || '—'} · {record.stagingLocation || '—'} · {typeLabels[record.type]}</p>
        <p>{lastCompletedStep(record, t)}</p>
        <p className="small">{t('ops.lastActivity', 'Last activity:')} {new Date(record.lastEditedAt || record.startedAt).toLocaleString()}</p>
        <p>{t('ops.queueCounts', '{issues} checklist items • {flags} flags', { issues: issues.length, flags })} {stale && <strong className="pill pill--warn">{t('ops.stalled', 'Stalled')}</strong>}</p>
        {latestNote && <blockquote style={{ whiteSpace: 'pre-wrap' }}>{latestNote}</blockquote>}
        {issues[0] && <Link to={issues[0].to}>{t('ops.nextAction', 'Next action:')} {issues[0].label} →</Link>}
      </article>;
    })}</div>
  </section>;
}
