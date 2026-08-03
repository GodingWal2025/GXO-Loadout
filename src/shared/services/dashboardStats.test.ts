import { describe, expect, it } from 'vitest';
import { buildDashboardStats } from './dashboardStats';
import type { Inspection, Site } from '../types/inspection';

const sites = [
  { id: 'albert-lea', name: 'Albert Lea', active: true, createdAt: '2026-01-01' },
  { id: 'other', name: 'Other', active: true, createdAt: '2026-01-01' },
] as Site[];

function inspection(id: string, siteId: string, date: string, flagged = 0): Inspection {
  return {
    id,
    siteId,
    startedAt: `${date}T08:00:00Z`,
    completedAt: `${date}T09:00:00Z`,
    status: 'COMPLETED',
    startedBy: 'Alex',
    completedBy: 'Alex',
    flaggedItemsCount: flagged,
    bol: { loadNumber: { value: id } },
  } as Inspection;
}

describe('buildDashboardStats', () => {
  it('filters by date and site and calculates local KPIs', () => {
    const stats = buildDashboardStats([
      inspection('one', 'albert-lea', '2026-08-01', 1),
      inspection('two', 'other', '2026-08-01'),
      inspection('old', 'albert-lea', '2026-07-01'),
    ], sites, '2026-08-01', '2026-08-02', 'albert-lea');

    expect(stats.kpis[0].value).toBe(1);
    expect(stats.kpis[1].value).toBe('100%');
    expect(stats.siteRows[0]).toMatchObject({ name: 'Albert Lea', loads: 1, cycle: '60m' });
    expect(stats.openFlags).toHaveLength(1);
    expect(stats.charts.throughput[0].data).toEqual([1, 0]);
  });
});
