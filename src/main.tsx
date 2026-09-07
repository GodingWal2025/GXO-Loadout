import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/400-italic.css';
import '@fontsource/playfair-display/600.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/playfair-display/900.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import App from './App';
import './styles.css';
import { runResetIfNeeded } from './services/appReset';
import { startSharedStorageSync } from './shared/services/sync';
import { requestPersistentAppStorage } from './shared/services/storagePersistence';

// Record the data version before rendering. Existing inspections are preserved;
// IndexedDB handles its own schema migrations when the database opens.
runResetIfNeeded().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  startSharedStorageSync();
  void requestPersistentAppStorage();
});
