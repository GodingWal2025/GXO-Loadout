import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Chart from 'chart.js/auto';

const COLORS = ['#1e5635', '#b8860b', '#8b1f1f', '#5a5a5a', '#999'];

export function DashboardRoute() {
  const throughputRef = useRef<HTMLCanvasElement | null>(null);
  const donutRef = useRef<HTMLCanvasElement | null>(null);
  const flagTrendRef = useRef<HTMLCanvasElement | null>(null);
  const flagReasonsRef = useRef<HTMLCanvasElement | null>(null);

  // Date range state - default to last 14 days
  const today = new Date();
  const twoWeeksAgo = new Date(today);
  twoWeeksAgo.setDate(today.getDate() - 13);
  const toISODate = (d: Date) => d.toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(toISODate(twoWeeksAgo));
  const [endDate, setEndDate] = useState(toISODate(today));
  const [presetRange, setPresetRange] = useState<'7' | '14' | '30' | '90' | 'custom'>('14');
  const [selectedSite, setSelectedSite] = useState<string>('all');
  
  // Real stats loaded from the SQLite backend
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyPreset = (days: '7' | '14' | '30' | '90') => {
    setPresetRange(days);
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (parseInt(days) - 1));
    setStartDate(toISODate(start));
    setEndDate(toISODate(end));
  };

  // Fetch stats from backend whenever filters change
  useEffect(() => {
    let active = true;
    const fetchStats = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/dashboard/stats?startDate=${startDate}&endDate=${endDate}&siteId=${selectedSite}`);
        if (!res.ok) {
          throw new Error(`Server returned ${res.status}: ${await res.text()}`);
        }
        const data = await res.json();
        if (active) {
          setStats(data);
          setError(null);
        }
      } catch (err) {
        if (active) {
          console.error('[DashboardRoute] Failed to fetch stats:', err);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    fetchStats();
    return () => {
      active = false;
    };
  }, [startDate, endDate, selectedSite]);

  // Instantiate and update Chart.js when stats data changes
  useEffect(() => {
    if (!stats || !stats.charts) return;
    
    const charts: Chart[] = [];
    const dateLabels = stats.charts.dateLabels;

    // Throughput Chart
    if (throughputRef.current) {
      const datasets = stats.charts.throughput.map((ds: any, idx: number) => ({
        label: ds.label,
        data: ds.data,
        backgroundColor: COLORS[idx % COLORS.length]
      }));

      charts.push(new Chart(throughputRef.current, {
        type: 'bar',
        data: {
          labels: dateLabels,
          datasets: datasets,
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { stacked: true, grid: { display: false } },
            y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
          },
        },
      }));
    }

    // Site breakdown Donut Chart
    if (donutRef.current) {
      charts.push(new Chart(donutRef.current, {
        type: 'doughnut',
        data: {
          labels: stats.siteRows.map((s: any) => s.name),
          datasets: [{ data: stats.siteRows.map((s: any) => s.loads), backgroundColor: COLORS, borderWidth: 0 }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '65%',
          plugins: { legend: { display: false } },
        },
      }));
    }

    // Flag rate trend Line Chart
    if (flagTrendRef.current) {
      charts.push(new Chart(flagTrendRef.current, {
        type: 'line',
        data: {
          labels: dateLabels,
          datasets: [{
            label: 'Flag rate',
            data: stats.charts.flagTrend,
            borderColor: COLORS[0],
            backgroundColor: 'rgba(30,86,53,0.08)',
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: COLORS[0],
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, ticks: { callback: (v) => v + '%' } },
            x: { grid: { display: false } },
          },
        },
      }));
    }

    // Flag reasons Bar Chart
    if (flagReasonsRef.current) {
      charts.push(new Chart(flagReasonsRef.current, {
        type: 'bar',
        data: {
          labels: stats.charts.flagReasons.labels,
          datasets: [{
            data: stats.charts.flagReasons.values,
            backgroundColor: [COLORS[2], COLORS[1], COLORS[1], COLORS[0], COLORS[4]],
          }],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } },
        },
      }));
    }

    return () => charts.forEach((c) => c.destroy());
  }, [stats]);

  // Export statistics as a CSV file
  const handleExportCSV = () => {
    if (!stats) return;
    let csvContent = "Site Performance Metrics\n";
    csvContent += "Site,Loads Inspected,Flag Rate,Avg Cycle Time,Discrepancies Caught,Active Inspectors,Status\n";
    stats.siteRows.forEach((s: any) => {
      csvContent += `"${s.name}",${s.loads},"${s.flagRate}","${s.cycle}",${s.disc},${s.inspectors},"${s.status}"\n`;
    });
    
    csvContent += "\nInspector Performance Metrics\n";
    csvContent += "Inspector,Site,Loads,Flag Rate,Avg Cycle Time,Workload %\n";
    stats.inspectorRows.forEach((i: any) => {
      csvContent += `"${i.name}","${i.site}",${i.loads},"${i.flagRate}","${i.cycle}",${i.workload}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `gxo-loadout-stats-${startDate}-to-${endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportPDF = () => {
    window.print();
  };

  return (
    <main className="dashboard-print-container">
      <div className="page-head">
        <div className="row-between">
          <div>
            <h1 className="page-head__title">Operations <em>dashboard</em></h1>
            <div className="page-head__sub">Cross-site edge diagnostics · live database stats</div>
          </div>
          <Link to="/" className="btn btn--ghost no-print">← Home</Link>
        </div>
      </div>

      <div
        className="no-print"
        style={{
          background: 'var(--surface-tint)',
          padding: '16px 20px',
          marginBottom: 32,
          border: '1px solid var(--rule-soft)',
          display: 'flex',
          gap: 16,
          alignItems: 'flex-end',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="xs soft" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            Quick range
          </div>
          <div className="flex gap-4">
            {(['7', '14', '30', '90'] as const).map((d) => (
              <button
                key={d}
                className={`btn btn--sm ${presetRange === d ? 'btn--accent' : ''}`}
                onClick={() => applyPreset(d)}
              >
                {d}d
              </button>
            ))}
            <button
              className={`btn btn--sm ${presetRange === 'custom' ? 'btn--accent' : ''}`}
              onClick={() => setPresetRange('custom')}
            >
              Custom
            </button>
          </div>
        </div>
        <div>
          <div className="xs soft" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            From
          </div>
          <input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPresetRange('custom'); }}
            style={{ minHeight: 36, padding: '6px 10px' }}
          />
        </div>
        <div>
          <div className="xs soft" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            To
          </div>
          <input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPresetRange('custom'); }}
            style={{ minHeight: 36, padding: '6px 10px' }}
          />
        </div>
        <div>
          <div className="xs soft" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            Site
          </div>
          <select 
            style={{ minHeight: 36 }} 
            value={selectedSite} 
            onChange={(e) => setSelectedSite(e.target.value)}
          >
            <option value="all">All sites</option>
            {stats && stats.siteRows && stats.siteRows.filter((s: any) => s.name !== "No Data" && s.name !== "No data").map((s: any) => (
              <option key={s.name} value={s.name.toLowerCase().replace(/ /g, '-')}>{s.name}</option>
            ))}
            {/* Fallbacks if stats not loaded yet */}
            {(!stats || !stats.siteRows) && (
              <>
                <option value="oak-ridge">Oak Ridge</option>
                <option value="riverside">Riverside</option>
                <option value="pine-creek">Pine Creek</option>
                <option value="westfield">Westfield</option>
                <option value="lakemont">Lakemont</option>
              </>
            )}
          </select>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={handleExportCSV} disabled={loading || !stats}>⇣ Export CSV</button>
        <button className="btn" onClick={handleExportPDF} disabled={loading || !stats}>⎙ Export PDF</button>
      </div>

      {error && (
        <div className="banner banner--danger" style={{ marginBottom: 24 }}>
          <span className="banner__icon">✕</span>
          <div className="banner__body">Failed to load live metrics: {error}</div>
        </div>
      )}

      {loading && !stats && (
        <div className="empty">
          <div className="empty__title">Loading statistics...</div>
          <div className="empty__sub">Reading from edge SQLite database.</div>
        </div>
      )}

      {stats && (
        <>
          <div className="banner banner--info mb-24 no-print">
            <span className="banner__icon">i</span>
            <div className="banner__body">
              Displaying live aggregated edge data from <strong>{startDate}</strong> to <strong>{endDate}</strong> for <strong>{selectedSite === 'all' ? 'all sites' : selectedSite.replace(/-/g, ' ').toUpperCase()}</strong>.
            </div>
          </div>

          <section className="section">
            <div className="section__head">
              <h2 className="section__title">At a <em>glance</em></h2>
              <span className="section__meta">Edge KPIs</span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '1px',
                background: 'var(--rule-soft)',
                border: '1px solid var(--rule-soft)',
              }}
            >
              {stats.kpis.map((k: any) => (
                <div key={k.label} style={{ background: 'var(--surface)', padding: 24 }}>
                  <div className="xs soft" style={{ textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                    {k.label}
                  </div>
                  <div style={{ fontSize: 36, fontWeight: 500, lineHeight: 1, letterSpacing: '-0.02em', marginBottom: 8 }}>
                    {k.value}
                  </div>
                  <div className="xs soft">
                    {k.delta}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="section">
            <div className="section__head">
              <h2 className="section__title">Throughput <em>trends</em></h2>
              <span className="section__meta">Daily load inspections</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
              <div className="card">
                <div className="fw-500 small mb-12">Loads inspected per day</div>
                <div style={{ position: 'relative', height: 240 }}>
                  <canvas
                    ref={throughputRef}
                    role="img"
                    aria-label="Stacked bar chart of daily loads inspected per site"
                  />
                </div>
              </div>
              <div className="card">
                <div className="fw-500 small mb-12">Loads breakdown by site</div>
                <div style={{ position: 'relative', height: 180 }}>
                  <canvas
                    ref={donutRef}
                    role="img"
                    aria-label="Donut chart breakdown of loads by site"
                  />
                </div>
                <div className="flex-col gap-8 mt-12">
                  {stats.siteRows.map((s: any, i: number) => (
                    <div key={s.name} className="row-between xs">
                      <span className="flex gap-8">
                        <span style={{ width: 8, height: 8, background: COLORS[i % COLORS.length] }} />
                        {s.name}
                      </span>
                      <span className="num fw-500">{s.loads}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="section">
            <div className="section__head">
              <h2 className="section__title">Quality &amp; <em>accuracy</em></h2>
              <span className="section__meta">Inspected quality flags</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div className="card">
                <div className="fw-500 small mb-12">Flag rate over time</div>
                <div className="xs soft mb-12">Percentage of inspects flagged per day</div>
                <div style={{ position: 'relative', height: 220 }}>
                  <canvas
                    ref={flagTrendRef}
                    role="img"
                    aria-label="Line chart of flag rate over time"
                  />
                </div>
              </div>
              <div className="card">
                <div className="fw-500 small mb-12">Flag reasons</div>
                <div className="xs soft mb-12">Categorized issues logged by VLM &amp; inspectors</div>
                <div style={{ position: 'relative', height: 220 }}>
                  <canvas
                    ref={flagReasonsRef}
                    role="img"
                    aria-label="Horizontal bar chart of flag reasons"
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="section">
            <div className="section__head">
              <h2 className="section__title">By <em>site</em></h2>
              <span className="section__meta">Local site statistics</span>
            </div>
            <div className="table-card">
              <table className="data">
                <thead>
                  <tr>
                    <th>Site</th>
                    <th className="right">Loads</th>
                    <th className="right">Flag rate</th>
                    <th className="right">Cycle</th>
                    <th className="right">Disc.</th>
                    <th className="right">Insp.</th>
                    <th className="right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.siteRows.map((s: any) => (
                    <tr key={s.name}>
                      <td className="fw-500">{s.name}</td>
                      <td className="right num">{s.loads}</td>
                      <td className="right num">{s.flagRate}</td>
                      <td className="right num">{s.cycle}</td>
                      <td className="right num">{s.disc}</td>
                      <td className="right num">{s.inspectors}</td>
                      <td className="right">
                        <span className={`pill pill--${s.cls}`}>{s.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="section">
            <div className="section__head">
              <h2 className="section__title">By <em>inspector</em></h2>
              <span className="section__meta">Ranked by volume</span>
            </div>
            <div className="table-card">
              <table className="data">
                <thead>
                  <tr>
                    <th>Inspector</th>
                    <th>Site</th>
                    <th className="right">Loads</th>
                    <th className="right">Flag rate</th>
                    <th className="right">Cycle</th>
                    <th className="right">Workload</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.inspectorRows.map((i: any) => (
                    <tr key={i.name}>
                      <td className="fw-500">{i.name}</td>
                      <td>{i.site}</td>
                      <td className="right num">{i.loads}</td>
                      <td className="right num">{i.flagRate}</td>
                      <td className="right num">{i.cycle}</td>
                      <td className="right" style={{ width: 160 }}>
                        <div className="mini-bar">
                          <div style={{ width: `${i.workload}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {stats.inspectorRows.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center' }} className="soft">No inspectors active in selected period.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="section">
            <div className="section__head">
              <h2 className="section__title">Open <em>flags</em></h2>
              <span className="section__meta">Unresolved quality issues</span>
            </div>
            <div className="table-card">
              <table className="data">
                <thead>
                  <tr>
                    <th>Load #</th>
                    <th>Site</th>
                    <th>Inspector</th>
                    <th>Reason</th>
                    <th>Severity</th>
                    <th className="right">Flagged</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.openFlags.map((f: any) => (
                    <tr key={f.load}>
                      <td className="mono fw-500">#{f.load}</td>
                      <td>{f.site}</td>
                      <td>{f.inspector}</td>
                      <td>{f.reason}</td>
                      <td>
                        <span className={`pill pill--${f.sevCls}`}>{f.sev}</span>
                      </td>
                      <td className="right num">{f.when}</td>
                    </tr>
                  ))}
                  {stats.openFlags.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center' }} className="soft">All clear! No open flags in selected period.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
