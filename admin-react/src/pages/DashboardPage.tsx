import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  PageLoading,
  ErrorState,
  EmptyState,
  StatusBadge,
  formatDate,
  safeText,
} from '../components/ui';
import {
  fetchApplicationStats,
  fetchApplicationsJoined,
} from '../lib/adminQueries';
import type { ApplicationRow } from '../types';
import type { PostgrestError } from '@supabase/supabase-js';
import {
  APPLICATION_STATUS_UI_VALUES,
  STATUS_UI_META,
} from '../../config/dbSchemaConfig';
import type { ApplicationStatusUi } from '../../config/dbSchemaConfig';

type StatsCounts = Record<ApplicationStatusUi, number> & { total: number };

interface StatCard {
  key: 'total' | ApplicationStatusUi;
  label: string;
  count: number;
  accent: string;
  dot: string;
  badge?: ApplicationStatusUi;
  icon: React.ReactNode;
}

const statIconPaths: Record<StatCard['key'], React.ReactNode> = {
  total: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <path d="M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z" fill="currentColor" />
    </svg>
  ),
  submitted: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm4.24 7.66-5.66 5.66L7.76 12.5l-1.42 1.41 4.92 4.92L17.66 9.08Z" fill="currentColor" />
    </svg>
  ),
  under_review: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm1 15h-2v-6h2Zm0-8h-2V7h2Z" fill="currentColor" />
    </svg>
  ),
  approved: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <path d="M9 20l-5.4-5.4 1.4-1.4L9 17.2 19 7.2l1.4 1.4Z" fill="currentColor" />
    </svg>
  ),
  rejected: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm4.24 13.41L14.83 16.83 12 14l-2.83 2.83-1.41-1.42L10.59 12 7.76 9.17l1.41-1.41L12 10.59l2.83-2.83 1.41 1.41L13.41 12Z" fill="currentColor" />
    </svg>
  ),
  needs_revision: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75Zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75Z" fill="currentColor" />
    </svg>
  ),
};

