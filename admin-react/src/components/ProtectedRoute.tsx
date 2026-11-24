import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageLoading } from './ui';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { state, user } = useAuth();
  const location = useLocation();

  if (state === 'loading') {
    return (
      <div className="min-h-screen">
        <PageLoading label="Verifying your session…" />
      </div>
    );
  }

  if (state !== 'authenticated' || !user?.isAdmin) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <>{children}</>;
}
