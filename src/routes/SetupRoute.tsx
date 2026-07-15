import { useNavigate, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { setDeviceConfig } from '../lib/deviceConfig';
import { listActiveSites, addSite } from '../services/sites';
import type { Site } from '../shared';

export function SetupRoute() {
  const navigate = useNavigate();
  const [sites, setSites] = useState<Site[]>(() => listActiveSites());
  const [siteId, setSiteId] = useState('');
  const [name, setName] = useState('');

  // Sites arrive asynchronously from the cloud on a fresh device — refresh the
  // list when they land so the user can pick their existing site.
  useEffect(() => {
    const refresh = () => setSites(listActiveSites());
    window.addEventListener('loadout-sites-updated', refresh);
    return () => window.removeEventListener('loadout-sites-updated', refresh);
  }, []);

  // Inline new-site form, used when there are no sites yet
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteAddress, setNewSiteAddress] = useState('');

  const createSite = () => {
    if (!newSiteName.trim()) return;
    const created = addSite(newSiteName.trim(), newSiteAddress.trim() || undefined);
    setSites(listActiveSites());
    setSiteId(created.id);
    setNewSiteName('');
    setNewSiteAddress('');
  };

  const submit = () => {
    if (!siteId) return;
    const site = sites.find((s) => s.id === siteId);
    if (!site) return;
    setDeviceConfig({
      siteId: site.id,
      siteName: site.name,
      configuredAt: new Date().toISOString(),
      configuredBy: name || 'admin',
    });
    navigate('/');
  };

  const noSites = sites.length === 0;

  return (
    <main style={{ maxWidth: 560 }}>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            Device <em>setup</em>
          </h1>
          <div className="page-head__sub">
            One-time configuration. After this, the device knows which site it belongs to.
          </div>
        </div>
      </div>

      {noSites ? (
        <>
          <div className="banner banner--warn">
            <span className="banner__icon">⚠</span>
            <div className="banner__body">
              <strong>No sites exist yet.</strong> Create the first site below to get started.
              You can add more sites later from the admin console.
            </div>
          </div>

          <section className="section">
            <div className="section__head">
              <h2 className="section__title">Create the <em>first site</em></h2>
            </div>

            <div className="field">
              <div className="field__label">Site name</div>
              <input
                value={newSiteName}
                onChange={(e) => setNewSiteName(e.target.value)}
                placeholder="e.g. Memphis Distribution Center"
                onKeyDown={(e) => e.key === 'Enter' && createSite()}
                autoFocus
              />
            </div>

            <div className="field">
              <div className="field__label">Address (optional)</div>
              <input
                value={newSiteAddress}
                onChange={(e) => setNewSiteAddress(e.target.value)}
                placeholder="123 Main St, Memphis TN"
              />
            </div>

            <button
              className="btn btn--accent btn--lg"
              onClick={createSite}
              disabled={!newSiteName.trim()}
              style={{ width: '100%' }}
            >
              Create site &amp; continue
            </button>

            <div className="center mt-16">
              <Link to="/admin" className="btn btn--ghost btn--sm">
                Or go to admin console (advanced)
              </Link>
            </div>
          </section>
        </>
      ) : (
        <>
          <div className="banner banner--info">
            <span className="banner__icon">i</span>
            <div className="banner__body">
              Pick the site this device will be assigned to. If you need a new site, you can add
              one inline below.
            </div>
          </div>

          <div className="field">
            <div className="field__label">Site assignment</div>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="">Select a site…</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <div className="field__hint">Inspectors and loads will be scoped to this site.</div>
          </div>

          <details style={{ margin: '12px 0 16px' }}>
            <summary
              style={{
                cursor: 'pointer',
                fontSize: 13,
                color: 'var(--ink-soft)',
                padding: '6px 0',
              }}
            >
              + Add a new site inline
            </summary>
            <div
              style={{
                background: 'var(--surface-tint)',
                padding: 14,
                border: '1px solid var(--rule-soft)',
                marginTop: 8,
              }}
            >
              <div className="field">
                <div className="field__label">New site name</div>
                <input
                  value={newSiteName}
                  onChange={(e) => setNewSiteName(e.target.value)}
                  placeholder="e.g. Memphis Distribution Center"
                  onKeyDown={(e) => e.key === 'Enter' && createSite()}
                />
              </div>
              <div className="field">
                <div className="field__label">Address (optional)</div>
                <input
                  value={newSiteAddress}
                  onChange={(e) => setNewSiteAddress(e.target.value)}
                  placeholder="123 Main St, Memphis TN"
                />
              </div>
              <button
                className="btn btn--primary"
                onClick={createSite}
                disabled={!newSiteName.trim()}
              >
                Create site
              </button>
            </div>
          </details>

          <div className="field">
            <div className="field__label">Configured by (optional)</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name or IT ticket #"
            />
          </div>

          <button
            className="btn btn--accent btn--lg"
            onClick={submit}
            disabled={!siteId}
            style={{ marginTop: 16, width: '100%' }}
          >
            Complete setup →
          </button>
        </>
      )}
    </main>
  );
}
