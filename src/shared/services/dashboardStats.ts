import type { Inspection, Site } from '../types/inspection';

const dayKey = (value: string) => value.slice(0, 10);
const percent = (part: number, total: number) => `${total ? Math.round((part / total) * 100) : 0}%`;

export function buildDashboardStats(
  inspections: Inspection[],
  sites: Site[],
  startDate: string,
  endDate: string,
  selectedSite: string,
) {
  const siteById = new Map(sites.map((site) => [site.id, site]));
  const filtered = inspections.filter((inspection) => {
    const date = dayKey(inspection.completedAt || inspection.lastEditedAt || inspection.startedAt);
    return date >= startDate && date <= endDate && (selectedSite === 'all' || inspection.siteId === selectedSite);
  });

  const dateKeys: string[] = [];
  const cursor = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  while (cursor <= end && dateKeys.length < 366) {
    dateKeys.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  const relevantSites = sites.filter((site) => selectedSite === 'all' || site.id === selectedSite);
  const siteRows = relevantSites.map((site) => {
    const rows = filtered.filter((inspection) => inspection.siteId === site.id);
    const flagged = rows.filter((inspection) => inspection.flaggedItemsCount > 0 || inspection.qualityFlag).length;
    const cycleMinutes = rows.flatMap((inspection) => {
      if (!inspection.completedAt) return [];
      const minutes = (Date.parse(inspection.completedAt) - Date.parse(inspection.startedAt)) / 60_000;
      return Number.isFinite(minutes) && minutes >= 0 ? [minutes] : [];
    });
    const inspectors = new Set(rows.flatMap((inspection) => [inspection.startedBy, inspection.completedBy].filter(Boolean)));
    return {
      id: site.id,
      name: site.name,
      loads: rows.length,
      flagRate: percent(flagged, rows.length),
      cycle: cycleMinutes.length ? `${Math.round(cycleMinutes.reduce((a, b) => a + b, 0) / cycleMinutes.length)}m` : '—',
      disc: rows.reduce((sum, inspection) => sum + (inspection.flaggedItemsCount || 0), 0),
      inspectors: inspectors.size,
      status: 'Local',
      cls: 'ok',
    };
  });

  const inspectorGroups = new Map<string, Inspection[]>();
  filtered.forEach((inspection) => {
    const name = inspection.completedBy || inspection.startedBy || 'Unknown';
    inspectorGroups.set(name, [...(inspectorGroups.get(name) || []), inspection]);
  });
  const inspectorRows = [...inspectorGroups.entries()].map(([name, rows]) => {
    const flagged = rows.filter((inspection) => inspection.flaggedItemsCount > 0 || inspection.qualityFlag).length;
    return {
      name,
      site: siteById.get(rows[0]?.siteId)?.name || rows[0]?.siteId || 'Unknown',
      loads: rows.length,
      flagRate: percent(flagged, rows.length),
      cycle: '—',
      workload: filtered.length ? Math.round((rows.length / filtered.length) * 100) : 0,
    };
  }).sort((a, b) => b.loads - a.loads);

  const flagged = filtered.filter((inspection) => inspection.flaggedItemsCount > 0 || inspection.qualityFlag);
  const completed = filtered.filter((inspection) => inspection.status === 'COMPLETED');
  const reasonCounts = new Map<string, number>();
  flagged.forEach((inspection) => {
    const reason = inspection.qualityFlag?.reason || 'other';
    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
  });

  return {
    kpis: [
      { label: 'Loads inspected', value: filtered.length, delta: `${completed.length} completed` },
      { label: 'Flag rate', value: percent(flagged.length, filtered.length), delta: `${flagged.length} flagged` },
      { label: 'Discrepancies', value: filtered.reduce((sum, row) => sum + (row.flaggedItemsCount || 0), 0), delta: 'Recorded locally' },
      { label: 'Active inspectors', value: inspectorRows.length, delta: 'On this device' },
    ],
    siteRows,
    inspectorRows,
    openFlags: flagged.map((inspection) => ({
      load: inspection.bol?.loadNumber?.value || inspection.id.slice(0, 8),
      site: siteById.get(inspection.siteId)?.name || inspection.siteId,
      inspector: inspection.completedBy || inspection.startedBy || 'Unknown',
      reason: (inspection.qualityFlag?.otherReason || inspection.qualityFlag?.reason || 'Inspection discrepancy').replace(/_/g, ' '),
      sev: inspection.flaggedItemsCount > 1 ? 'High' : 'Review',
      sevCls: inspection.flaggedItemsCount > 1 ? 'danger' : 'warning',
      when: dayKey(inspection.qualityFlag?.flaggedAt || inspection.lastEditedAt || inspection.startedAt),
    })),
    charts: {
      dateLabels: dateKeys.map((date) => date.slice(5)),
      throughput: relevantSites.map((site) => ({
        label: site.name,
        data: dateKeys.map((date) => filtered.filter((row) => row.siteId === site.id && dayKey(row.completedAt || row.lastEditedAt || row.startedAt) === date).length),
      })),
      flagTrend: dateKeys.map((date) => {
        const rows = filtered.filter((row) => dayKey(row.completedAt || row.lastEditedAt || row.startedAt) === date);
        return rows.length ? Math.round((rows.filter((row) => row.flaggedItemsCount > 0 || row.qualityFlag).length / rows.length) * 100) : 0;
      }),
      flagReasons: {
        labels: [...reasonCounts.keys()].map((reason) => reason.replace(/_/g, ' ')),
        values: [...reasonCounts.values()],
      },
    },
  };
}
