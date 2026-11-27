import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import './index.css';

// HashRouter, not BrowserRouter: GitHub Pages is a plain static host with no
// server-side rewrite, so a path-based route 404s the moment the visitor
// refreshes or bookmarks /applications/123. With hash routes the whole
// SPA lives behind /#/... and every deep link survives a reload.
async function bootstrap() {
  if (import.meta.env.PROD) {
    // A production build is served without server/server.js, so /api/* would
    // 404. This shim answers those same endpoints in the browser using the
    // publishable key, exactly as the main portal does. It is skipped in dev,
    // where the Vite proxy forwards /api/* to server.js on port 4000.
    await import('./lib/api-client.js');
  }

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <HashRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </HashRouter>
    </React.StrictMode>
  );
}

void bootstrap();
