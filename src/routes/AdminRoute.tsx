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
  dbListAllInspections,
  dbHardDeleteInspection,
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
import { useT } from '../shared/i18n/LanguageContext';
import type { Inspector, Site } from '../shared';

type Tab = 'inspectors' | 'sites' | 'staging' | 'security' | 'reports';

export function AdminRoute() {
  const t = useT();
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
            {t('admin.title', 'Admin')} <em>{t('admin.titleEm', 'console')}</em>
          </h1>
          <div className="page-head__sub">
            {t('admin.managerOnly', 'Manager-only')}
            {config
              ? ` · ${config.siteName}`
              : ` · ${t('admin.noSiteAssigned', 'no site assigned yet')}`}
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
          <Link to="/" className="btn btn--ghost">{t('admin.backToApp', '← Back to app')}</Link>
          <button className="btn btn--danger" onClick={logout}>{t('admin.logOut', 'Log out')}</button>
        </div>
      </div>

      {!config && (
        <div className="banner banner--warn">
          <span className="banner__icon">⚠</span>
          <div className="banner__body">
            <strong>{t('admin.noSiteBannerTitle', "This device isn't assigned to a site yet.")}</strong>{' '}
            {t(
              'admin.noSiteBannerBody',
              'Create a site below, then go to Device setup (the home screen will redirect you) to assign this device to that site.'
            )}
          </div>
        </div>
      )}

      <div className="admin-tabs">
        <button
          className={`admin-tab ${tab === 'inspectors' ? 'active' : ''}`}
          onClick={() => setTab('inspectors')}
          disabled={!config}
          title={!config ? t('admin.assignSiteFirst', 'Assign this device to a site first') : undefined}
        >
          {t('admin.tabInspectors', 'Inspectors')}
        </button>
        <button
          className={`admin-tab ${tab === 'sites' ? 'active' : ''}`}
          onClick={() => setTab('sites')}
        >
          {t('admin.tabSites', 'Sites')}
        </button>
        <button
          className={`admin-tab ${tab === 'staging' ? 'active' : ''}`}
          onClick={() => setTab('staging')}
          disabled={!config}
          title={!config ? t('admin.assignSiteFirst', 'Assign this device to a site first') : undefined}
        >
          {t('admin.tabStaging', 'Staging locations')}
        </button>
        <button
          className={`admin-tab ${tab === 'reports' ? 'active' : ''}`}
          onClick={() => setTab('reports')}
        >
          {t('admin.tabReports', 'Reports & Dashboard')}
        </button>

        <button
          className={`admin-tab ${tab === 'security' ? 'active' : ''}`}
          onClick={() => setTab('security')}
        >
          {t('admin.tabSecurity', 'Security')}
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
  const t = useT();
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
          <h2 className="section__title">
            {t('admin.addInspector', 'Add')} <em>{t('admin.addInspectorEm', 'inspector')}</em>
          </h2>
        </div>
        <div className="field-row">
          <div className="field">
            <div className="field__label">{t('admin.nameLabel', 'Name')}</div>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('admin.inspectorNamePlaceholder', 'e.g. M. Jones')}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
          </div>
          <div className="field" style={{ alignSelf: 'flex-end' }}>
            <button
              className="btn btn--primary btn--lg"
              onClick={add}
              disabled={!newName.trim()}
            >
              {t('admin.addInspectorBtn', '+ Add inspector')}
            </button>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            {t('admin.currentInspectors', 'Current')} <em>{t('admin.currentInspectorsEm', 'inspectors')}</em>
          </h2>
          <span className="section__meta">
            {t('admin.activeCount', '{count} active', {
              count: inspectors.filter((i) => i.active).length,
            })}
          </span>
        </div>

        <div className="banner banner--info">
          <span className="banner__icon">i</span>
          <div className="banner__body">
            {t(
              'admin.inspectorsInfo',
              "Deactivated inspectors stay in past inspection records (so historical attribution is preserved) but don't appear in the dropdown when starting new loads."
            )}
          </div>
        </div>

        {inspectors.length === 0 ? (
          <div className="empty">
            <div className="empty__title">{t('admin.noInspectors', 'No inspectors yet')}</div>
            <div className="empty__sub">
              {t('admin.noInspectorsSub', 'Add at least one inspector before any load can be started.')}
            </div>
          </div>
        ) : (
          <div className="table-card">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('admin.colName', 'Name')}</th>
                  <th>{t('admin.colStatus', 'Status')}</th>
                  <th className="right">{t('admin.colAction', 'Action')}</th>
                </tr>
              </thead>
              <tbody>
                {inspectors.map((i) => (
                  <tr key={i.id}>
                    <td className="fw-500">{i.name}</td>
                    <td>
                      {i.active ? (
                        <span className="pill pill--success">{t('admin.statusActive', 'Active')}</span>
                      ) : (
                        <span className="pill pill--neutral">{t('admin.statusInactive', 'Inactive')}</span>
                      )}
                    </td>
                    <td className="right">
                      <button className="btn btn--sm" onClick={() => toggleActive(i)}>
                        {i.active
                          ? t('admin.deactivate', 'Deactivate')
                          : t('admin.reactivate', 'Reactivate')}
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
  const t = useT();
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
    if (
      !window.confirm(
        t('admin.confirmDeleteSite', 'Delete site "{name}"? This cannot be undone.', {
          name: s.name,
        })
      )
    )
      return;
    const result = deleteSite(s.id);
    if (!result.ok) {
      setDeleteError(result.reason || t('admin.deleteSiteFailed', 'Failed to delete'));
      return;
    }
    setDeleteError(null);
    refresh();
  };

  return (
    <>
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            {t('admin.addSite', 'Add')} <em>{t('admin.addSiteEm', 'site')}</em>
          </h2>
        </div>
        <div className="field-row">
          <div className="field">
            <div className="field__label">{t('admin.siteNameLabel', 'Site name')}</div>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('admin.siteNamePlaceholder', 'e.g. Memphis Distribution Center')}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
          </div>
          <div className="field">
            <div className="field__label">{t('admin.addressLabel', 'Address (optional)')}</div>
            <input
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder={t('admin.addressPlaceholder', '123 Main St, Memphis TN')}
            />
          </div>
          <div className="field" style={{ alignSelf: 'flex-end' }}>
            <button
              className="btn btn--primary btn--lg"
              onClick={add}
              disabled={!newName.trim()}
            >
              {t('admin.addSiteBtn', '+ Add site')}
            </button>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            {t('admin.allSites', 'All')} <em>{t('admin.allSitesEm', 'sites')}</em>
          </h2>
          <span className="section__meta">
            {t('admin.activeCount', '{count} active', {
              count: sites.filter((s) => s.active).length,
            })}
          </span>
        </div>

        {deleteError && (
          <div className="banner banner--danger">
            <span className="banner__icon">✕</span>
            <div className="banner__body">{deleteError}</div>
          </div>
        )}

        {sites.length === 0 ? (
          <div className="empty">
            <div className="empty__title">{t('admin.noSites', 'No sites yet')}</div>
            <div className="empty__sub">{t('admin.noSitesSub', 'Add the first site above.')}</div>
          </div>
        ) : (
          <div className="table-card">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('admin.colSite', 'Site')}</th>
                  <th>{t('admin.colAddress', 'Address')}</th>
                  <th>{t('admin.colStatus', 'Status')}</th>
                  <th className="right">{t('admin.colActions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id}>
                    <td className="fw-500">
                      {s.name}
                      {s.id === currentSiteId && (
                        <span className="pill pill--info" style={{ marginLeft: 8 }}>
                          {t('admin.selectedSite', 'Selected Site')}
                        </span>
                      )}
                    </td>
                    <td className="small soft">{s.address || '—'}</td>
                    <td>
                      {s.active ? (
                        <span className="pill pill--success">{t('admin.statusActive', 'Active')}</span>
                      ) : (
                        <span className="pill pill--neutral">{t('admin.statusInactive', 'Inactive')}</span>
                      )}
                    </td>
                    <td className="right">
                      <div className="flex gap-8" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn btn--sm" onClick={() => toggleActive(s)}>
                          {s.active
                            ? t('admin.deactivate', 'Deactivate')
                            : t('admin.reactivate', 'Reactivate')}
                        </button>
                        {s.id !== currentSiteId && (
                          <button
                            className="btn btn--sm btn--danger"
                            onClick={() => remove(s)}
                          >
                            {t('admin.delete', 'Delete')}
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
  const t = useT();
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
    if (
      !window.confirm(
        t('admin.confirmDeleteLocation', 'Delete location "{name}"?', { name: l.name })
      )
    )
      return;
    deleteStagingLocation(l.id);
    refresh();
  };

  return (
    <>
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            {t('admin.addStaging', 'Add')} <em>{t('admin.addStagingEm', 'staging location')}</em>
          </h2>
        </div>
        <div className="banner banner--info">
          <span className="banner__icon">i</span>
          <div className="banner__body">
            {t(
              'admin.stagingInfo',
              'Staging locations are picked by inspectors when they start a new load. Examples: "Door 12", "Bay 3-A", "South Yard". These are per-site.'
            )}
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <div className="field__label">{t('admin.locationNameLabel', 'Location name')}</div>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('admin.locationNamePlaceholder', 'e.g. Door 12')}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
          </div>
          <div className="field" style={{ alignSelf: 'flex-end' }}>
            <button
              className="btn btn--primary btn--lg"
              onClick={add}
              disabled={!newName.trim()}
            >
              {t('admin.addLocationBtn', '+ Add location')}
            </button>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            {t('admin.currentStaging', 'Current')}{' '}
            <em>{t('admin.currentStagingEm', 'staging locations')}</em>
          </h2>
          <span className="section__meta">
            {t('admin.activeCount', '{count} active', {
              count: locations.filter((l) => l.active).length,
            })}
          </span>
        </div>

        {locations.length === 0 ? (
          <div className="empty">
            <div className="empty__title">{t('admin.noStaging', 'No staging locations yet')}</div>
            <div className="empty__sub">
              {t('admin.noStagingSub', 'Add at least one before inspectors can start new loads here.')}
            </div>
          </div>
        ) : (
          <div className="table-card">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('admin.colLocation', 'Location')}</th>
                  <th>{t('admin.colStatus', 'Status')}</th>
                  <th className="right">{t('admin.colActions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((l) => (
                  <tr key={l.id}>
                    <td className="fw-500">{l.name}</td>
                    <td>
                      {l.active ? (
                        <span className="pill pill--success">{t('admin.statusActive', 'Active')}</span>
                      ) : (
                        <span className="pill pill--neutral">{t('admin.statusInactive', 'Inactive')}</span>
                      )}
                    </td>
                    <td className="right">
                      <div className="flex gap-8" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn btn--sm" onClick={() => toggleActive(l)}>
                          {l.active
                            ? t('admin.deactivate', 'Deactivate')
                            : t('admin.reactivate', 'Reactivate')}
                        </button>
                        <button className="btn btn--sm btn--danger" onClick={() => remove(l)}>
                          {t('admin.delete', 'Delete')}
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
  const t = useT();
  return (
    <section className="section">
      <div className="section__head">
        <h2 className="section__title">
          {t('admin.reportsTitle', 'Reports &')} <em>{t('admin.reportsTitleEm', 'dashboard')}</em>
        </h2>
        <span className="section__meta">{t('admin.reportsMeta', 'Cross-site operations data')}</span>
      </div>

      <div className="banner banner--info">
        <span className="banner__icon">i</span>
        <div className="banner__body">
          {t(
            'admin.reportsInfo',
            'The operations dashboard is restricted to managers. It shows cross-site KPIs, inspector workload, flag rates, and discrepancy trends.'
          )}
        </div>
      </div>

      <Link
        to="/admin/dashboard"
        className="btn btn--accent btn--lg"
        style={{ marginTop: 12 }}
      >
        {t('admin.openDashboard', 'Open dashboard →')}
      </Link>
    </section>
  );
}

// ----- Security tab -----

function SecurityPanel() {
  const t = useT();
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [resetting, setResetting] = useState(false);

  const submitPasswordChange = () => {
    if (currentPw !== getAdminPassword()) {
      setMessage({
        type: 'error',
        text: t('admin.pwCurrentWrong', 'Current password is incorrect.'),
      });
      return;
    }
    if (newPw.length < 6) {
      setMessage({
        type: 'error',
        text: t('admin.pwTooShort', 'New password must be at least 6 characters.'),
      });
      return;
    }
    if (newPw !== confirmPw) {
      setMessage({
        type: 'error',
        text: t('admin.pwMismatch', 'New password and confirmation do not match.'),
      });
      return;
    }
    setAdminPassword(newPw);
    setMessage({ type: 'success', text: t('admin.pwUpdated', 'Password updated.') });
    setCurrentPw('');
    setNewPw('');
    setConfirmPw('');
  };

  const resetAllData = async () => {
    const sure1 = window.confirm(
      t(
        'admin.confirmReset',
        'Reset ALL data? This deletes every inspection, photo, site, inspector, and staging location on this device. This cannot be undone.'
      )
    );
    if (!sure1) return;
    const pw = window.prompt(
      t('admin.resetPasswordPrompt', 'Please enter the admin password to confirm the reset:')
    );
    if (pw === null) return;
    if (pw !== getAdminPassword()) {
      alert(t('admin.resetWrongPassword', 'Incorrect admin password. Reset aborted.'));
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
          <h2 className="section__title">
            {t('admin.changePassword', 'Change')} <em>{t('admin.changePasswordEm', 'admin password')}</em>
          </h2>
        </div>

        {!isAdminPasswordCustomized() && (
          <div className="banner banner--warn">
            <span className="banner__icon">⚠</span>
            <div className="banner__body">
              <strong>{t('admin.defaultPwTitle', "You're still using the default password.")}</strong>{' '}
              {t(
                'admin.defaultPwBody',
                'Change it now to keep warehouse workers out of the admin area.'
              )}
            </div>
          </div>
        )}

        <div className="banner banner--info">
          <span className="banner__icon">i</span>
          <div className="banner__body">
            {t(
              'admin.passwordScopeInfo',
              "This password is stored on this device and shared across all managers using it. For real-world security you'd want individual Microsoft accounts."
            )}
          </div>
        </div>

        <div className="field">
          <div className="field__label">{t('admin.currentPasswordLabel', 'Current password')}</div>
          <input
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <div className="field">
          <div className="field__label">{t('admin.newPasswordLabel', 'New password')}</div>
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder={t('admin.newPasswordPlaceholder', 'At least 6 characters')}
          />
        </div>
        <div className="field">
          <div className="field__label">{t('admin.confirmPasswordLabel', 'Confirm new password')}</div>
          <input
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder={t('admin.confirmPasswordPlaceholder', 'Repeat new password')}
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
          {t('admin.updatePasswordBtn', 'Update password')}
        </button>
      </section>

      <InspectionManagementPanel />

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            {t('admin.resetTitle', 'Reset')} <em>{t('admin.resetTitleEm', 'all data')}</em>
          </h2>
          <span className="section__meta">{t('admin.dangerZone', 'Danger zone')}</span>
        </div>

        <div className="banner banner--danger">
          <span className="banner__icon">⚠</span>
          <div className="banner__body">
            <strong>{t('admin.resetWarnTitle', 'This deletes everything on this device:')}</strong>{' '}
            {t(
              'admin.resetWarnBody',
              'all inspections, all photos, all sites, all inspectors, all staging locations, all settings. The device will return to its first-launch state.'
            )}
          </div>
        </div>

        <button
          className="btn btn--danger btn--lg"
          onClick={resetAllData}
          disabled={resetting}
        >
          {resetting
            ? t('admin.resetting', 'Resetting…')
            : t('admin.resetAllDataBtn', 'Reset all data')}
        </button>
      </section>
    </>
  );
}

function InspectionManagementPanel() {
  const t = useT();
  const [inspections, setInspections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 25;

  useEffect(() => {
    loadInspections(page);
  }, [page]);

  const loadInspections = async (p: number) => {
    setLoading(true);
    const all = await dbListAllInspections();
    setInspections(all.slice((p - 1) * pageSize, p * pageSize));
    setTotal(all.length);
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (
      !window.confirm(
        t('admin.confirmDeleteInspection', 'Permanently delete this inspection? This cannot be undone.')
      )
    )
      return;

    await dbHardDeleteInspection(id);
    loadInspections(page);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="section">
      <div className="section__head">
        <h2 className="section__title">
          {t('admin.inspectionMgmt', 'Inspection')} <em>{t('admin.inspectionMgmtEm', 'management')}</em>
        </h2>
        <span className="section__meta">
          {t('admin.totalInspections', '{count} total inspections', { count: total })}
        </span>
      </div>

      {loading ? (
        <div className="soft">{t('admin.loadingInspections', 'Loading inspections...')}</div>
      ) : inspections.length === 0 ? (
        <div className="soft">{t('admin.noInspectionsFound', 'No inspections found.')}</div>
      ) : (
        <>
          <div className="table-card">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('admin.colId', 'ID')}</th>
                  <th>{t('admin.colType', 'Type')}</th>
                  <th>{t('admin.colStatus', 'Status')}</th>
                  <th>{t('admin.colState', 'State')}</th>
                  <th className="right">{t('admin.colActions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {inspections.map((i: any) => (
                  <tr key={i.id}>
                    <td className="mono">{i.id.slice(0, 8)}</td>
                    <td>{i.type}</td>
                    <td>{i.status}</td>
                    <td>{i.archived ? <span className="pill pill--warn">{t('admin.stateArchived', 'Archived')}</span> : <span className="pill pill--success">{t('admin.statusActive', 'Active')}</span>}</td>
                    <td className="right">
                      <button className="btn btn--sm btn--danger" onClick={() => handleDelete(i.id)}>{t('admin.delete', 'Delete')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, marginTop: 16 }}>
              <button className="btn btn--sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                {t('admin.previous', '← Previous')}
              </button>
              <span className="small soft">
                {t('admin.pageOf', 'Page {page} of {total}', { page, total: totalPages })}
              </span>
              <button className="btn btn--sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                {t('admin.next', 'Next →')}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
