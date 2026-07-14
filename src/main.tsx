import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { runResetIfNeeded } from './services/appReset';
import { setApiUrl } from './shared';

// Set API URL for the shared library
setApiUrl(import.meta.env.VITE_API_URL || '');


// Wipe stale data from prior versions before app loads. Once this resolves,
// IndexedDB and localStorage are guaranteed to be at the current schema.
runResetIfNeeded().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

});
