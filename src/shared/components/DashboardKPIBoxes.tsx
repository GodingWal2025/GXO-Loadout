

export interface DashboardKPI {
  label: string;
  val: string | number;
  color: string;
  desc: string;
}

export function DashboardKPIBoxes({ kpis }: { kpis: DashboardKPI[] }) {
  return (
    <div className="d-flex gap-3 mb-4" style={{ overflowX: 'auto' }}>
      {kpis.map((kpi, idx) => (
        <div key={idx} style={{ flex: '1 1 0', minWidth: 120 }}>
          <div className="card border-0 p-3 shadow-sm h-100" style={{ background: 'var(--surface, #fff)' }}>
            <span className="text-muted small fw-semibold d-block mb-1 text-uppercase" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{kpi.label}</span>
            <h2 className={`fw-bold mb-0 ${kpi.color}`}>{kpi.val}</h2>
            {kpi.desc && <span className="text-muted" style={{ fontSize: 11 }}>{kpi.desc}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
