import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getDeviceConfig, setDeviceConfig, clearDeviceConfig } from '../lib/deviceConfig';
import {
  listAllSites,
  listActiveSites,
  addSite,
  updateSite,
  deleteSite,
} from '../services/sites';
import {
  addInspector,
  listAllInspectorsForSite,
  updateInspector,
} from '../shared';
import {
  listAllStagingLocations,
  addStagingLocation,
  updateStagingLocation,
  deleteStagingLocation,
  type StagingLocation,
} from '../services/stagingLocations';
import {
  adminLogout,
  getAdminPassword,
  setAdminPassword,
  isAdminPasswordCustomized,
} from '../services/adminAuth';
import { wipeAllData } from '../services/appReset';
import type { Inspector, Site } from '../shared';

type Tab = 'inspectors' | 'sites' | 'staging' | 'security' | 'reports';

export function AdminRoute() {
  const navigate = useNavigate();
  const config = getDeviceConfig();
  // When there's no site configured yet, default to the Sites tab so the
  // manager can create one. Otherwise default to Inspectors.
  const [tab, setTab] = useState<Tab>(config ? 'inspectors' : 'sites');

  // Site selector for admins to switch active site
  const [activeSites] = useState<Site[]>(() => listActiveSites());
  const [selectedSiteId, setSelectedSiteId] = useState<string>(config?.siteId || '');

  const handleSiteChange = (newSiteId: string) => {
    const site = activeSites.find((s) => s.id === newSiteId);
    if (site && config) {
      setSelectedSiteId(newSiteId);
      setDeviceConfig({
        ...config,
        siteId: site.id,
        siteName: site.name,
      });
    }
  };

  const logout = () => {
    adminLogout();
    navigate('/');
  };

  return (
    <main>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            Admin <em>console</em>
          </h1>
          <div className="page-head__sub">
            Manager-only{config ? ` · ${config.siteName}` : ' · no site assigned yet'}
          </div>
        </div>
        <div className="page-head__actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {config && activeSites.length > 1 && (
            <select
              value={selectedSiteId}
              onChange={(e) => handleSiteChange(e.target.value)}
              style={{ minHeight: 36, padding: '6px 12px' }}
            >
              {activeSites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          <Link to="/" className="btn btn--ghost">← Back to app</Link>
          <button className="btn btn--danger" onClick={logout}>Log out</button>
        </div>
      </div>

      {!config && (
        <div className="banner banner--warn">
          <span className="banner__icon">⚠</span>
          <div className="banner__body">
            <strong>This device isn't assigned to a site yet.</strong> Create a site below, then
            go to Device setup (the home screen will redirect you) to assign this device to that
            site.
          </div>
        </div>
      )}

      <div className="admin-tabs">
        <button
          className={`admin-tab ${tab === 'inspectors' ? 'active' : ''}`}
          onClick={() => setTab('inspectors')}
          disabled={!config}
          title={!config ? 'Assign this device to a site first' : undefined}
        >
          Inspectors
        </button>
        <button
          className={`admin-tab ${tab === 'sites' ? 'active' : ''}`}
          onClick={() => setTab('sites')}
        >
          Sites
        </button>
        <button
          className={`admin-tab ${tab === 'staging' ? 'active' : ''}`}
          onClick={() => setTab('staging')}
          disabled={!config}
          title={!config ? 'Assign this device to a site first' : undefined}
        >
          Staging locations
        </button>
        <button
          className={`admin-tab ${tab === 'reports' ? 'active' : ''}`}
          onClick={() => setTab('reports')}
        >
          Reports &amp; Dashboard
        </button>

        <button
          className={`admin-tab ${tab === 'security' ? 'active' : ''}`}
          onClick={() => setTab('security')}
        >
          Security
        </button>
      </div>

      {tab === 'inspectors' && config && <InspectorsPanel siteId={config.siteId} />}
      {tab === 'sites' && <SitesPanel currentSiteId={config?.siteId || ''} />}
      {tab === 'staging' && config && <StagingPanel siteId={config.siteId} />}
      {tab === 'reports' && <ReportsPanel />}

      {tab === 'security' && <SecurityPanel />}
    </main>
  );
}

// ----- Inspectors tab -----

function InspectorsPanel({ siteId }: { siteId: string }) {
  const [inspectors, setInspectors] = useState<Inspector[]>([]);
  const [newName, setNewName] = useState('');

  const refresh = () => setInspectors(listAllInspectorsForSite(siteId));

  useEffect(() => {
    refresh();
    // Refresh live when the background sync pulls inspectors from other devices
    window.addEventListener('loadout-inspectors-updated', refresh);
    return () => window.removeEventListener('loadout-inspectors-updated', refresh);
  }, [siteId]);

  const add = () => {
    if (!newName.trim()) return;
    addInspector(newName.trim(), siteId);
    setNewName('');
    refresh();
  };

  const toggleActive = (i: Inspector) => {
    updateInspector(i.id, { active: !i.active });
    refresh();
  };

  return (
    <>
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Add <em>inspector</em></h2>
        </div>
        <div className="field-row">
          <div className="field">
            <div className="field__label">Name</div>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. M. Jones"
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
          </div>
          <div className="field" style={{ alignSelf: 'flex-end' }}>
            <button
              className="btn btn--primary btn--lg"
              onClick={add}
              disabled={!newName.trim()}
            >
              + Add inspector
            </button>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Current <em>inspectors</em></h2>
          <span className="section__meta">
            {inspectors.filter((i) => i.active).length} active
          </span>
        </div>

        <div className="banner banner--info">
          <span className="banner__icon">i</span>
          <div className="banner__body">
            Deactivated inspectors stay in past inspection records (so historical attribution is
            preserved) but don't appear in the dropdown when starting new loads.
          </div>
        </div>

        {inspectors.length === 0 ? (
          <div className="empty">
            <div className="empty__title">No inspectors yet</div>
            <div className="empty__sub">
              Add at least one inspector before any load can be started.
            </div>
          </div>
        ) : (
          <div className="table-card">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th className="right">Action</th>
                </tr>
              </thead>
              <tbody>
                {inspectors.map((i) => (
                  <tr key={i.id}>
                    <td className="fw-500">{i.name}</td>
                    <td>
                      {i.active ? (
                        <span className="pill pill--success">Active</span>
                      ) : (
                        <span className="pill pill--neutral">Inactive</span>
                      )}
                    </td>
                    <td className="right">
                      <button className="btn btn--sm" onClick={() => toggleActive(i)}>
                        {i.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ----- Sites tab -----

function SitesPanel({ currentSiteId }: { currentSiteId: string }) {
  const [sites, setSites] = useState<Site[]>([]);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refresh = () => setSites(listAllSites());

  useEffect(() => { refresh(); }, []);

  const add = () => {
    if (!newName.trim()) return;
    addSite(newName.trim(), newAddress.trim() || undefined);
    setNewName('');
    setNewAddress('');
    refresh();
  };

  const toggleActive = (s: Site) => {
    updateSite(s.id, { active: !s.active });
    refresh();
  };

  const remove = (s: Site) => {
    if (!window.confirm(`Delete site "${s.name}"? This cannot be undone.`)) return;
    const result = deleteSite(s.id);
    if (!result.ok) {
      setDeleteError(result.reason || 'Failed to delete');
      return;
    }
    setDeleteError(null);
    refresh();
  };

  return (
    <>
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Add <em>site</em></h2>
        </div>
        <div className="field-row">
          <div className="field">
            <div className="field__label">Site name</div>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Memphis Distribution Center"
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
          </div>
          <div className="field">
            <div className="field__label">Address (optional)</div>
            <input
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder="123 Main St, Memphis TN"
            />
          </div>
          <div className="field" style={{ alignSelf: 'flex-end' }}>
            <button
              className="btn btn--primary btn--lg"
              onClick={add}
              disabled={!newName.trim()}
            >
              + Add site
            </button>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">All <em>sites</em></h2>
          <span className="section__meta">{sites.filter((s) => s.active).length} active</span>
        </div>

        {deleteError && (
          <div className="banner banner--danger">
            <span className="banner__icon">✕</span>
            <div className="banner__body">{deleteError}</div>
          </div>
        )}

        {sites.length === 0 ? (
          <div className="empty">
            <div className="empty__title">No sites yet</div>
            <div className="empty__sub">Add the first site above.</div>
          </div>
        ) : (
          <div className="table-card">
            <table className="data">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Address</th>
                  <th>Status</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id}>
                    <td className="fw-500">
                      {s.name}
                      {s.id === currentSiteId && (
                        <span className="pill pill--info" style={{ marginLeft: 8 }}>
                          Selected Site
                        </span>
                      )}
                    </td>
                    <td className="small soft">{s.address || '—'}</td>
                    <td>
                      {s.active ? (
                        <span className="pill pill--success">Active</span>
                      ) : (
                        <span className="pill pill--neutral">Inactive</span>
                      )}
                    </td>
                    <td className="right">
                      <div className="flex gap-8" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn btn--sm" onClick={() => toggleActive(s)}>
                          {s.active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        {s.id !== currentSiteId && (
                          <button
                            className="btn btn--sm btn--danger"
                            onClick={() => remove(s)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ----- Staging Locations tab -----

function StagingPanel({ siteId }: { siteId: string }) {
  const [locations, setLocations] = useState<StagingLocation[]>([]);
  const [newName, setNewName] = useState('');

  const refresh = () => setLocations(listAllStagingLocations(siteId));

  useEffect(() => {
    refresh();
    // Refresh live when the background sync pulls locations from other devices
    window.addEventListener('loadout-staging-locations-updated', refresh);
    return () => window.removeEventListener('loadout-staging-locations-updated', refresh);
  }, [siteId]);

  const add = () => {
    if (!newName.trim()) return;
    addStagingLocation(newName.trim(), siteId);
    setNewName('');
    refresh();
  };

  const toggleActive = (l: StagingLocation) => {
    updateStagingLocation(l.id, { active: !l.active });
    refresh();
  };

  const remove = (l: StagingLocation) => {
    if (!window.confirm(`Delete location "${l.name}"?`)) return;
    deleteStagingLocation(l.id);
    refresh();
  };

  return (
    <>
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Add <em>staging location</em></h2>
        </div>
        <div className="banner banner--info">
          <span className="banner__icon">i</span>
          <div className="banner__body">
            Staging locations are picked by inspectors when they start a new load. Examples:
            "Door 12", "Bay 3-A", "South Yard". These are per-site.
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <div className="field__label">Location name</div>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Door 12"
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
          </div>
          <div className="field" style={{ alignSelf: 'flex-end' }}>
            <button
              className="btn btn--primary btn--lg"
              onClick={add}
              disabled={!newName.trim()}
            >
              + Add location
            </button>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Current <em>staging locations</em></h2>
          <span className="section__meta">
            {locations.filter((l) => l.active).length} active
          </span>
        </div>

        {locations.length === 0 ? (
          <div className="empty">
            <div className="empty__title">No staging locations yet</div>
            <div className="empty__sub">
              Add at least one before inspectors can start new loads here.
            </div>
          </div>
        ) : (
          <div className="table-card">
            <table className="data">
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Status</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((l) => (
                  <tr key={l.id}>
                    <td className="fw-500">{l.name}</td>
                    <td>
                      {l.active ? (
                        <span className="pill pill--success">Active</span>
                      ) : (
                        <span className="pill pill--neutral">Inactive</span>
                      )}
                    </td>
                    <td className="right">
                      <div className="flex gap-8" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn btn--sm" onClick={() => toggleActive(l)}>
                          {l.active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button className="btn btn--sm btn--danger" onClick={() => remove(l)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ----- Reports tab -----

function ReportsPanel() {
  return (
    <section className="section">
      <div className="section__head">
        <h2 className="section__title">Reports &amp; <em>dashboard</em></h2>
        <span className="section__meta">Cross-site operations data</span>
      </div>

      <div className="banner banner--info">
        <span className="banner__icon">i</span>
        <div className="banner__body">
          The operations dashboard is restricted to managers. It shows cross-site KPIs, inspector
          workload, flag rates, and discrepancy trends.
        </div>
      </div>

      <Link
        to="/admin/dashboard"
        className="btn btn--accent btn--lg"
        style={{ marginTop: 12 }}
      >
        Open dashboard →
      </Link>
    </section>
  );
}

// ----- Security tab -----

function SecurityPanel() {
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [resetting, setResetting] = useState(false);

  const submitPasswordChange = () => {
    if (currentPw !== getAdminPassword()) {
      setMessage({ type: 'error', text: 'Current password is incorrect.' });
      return;
    }
    if (newPw.length < 6) {
      setMessage({ type: 'error', text: 'New password must be at least 6 characters.' });
      return;
    }
    if (newPw !== confirmPw) {
      setMessage({ type: 'error', text: 'New password and confirmation do not match.' });
      return;
    }
    setAdminPassword(newPw);
    setMessage({ type: 'success', text: 'Password updated.' });
    setCurrentPw('');
    setNewPw('');
    setConfirmPw('');
  };

  const resetAllData = async () => {
    const sure1 = window.confirm(
      'Reset ALL data? This deletes every inspection, photo, site, inspector, and staging location on this device. This cannot be undone.'
    );
    if (!sure1) return;
    const pw = window.prompt('Please enter the admin password to confirm the reset:');
    if (pw === null) return;
    if (pw !== getAdminPassword()) {
      alert('Incorrect admin password. Reset aborted.');
      return;
    }

    setResetting(true);
    await wipeAllData();
    clearDeviceConfig();
    // Reload to take us back to setup screen
    window.location.href = '/';
  };

  return (
    <>
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Change <em>admin password</em></h2>
        </div>

        {!isAdminPasswordCustomized() && (
          <div className="banner banner--warn">
            <span className="banner__icon">⚠</span>
            <div className="banner__body">
              <strong>You're still using the default password.</strong> Change it now to keep
              warehouse workers out of the admin area.
            </div>
          </div>
        )}

        <div className="banner banner--info">
          <span className="banner__icon">i</span>
          <div className="banner__body">
            This password is stored on this device and shared across all managers using it.
            For real-world security you'd want individual Microsoft accounts.
          </div>
        </div>

        <div className="field">
          <div className="field__label">Current password</div>
          <input
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <div className="field">
          <div className="field__label">New password</div>
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="At least 6 characters"
          />
        </div>
        <div className="field">
          <div className="field__label">Confirm new password</div>
          <input
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="Repeat new password"
          />
        </div>

        {message && (
          <div className={`banner banner--${message.type === 'success' ? 'success' : 'danger'}`}>
            <span className="banner__icon">{message.type === 'success' ? '✓' : '⚠'}</span>
            <div className="banner__body">{message.text}</div>
          </div>
        )}

        <button
          className="btn btn--accent btn--lg"
          onClick={submitPasswordChange}
          disabled={!currentPw || !newPw || !confirmPw}
        >
          Update password
        </button>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Reset <em>all data</em></h2>
          <span className="section__meta">Danger zone</span>
        </div>

        <div className="banner banner--danger">
          <span className="banner__icon">⚠</span>
          <div className="banner__body">
            <strong>This deletes everything on this device:</strong> all inspections, all photos,
            all sites, all inspectors, all staging locations, all settings. The device will return
            to its first-launch state.
          </div>
        </div>

        <button
          className="btn btn--danger btn--lg"
          onClick={resetAllData}
          disabled={resetting}
        >
          {resetting ? 'Resetting…' : 'Reset all data'}
        </button>
      </section>
    </>
  );
}
