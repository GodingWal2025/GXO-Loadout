import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { getDeviceConfig } from './lib/deviceConfig';
import { dbGetPendingSyncCount, dbGetUnuploadedPhotoCount } from './shared';
import { isAdminAuthenticated } from './services/adminAuth';


import { HomeRoute } from './routes/HomeRoute';
import { NewInspectionRoute } from './routes/NewInspectionRoute';
import { CapturePicklistRoute } from './routes/CapturePicklistRoute';
import { CaptureBOLRoute } from './routes/CaptureBOLRoute';
import { VerifyRoute } from './routes/VerifyRoute';
import { InspectionWorkspaceRoute } from './routes/InspectionWorkspaceRoute';
import { ScanPalletRoute } from './routes/ScanPalletRoute';
import { ReviewAndCompleteRoute } from './routes/ReviewAndCompleteRoute';
import { CaptureReturnsBOLRoute } from './routes/CaptureReturnsBOLRoute';
import { VerifyReturnsRoute } from './routes/VerifyReturnsRoute';
import { DashboardRoute } from './routes/DashboardRoute';
import { AdminRoute } from './routes/AdminRoute';
import { AdminGateRoute } from './routes/AdminGateRoute';
import { SetupRoute } from './routes/SetupRoute';
import { InvestigationRoute } from './routes/InvestigationRoute';
import { CaptureReturnsStagingRoute } from './routes/CaptureReturnsStagingRoute';
import { InventoryRoute } from './routes/InventoryRoute';

import { startBackgroundSync } from './shared';
import { startSitesSync } from './services/sites';
import { startInspectorsSync } from './shared/services/inspectors';
import { startStagingLocationsSync } from './services/stagingLocations';
import { startInventorySync } from './shared/services/inventorySync';
import { LanguageProvider, useT } from './shared/i18n/LanguageContext';
import { LanguageToggle } from './shared/components/LanguageToggle';
import { SyncRefreshButton } from './components/SyncRefreshButton';

export default function App() {
  useEffect(() => {
    startBackgroundSync();
    startSitesSync();
    startInspectorsSync();
    startStagingLocationsSync();
    startInventorySync();
  }, []);

  return (
    <LanguageProvider>
      <BrowserRouter>
        <Shell>
          <Routes>
            <Route path="/" element={<HomeRoute />} />
            <Route path="/setup" element={<SetupRoute />} />
            <Route path="/inventory" element={<InventoryRoute />} />
  
            {/* New inspection by type - outbound/returns/retag */}
            <Route path="/inspection/new/:type" element={<NewInspectionRoute />} />
  
            {/* Step 1 of an existing inspection — same screen, edit mode */}
            <Route path="/inspection/:id/details" element={<NewInspectionRoute />} />

            {/* Outbound workflow */}
            <Route path="/inspection/:id/capture-picklist" element={<CapturePicklistRoute />} />
            <Route path="/inspection/:id/capture-bol" element={<CaptureBOLRoute />} />
            <Route path="/inspection/:id/verify" element={<VerifyRoute />} />
            
            {/* Returns workflow */}
            <Route path="/inspection/:id/capture-returns-bol" element={<CaptureReturnsBOLRoute />} />
            <Route path="/inspection/:id/capture-returns-staging" element={<CaptureReturnsStagingRoute />} />
            <Route path="/inspection/:id/verify-returns" element={<VerifyReturnsRoute />} />
  
            {/* Shared Pallet & Workspace */}
            <Route path="/inspection/:id" element={<InspectionWorkspaceRoute />} />
            <Route path="/inspection/:id/pallet/:palletIndex" element={<ScanPalletRoute />} />
            <Route path="/inspection/:id/review" element={<ReviewAndCompleteRoute />} />
            <Route path="/investigation" element={<InvestigationRoute />} />
  
            {/* Admin area - password gated, dashboard lives inside */}
            <Route path="/admin" element={<AdminGate><AdminRoute /></AdminGate>} />
            <Route path="/admin/dashboard" element={<AdminGate><DashboardRoute /></AdminGate>} />
          </Routes>
        </Shell>
      </BrowserRouter>
    </LanguageProvider>
  );
}

function AdminGate({ children }: { children: React.ReactNode }) {
  if (!isAdminAuthenticated()) {
    return <AdminGateRoute />;
  }
  return <>{children}</>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const config = getDeviceConfig();
  const location = useLocation();
  const t = useT();

  const [sync, setSync] = useState({ pending: 0, photos: 0 });
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const refresh = async () => {
      try {
        const [p, ph] = await Promise.all([
          dbGetPendingSyncCount(),
          dbGetUnuploadedPhotoCount(),
        ]);
        setSync({ pending: p, photos: ph });
      } catch {
        // ignore
      }
    };
    refresh();
    const interval = setInterval(refresh, 5000);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    // A manual refresh shouldn't leave a stale count sitting there for 5s.
    window.addEventListener('loadout-sync-updated', refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('loadout-sync-updated', refresh);
    };
  }, [location.pathname]);

  const isAdminArea = location.pathname.startsWith('/admin');

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="topbar__inner">
          <Link to="/" className="topbar__brand">
            <span className="topbar__brand-gxo-text">GXO</span>
            <span className="topbar__wordmark">
              LOADOUT<span className="topbar__wordmark-dot">.</span>
            </span>
          </Link>

          <nav className="topbar__nav">
            <Link to="/" className={location.pathname === '/' ? 'active' : ''}>
              {t('nav.inspections', 'Inspections')}
            </Link>
            <Link to="/inventory" className={location.pathname === '/inventory' ? 'active' : ''}>
              {t('nav.inventory', 'Inventory')}
            </Link>
            <Link to="/admin" className={isAdminArea ? 'active' : ''}>
              {t('nav.admin', 'Admin')}
            </Link>
          </nav>

          <div className="topbar__right">

            {config && (
              <div className="topbar__site">
                <span className="topbar__site-label">{t('shell.site', 'Site')}</span>
                <span className="topbar__site-name">{config.siteName}</span>
              </div>
            )}
            <div className="topbar__status">
              <span
                className={`topbar__status-dot ${
                  !online
                    ? 'topbar__status-dot--offline'
                    : sync.pending > 0 || sync.photos > 0
                    ? 'topbar__status-dot--syncing'
                    : ''
                }`}
              />
              {!online
                ? t('shell.offline', 'Offline')
                : sync.pending > 0 || sync.photos > 0
                ? t('shell.pending', '{count} pending', { count: sync.pending + sync.photos })
                : t('shell.synced', 'Synced')}
            </div>
            <SyncRefreshButton />
            <LanguageToggle />
          </div>
        </div>
      </div>

      {children}
    </div>
  );
}
