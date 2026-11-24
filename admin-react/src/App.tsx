import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ApplicationsPage from './pages/ApplicationsPage';
import ApplicationDetailsPage from './pages/ApplicationDetailsPage';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './components/AppLayout';
import { assertEnv } from './supabaseClient';

function EnvGate({ children }: { children: React.ReactNode }) {
  if (!assertEnv()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="card max-w-lg w-full p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-amber-200">
            <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm1 15h-2v-2h2Zm0-4h-2V7h2Z" fill="currentColor"/>
            </svg>
          </div>
          <h1 className="h1 mb-2">Missing configuration</h1>
          <p className="text-slate-600 text-sm mb-4">
            The admin console requires a valid <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">.env</code> file
            with <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">VITE_SUPABASE_URL</code> and{' '}
            <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">VITE_SUPABASE_PUBLISHABLE_KEY</code>.
          </p>
          <p className="text-xs text-slate-500">
            Copy <code className="bg-slate-100 px-1.5 py-0.5 rounded">.env.example</code> to{' '}
            <code className="bg-slate-100 px-1.5 py-0.5 rounded">.env</code> and fill in the values from your Supabase dashboard.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <EnvGate>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="applications" element={<ApplicationsPage />} />
          <Route path="applications/:id" element={<ApplicationDetailsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </EnvGate>
  );
}
