import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getDeviceConfig } from '../lib/deviceConfig';
import { dbListInProgressForSite, dbListCompletedForSite } from '../shared';
import type { Inspection } from '../shared';
import { InspectionListCard } from '../components/InspectionListCard';
import { useT } from '../shared/i18n/LanguageContext';

type Tab = 'inProgress' | 'completed';

export function HomeRoute() {
  const navigate = useNavigate();
  const t = useT();
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

    const fetchInspections = () => {
      Promise.all([
        dbListInProgressForSite(config.siteId),
        dbListCompletedForSite(config.siteId),
      ])
        .then(([inProgress, completed]) => {
          setInProgress(inProgress);
          setCompleted(completed);
        })
        .finally(() => setLoading(false));
    };

    fetchInspections();

    window.addEventListener('loadout-sync-updated', fetchInspections);
    return () => window.removeEventListener('loadout-sync-updated', fetchInspections);
  }, [config, navigate]);

  if (!config) return null;

  const list = tab === 'inProgress' ? inProgress : completed;

  return (
    <main>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">{t('home.title', 'Inspections')}</h1>
          <div className="page-head__sub">
            {config.siteName} ·{' '}
            {t('home.countsSummary', '{inProgress} in progress · {completed} completed', {
              inProgress: inProgress.length,
              completed: completed.length,
            })}
          </div>
        </div>
      </div>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            {t('home.startLead', 'Start')} <em>{t('home.startEm', 'new')}</em>
          </h2>
          <span className="section__meta">{t('home.pickWorkflow', 'pick a workflow')}</span>
        </div>
        <div className="workflow-grid">
          <Link to="/inspection/new/outbound" className="workflow-card workflow-card--primary">
            <div className="workflow-card__type">{t('home.typeOutbound', 'Outbound')}</div>
            <div className="workflow-card__title">{t('home.outboundTitle', 'Order verification')}</div>
            <div className="workflow-card__sub">
              {t('home.outboundSub', 'Verify a load against the printed picklist before it ships')}
            </div>
            <div className="workflow-card__arrow">→</div>
          </Link>

          <Link to="/inspection/new/inbound" className="workflow-card">
            <div className="workflow-card__type">{t('home.typeInbound', 'Inbound')}</div>
            <div className="workflow-card__title">{t('home.inboundTitle', 'Inbound loads')}</div>
            <div className="workflow-card__sub">
              {t('home.inboundSub', 'Receive and verify incoming loads')}
            </div>
            <div className="workflow-card__arrow">→</div>
          </Link>

          <Link to="/inspection/new/returns" className="workflow-card">
            <div className="workflow-card__type">{t('home.typeReturns', 'Returns')}</div>
            <div className="workflow-card__title">{t('home.returnsTitle', 'Returned product')}</div>
            <div className="workflow-card__sub">
              {t('home.returnsSub', 'Process returned product back into inventory')}
            </div>
            <div className="workflow-card__arrow">→</div>
          </Link>

          <Link to="/inspection/new/retag" className="workflow-card">
            <div className="workflow-card__type">{t('home.typeRetag', 'Retag')}</div>
            <div className="workflow-card__title">{t('home.retagTitle', 'Re-label inventory')}</div>
            <div className="workflow-card__sub">
              {t('home.retagSub', 'Re-label or correct existing inventory')}
            </div>
            <div className="workflow-card__arrow">→</div>
          </Link>

          <Link to="/inspection/new/discard" className="workflow-card">
            <div className="workflow-card__type">{t('home.typeDiscard', 'Discard')}</div>
            <div className="workflow-card__title">{t('home.discardTitle', 'Discard product')}</div>
            <div className="workflow-card__sub">
              {t('home.discardSub', 'Remove damaged or expired product from inventory')}
            </div>
            <div className="workflow-card__arrow">→</div>
          </Link>

          <Link to="/investigation" className="workflow-card">
            <div className="workflow-card__type">{t('home.typeInvestigation', 'Investigation')}</div>
            <div className="workflow-card__title">{t('home.investigationTitle', 'Trace shipments')}</div>
            <div className="workflow-card__sub">
              {t('home.investigationSub', 'Search completed loads by site, batch code, or delivery number')}
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
            {t('home.tabInProgress', 'In progress')}
            {inProgress.length > 0 && (
              <span className="admin-tab__count">{inProgress.length}</span>
            )}
          </button>
          <button
            className={`admin-tab ${tab === 'completed' ? 'active' : ''}`}
            onClick={() => setTab('completed')}
          >
            {t('home.tabCompleted', 'Completed')}
            {completed.length > 0 && (
              <span className="admin-tab__count">{completed.length}</span>
            )}
          </button>
        </div>

        {loading ? (
          <div className="empty">
            <div className="empty__sub">{t('home.loading', 'Loading…')}</div>
          </div>
        ) : list.length === 0 ? (
          <div className="empty">
            <div className="empty__title">
              {tab === 'inProgress'
                ? t('home.emptyInProgressTitle', 'No inspections in progress')
                : t('home.emptyCompletedTitle', 'No completed inspections yet')}
            </div>
            <div className="empty__sub">
              {tab === 'inProgress'
                ? t('home.emptyInProgressSub', 'Tap a workflow above to begin a load.')
                : t('home.emptyCompletedSub', 'Completed inspections will appear here.')}
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
