import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getDeviceConfig } from './lib/deviceConfig';
import { isAdminAuthenticated } from './services/adminAuth';


const HomeRoute = lazy(() => import('./routes/HomeRoute').then((m) => ({ default: m.HomeRoute })));
const NewInspectionRoute = lazy(() => import('./routes/NewInspectionRoute').then((m) => ({ default: m.NewInspectionRoute })));
const CapturePicklistRoute = lazy(() => import('./routes/CapturePicklistRoute').then((m) => ({ default: m.CapturePicklistRoute })));
const CaptureBOLRoute = lazy(() => import('./routes/CaptureBOLRoute').then((m) => ({ default: m.CaptureBOLRoute })));
const VerifyRoute = lazy(() => import('./routes/VerifyRoute').then((m) => ({ default: m.VerifyRoute })));
const InspectionWorkspaceRoute = lazy(() => import('./routes/InspectionWorkspaceRoute').then((m) => ({ default: m.InspectionWorkspaceRoute })));
const ScanPalletRoute = lazy(() => import('./routes/ScanPalletRoute').then((m) => ({ default: m.ScanPalletRoute })));
const ReviewAndCompleteRoute = lazy(() => import('./routes/ReviewAndCompleteRoute').then((m) => ({ default: m.ReviewAndCompleteRoute })));
const CaptureReturnsBOLRoute = lazy(() => import('./routes/CaptureReturnsBOLRoute').then((m) => ({ default: m.CaptureReturnsBOLRoute })));
const VerifyReturnsRoute = lazy(() => import('./routes/VerifyReturnsRoute').then((m) => ({ default: m.VerifyReturnsRoute })));
const CaptureInboundBOLRoute = lazy(() => import('./routes/CaptureInboundBOLRoute').then((m) => ({ default: m.CaptureInboundBOLRoute })));
const VerifyInboundRoute = lazy(() => import('./routes/VerifyInboundRoute').then((m) => ({ default: m.VerifyInboundRoute })));
const DashboardRoute = lazy(() => import('./routes/DashboardRoute').then((m) => ({ default: m.DashboardRoute })));
const AdminRoute = lazy(() => import('./routes/AdminRoute').then((m) => ({ default: m.AdminRoute })));
const AdminGateRoute = lazy(() => import('./routes/AdminGateRoute').then((m) => ({ default: m.AdminGateRoute })));
const SetupRoute = lazy(() => import('./routes/SetupRoute').then((m) => ({ default: m.SetupRoute })));
const CaptureReturnsStagingRoute = lazy(() => import('./routes/CaptureReturnsStagingRoute').then((m) => ({ default: m.CaptureReturnsStagingRoute })));
const InventoryRoute = lazy(() => import('./routes/InventoryRoute').then((m) => ({ default: m.InventoryRoute })));
const InvestigationRoute = lazy(() => import('./routes/InvestigationRoute').then((m) => ({ default: m.InvestigationRoute })));
const BagCountConsoleRoute = lazy(() => import('./routes/BagCountConsoleRoute').then((m) => ({ default: m.BagCountConsoleRoute })));

import { LanguageProvider, useT } from './shared/i18n/LanguageContext';
import { LanguageToggle } from './shared/components/LanguageToggle';
import { SyncRefreshButton } from './components/SyncRefreshButton';
import { SyncDetailsModal } from './components/SyncDetailsModal';
import { getSyncState, type SyncState } from './shared/services/sync';

export default function App() {
  return (
    <LanguageProvider>
      <BrowserRouter>
        <Shell>
          <Suspense fallback={<main className="page"><div className="soft">Loading…</div></main>}>
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

            {/* Inbound workflow */}
            <Route path="/inspection/:id/capture-inbound-bol" element={<CaptureInboundBOLRoute />} />
            <Route path="/inspection/:id/verify-inbound" element={<VerifyInboundRoute />} />
  
            {/* Shared Pallet & Workspace */}
            <Route path="/inspection/:id" element={<InspectionWorkspaceRoute />} />
            <Route path="/inspection/:id/pallet/:palletIndex" element={<ScanPalletRoute />} />
            <Route path="/inspection/:id/review" element={<ReviewAndCompleteRoute />} />
            <Route path="/inspection/:id/complete" element={<ReviewAndCompleteRoute />} />
            <Route path="/investigation" element={<InvestigationRoute />} />
  
            {/* Admin area - password gated, dashboard lives inside */}
            <Route path="/admin" element={<AdminGate><AdminRoute /></AdminGate>} />
            <Route path="/admin/dashboard" element={<AdminGate><DashboardRoute /></AdminGate>} />
            <Route path="/admin/bag-count-console" element={<AdminGate><BagCountConsoleRoute /></AdminGate>} />
          </Routes>
          </Suspense>
        </Shell>
      </BrowserRouter>
    </LanguageProvider>
  );
}

function AdminGate({ children }: { children: ReactNode }) {
  if (!isAdminAuthenticated()) {
    return <AdminGateRoute />;
  }
  return <>{children}</>;
}

function Shell({ children }: { children: ReactNode }) {
  const config = getDeviceConfig();
  const location = useLocation();
  const t = useT();
  const [syncState, setSyncState] = useState<SyncState>(() => getSyncState());
  const [showSyncModal, setShowSyncModal] = useState(false);

  useEffect(() => {
    const update = (event: Event) => setSyncState((event as CustomEvent<SyncState>).detail);
    window.addEventListener('loadout-sync-status', update);
    return () => window.removeEventListener('loadout-sync-status', update);
  }, []);

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
            <button
              type="button"
              className="topbar__status"
              onClick={() => setShowSyncModal(true)}
              title={syncState.error || t('sync.clickForDetails', 'Click for sync & device safety details')}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                font: 'inherit',
                color: 'inherit',
                display: 'inline-flex',
                alignItems: 'center',
                padding: '4px 8px',
                borderRadius: '6px',
              }}
            >
              <span className={`topbar__status-dot ${syncState.syncing ? 'topbar__status-dot--syncing' : syncState.error ? 'topbar__status-dot--offline' : ''}`} />
              {syncState.syncing
                ? t('shell.syncing', 'Syncing…')
                : syncState.pending
                  ? t('shell.pendingSync', '{count} pending', { count: syncState.pending })
                  : syncState.error
                    ? t('shell.offline', 'Offline')
                    : t('shell.savedToServer', 'Saved to server')}
            </button>
            <SyncRefreshButton />
            <LanguageToggle />
          </div>
        </div>
      </div>

      {showSyncModal && <SyncDetailsModal onClose={() => setShowSyncModal(false)} />}

      {children}
    </div>
  );
}