export default function DashboardPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [statsError, setStatsError] = useState<PostgrestError | null>(null);
  const [counts, setCounts] = useState<StatsCounts>({
    total: 0, submitted: 0, under_review: 0, approved: 0, rejected: 0, needs_revision: 0,
  });
  const [recentRows, setRecentRows] = useState<ApplicationRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setStatsError(null);
    try {
      const [stats, apps] = await Promise.all([
        fetchApplicationStats(),
        fetchApplicationsJoined(),
      ]);
      if (stats.error) {
        setStatsError(stats.error);
        toast.error('Could not load dashboard', stats.error.message);
      } else {
        setCounts(stats.counts);
      }
      if (apps.error) {
        toast.error('Could not load recent applications', apps.error.message);
      } else {
        const sorted = [...apps.rows].sort((a, b) => {
          const ad = a.applicationDate ? new Date(a.applicationDate).getTime() : 0;
          const bd = b.applicationDate ? new Date(b.applicationDate).getTime() : 0;
          return bd - ad;
        });
        setRecentRows(sorted.slice(0, 6));
      }
    } catch {
      toast.error('Dashboard unavailable', 'Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const statCards = useMemo<StatCard[]>(() => [
    {
      key: 'total',
      label: 'Total applications',
      count: counts.total,
      accent: 'from-brand-500 to-brand-700',
      dot: 'bg-brand-600',
      icon: statIconPaths.total,
    },
    {
      key: 'submitted',
      label: 'Submitted',
      count: counts.submitted,
      accent: 'from-slate-500 to-slate-700',
      dot: 'bg-slate-500',
      badge: 'submitted',
      icon: statIconPaths.submitted,
    },
    {
      key: 'under_review',
      label: 'Under review',
      count: counts.under_review,
      accent: 'from-amber-500 to-amber-600',
      dot: 'bg-amber-500',
      badge: 'under_review',
      icon: statIconPaths.under_review,
    },
    {
      key: 'approved',
      label: 'Approved',
      count: counts.approved,
      accent: 'from-emerald-500 to-emerald-700',
      dot: 'bg-emerald-500',
      badge: 'approved',
      icon: statIconPaths.approved,
    },
    {
      key: 'rejected',
      label: 'Rejected',
      count: counts.rejected,
      accent: 'from-rose-500 to-rose-700',
      dot: 'bg-rose-500',
      badge: 'rejected',
      icon: statIconPaths.rejected,
    },
    {
      key: 'needs_revision',
      label: 'Needs revision',
      count: counts.needs_revision,
      accent: 'from-sky-500 to-sky-700',
      dot: 'bg-sky-500',
      badge: 'needs_revision',
      icon: statIconPaths.needs_revision,
    },
  ], [counts]);

  if (loading) {
    return (
      <div className="space-y-8">
        <header className="mb-2">
          <h1 className="h1">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Loading overview…</p>
        </header>
        <PageLoading label="Loading dashboard data…" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="kicker">Overview</div>
          <h1 className="h1 mt-1">
            Welcome back{user?.firstName ? `, ${user.firstName}` : ''}
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-2xl">
            Track application volumes and status counts at a glance. Click a card to filter the applications list, or scroll down to see the most recent submissions.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path d="M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z" fill="currentColor"/>
            </svg>
            Refresh
          </button>
          <Link to="/applications" className="btn-primary">
            View all applications
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path d="M10 17 15 12 10 7Z" fill="currentColor"/>
            </svg>
          </Link>
        </div>
      </header>

      {statsError && (
        <ErrorState
          title="Couldn't load counts"
          message={statsError.message}
          retry={() => void load()}
        />
      )}

      {/* Stat cards */}
      <section aria-label="Application counts" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {statCards.map((c) => {
          const isInteractive = c.key !== 'total';
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => isInteractive && navigate(`/applications?status=${c.key}`)}
              disabled={!isInteractive}
              className={[
                'card text-left p-5 transition-all',
                isInteractive ? 'hover:-translate-y-0.5 hover:shadow-lg hover:ring-slate-300 cursor-pointer' : 'cursor-default',
              ].join(' ')}
              aria-label={`${c.count} ${c.label}${isInteractive ? ' — click to filter' : ''}`}
            >
              <div className="flex items-start justify-between">
                <div className={`h-11 w-11 shrink-0 rounded-xl bg-gradient-to-br ${c.accent} text-white flex items-center justify-center shadow-sm`}>
                  {c.icon}
                </div>
                {c.badge && <StatusBadge status={c.badge} />}
              </div>
              <div className="mt-4">
                <div className="text-3xl font-extrabold tracking-tight text-slate-900 tabular-nums">
                  {c.count.toLocaleString()}
                </div>
                <div className="mt-1 text-sm font-medium text-slate-500">{c.label}</div>
              </div>
              {isInteractive && (
                <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-brand-600">
                  Filter list
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
                    <path d="M10 17 15 12 10 7Z" fill="currentColor"/>
                  </svg>
                </div>
              )}
            </button>
          );
        })}
      </section>

      {/* Status legend / breakdown bar */}
      <section className="card p-5 sm:p-6" aria-label="Status breakdown">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="h3">Status breakdown</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Distribution of {counts.total.toLocaleString()} total applications
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {APPLICATION_STATUS_UI_VALUES.map((s) => {
              const m = STATUS_UI_META[s];
              const pct = counts.total ? Math.round((counts[s] / counts.total) * 100) : 0;
              return (
                <div key={s} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 ring-1 ring-slate-200">
                  <span className={m.chip.split(' ')[0] + ' h-2.5 w-2.5 rounded-full ring-0 !bg-transparent'}>
                    <span className={m.chip.split(' ')[0] + ' block h-2.5 w-2.5 rounded-full'}
                      style={{
                        backgroundColor: s === 'approved' ? '#10b981' :
                          s === 'rejected' ? '#f43f5e' :
                          s === 'needs_revision' ? '#0ea5e9' :
                          s === 'under_review' ? '#f59e0b' : '#64748b',
                      }}
                    />
                  </span>
                  <span className="text-xs font-semibold text-slate-700">{m.label}</span>
                  <span className="text-xs font-bold tabular-nums text-slate-900">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {counts.total === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="No application data yet"
              description="Counts will populate as soon as applicants submit their PWD ID applications through the public form."
            />
          </div>
        ) : (
          <div className="mt-5 h-3 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
            <div className="h-full flex">
              {APPLICATION_STATUS_UI_VALUES.map((s) => {
                const pct = counts.total ? (counts[s] / counts.total) * 100 : 0;
                if (pct === 0) return null;
                const color =
                  s === 'approved' ? '#10b981' :
                  s === 'rejected' ? '#f43f5e' :
                  s === 'needs_revision' ? '#0ea5e9' :
                  s === 'under_review' ? '#f59e0b' : '#64748b';
                return (
                  <div
                    key={s}
                    role="presentation"
                    aria-label={`${STATUS_UI_META[s].label} ${pct.toFixed(1)}%`}
                    style={{ width: `${pct}%`, backgroundColor: color }}
                    className="h-full first:rounded-l-full last:rounded-r-full transition-all"
                  />
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Recent applications */}
      <section aria-label="Recent applications" className="card">
        <div className="flex items-center justify-between px-5 py-4 sm:px-6 border-b border-slate-200">
          <div>
            <h2 className="h3">Recent applications</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              The latest submissions — click any row to open details
            </p>
          </div>
          <Link to="/applications" className="btn-ghost text-sm !py-2">
            See all
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path d="M10 17 15 12 10 7Z" fill="currentColor"/>
            </svg>
          </Link>
        </div>

        {recentRows.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState
              title="No recent applications"
              description="Applications will appear here once submitted."
              action={
                <button type="button" className="btn-secondary" onClick={() => void load()}>Refresh</button>
              }
            />
          </div>
        ) : (
          <ul role="list" className="divide-y divide-slate-100">
            {recentRows.map((row) => (
              <li key={row.id}>
                <Link
                  to={`/applications/${row.id}`}
                  className="group flex items-center gap-4 px-5 py-4 sm:px-6 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 font-bold text-sm ring-1 ring-brand-100">
                    {row.applicantName.charAt(0).toUpperCase() || 'A'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-slate-900 truncate">{safeText(row.applicantName)}</span>
                      <StatusBadge status={row.status} />
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                      <span className="font-mono">#{row.applicationIdShort}</span>
                      <span>Disability: {safeText(row.disability_type)}</span>
                      <span>Submitted: {formatDate(row.applicationDate)}</span>
                    </div>
                  </div>
                  <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-slate-300 group-hover:text-brand-600 transition-colors" aria-hidden="true">
                    <path d="M10 17 15 12 10 7Z" fill="currentColor"/>
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
