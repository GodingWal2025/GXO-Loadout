import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getDeviceConfig } from '../lib/deviceConfig';
import { dbListInProgressForSite, dbListCompletedForSite } from '../shared';
import type { Inspection } from '../shared';
import { InspectionListCard } from '../components/InspectionListCard';

type Tab = 'inProgress' | 'completed';

export function HomeRoute() {
  const navigate = useNavigate();
  const config = getDeviceConfig();
  const [tab, setTab] = useState<Tab>('inProgress');
  const [inProgress, setInProgress] = useState<Inspection[]>([]);
  const [completed, setCompleted] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!config) {
      navigate('/setup');
      return;
    }
    Promise.all([
      dbListInProgressForSite(config.siteId),
      dbListCompletedForSite(config.siteId),
    ])
      .then(([ip, c]) => {
        setInProgress(ip);
        setCompleted(c);
      })
      .finally(() => setLoading(false));
  }, [config, navigate]);

  if (!config) return null;

  const list = tab === 'inProgress' ? inProgress : completed;

  return (
    <main>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Inspections</h1>
          <div className="page-head__sub">
            {config.siteName} · {inProgress.length} in progress · {completed.length} completed
          </div>
        </div>
      </div>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Start <em>new</em></h2>
          <span className="section__meta">pick a workflow</span>
        </div>
        <div className="workflow-grid">
          <Link to="/inspection/new/outbound" className="workflow-card workflow-card--primary">
            <div className="workflow-card__type">Outbound</div>
            <div className="workflow-card__title">Order verification</div>
            <div className="workflow-card__sub">
              Verify a load against the printed picklist before it ships
            </div>
            <div className="workflow-card__arrow">→</div>
          </Link>

          <Link to="/inspection/new/inbound" className="workflow-card">
            <div className="workflow-card__type">Inbound</div>
            <div className="workflow-card__title">Inbound loads</div>
            <div className="workflow-card__sub">
              Receive and verify incoming loads
            </div>
            <div className="workflow-card__arrow">→</div>
          </Link>

          <Link to="/inspection/new/returns" className="workflow-card">
            <div className="workflow-card__type">Returns</div>
            <div className="workflow-card__title">Returned product</div>
            <div className="workflow-card__sub">
              Process returned product back into inventory
            </div>
            <div className="workflow-card__arrow">→</div>
          </Link>

          <Link to="/inspection/new/retag" className="workflow-card">
            <div className="workflow-card__type">Retag</div>
            <div className="workflow-card__title">Re-label inventory</div>
            <div className="workflow-card__sub">
              Re-label or correct existing inventory
            </div>
            <div className="workflow-card__arrow">→</div>
          </Link>

          <Link to="/inspection/new/discard" className="workflow-card">
            <div className="workflow-card__type">Discard</div>
            <div className="workflow-card__title">Discard product</div>
            <div className="workflow-card__sub">
              Remove damaged or expired product from inventory
            </div>
            <div className="workflow-card__arrow">→</div>
          </Link>

          <Link to="/investigation" className="workflow-card">
            <div className="workflow-card__type">Investigation</div>
            <div className="workflow-card__title">Trace shipments</div>
            <div className="workflow-card__sub">
              Search completed loads by site, batch code, or delivery number
            </div>
            <div className="workflow-card__arrow">→</div>
          </Link>
        </div>
      </section>

      <section className="section">
        <div className="admin-tabs">
          <button
            className={`admin-tab ${tab === 'inProgress' ? 'active' : ''}`}
            onClick={() => setTab('inProgress')}
          >
            In progress
            {inProgress.length > 0 && (
              <span className="admin-tab__count">{inProgress.length}</span>
            )}
          </button>
          <button
            className={`admin-tab ${tab === 'completed' ? 'active' : ''}`}
            onClick={() => setTab('completed')}
          >
            Completed
            {completed.length > 0 && (
              <span className="admin-tab__count">{completed.length}</span>
            )}
          </button>
        </div>

        {loading ? (
          <div className="empty">
            <div className="empty__sub">Loading…</div>
          </div>
        ) : list.length === 0 ? (
          <div className="empty">
            <div className="empty__title">
              {tab === 'inProgress' ? 'No inspections in progress' : 'No completed inspections yet'}
            </div>
            <div className="empty__sub">
              {tab === 'inProgress'
                ? 'Tap a workflow above to begin a load.'
                : 'Completed inspections will appear here.'}
            </div>
          </div>
        ) : (
          <div>
            {list.map((i) => (
              <InspectionListCard key={i.id} inspection={i} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
