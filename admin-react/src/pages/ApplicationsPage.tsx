import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import {
  PageLoading,
  ErrorState,
  EmptyState,
  StatusBadge,
  formatDate,
  safeText,
  Spinner,
} from '../components/ui';
import { fetchApplicationsJoined } from '../lib/adminQueries';
import type { ApplicationRow } from '../types';
import type { PostgrestError } from '@supabase/supabase-js';
import {
  APPLICATION_STATUS_UI_VALUES,
  STATUS_UI_META,
} from '../../config/dbSchemaConfig';
import type { ApplicationStatusUi } from '../../config/dbSchemaConfig';

type SortKey = 'date_desc' | 'date_asc' | 'name_asc' | 'name_desc';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'date_desc', label: 'Newest first' },
  { value: 'date_asc', label: 'Oldest first' },
  { value: 'name_asc', label: 'Name (A → Z)' },
  { value: 'name_desc', label: 'Name (Z → A)' },
];

export default function ApplicationsPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const initialStatus = (() => {
    const v = params.get('status');
    return APPLICATION_STATUS_UI_VALUES.includes(v as ApplicationStatusUi)
      ? (v as ApplicationStatusUi)
      : null;
  })();
  const initialSearch = params.get('q') ?? '';

  const [status, setStatus] = useState<ApplicationStatusUi | null>(initialStatus);
  const [search, setSearch] = useState<string>(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState<string>(initialSearch);
  const [sort, setSort] = useState<SortKey>('date_desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PostgrestError | null>(null);
  const [rows, setRows] = useState<ApplicationRow[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 280);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const next: Record<string, string> = {};
    if (status) next.status = status;
    if (debouncedSearch.trim()) next.q = debouncedSearch.trim();
    setParams(next, { replace: true });
  }, [status, debouncedSearch, setParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { rows: data, error: e } = await fetchApplicationsJoined({
        status: status ?? undefined,
        search: debouncedSearch.trim().length ? debouncedSearch : undefined,
      });
      if (e) {
        setError(e);
        toast.error('Could not load applications', e.message);
      } else {
        setRows(data);
      }
    } catch {
      toast.error('Applications unavailable', 'Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [status, debouncedSearch, toast]);

  useEffect(() => { void load(); }, [load]);

  const sortedRows = useMemo(() => {
    const arr = [...rows];
    switch (sort) {
      case 'date_asc':
        arr.sort((a, b) => {
          const ad = a.applicationDate ? new Date(a.applicationDate).getTime() : 0;
          const bd = b.applicationDate ? new Date(b.applicationDate).getTime() : 0;
          return ad - bd;
        });
        break;
      case 'name_asc':
        arr.sort((a, b) => a.applicantName.localeCompare(b.applicantName));
        break;
      case 'name_desc':
        arr.sort((a, b) => b.applicantName.localeCompare(a.applicantName));
        break;
      case 'date_desc':
      default:
        arr.sort((a, b) => {
          const ad = a.applicationDate ? new Date(a.applicationDate).getTime() : 0;
          const bd = b.applicationDate ? new Date(b.applicationDate).getTime() : 0;
          return bd - ad;
        });
    }
    return arr;
  }, [rows, sort]);

  const resultCount = sortedRows.length;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="kicker">Applications</div>
          <h1 className="h1 mt-1">All PWD ID applications</h1>
          <p className="mt-1 text-sm text-slate-600 max-w-2xl">
            Search by name, email, phone, disability details, or application ID. Filter by status
            and click any row to open the full review.
          </p>
        </div>
        <button type="button" className="btn-secondary sm:shrink-0" onClick={() => void load()}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
            <path d="M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z" fill="currentColor"/>
          </svg>
          Refresh
        </button>
      </header>

      {/* Filter bar */}
      <section className="card p-4 sm:p-5 space-y-4" aria-label="Search and filters">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-6 relative">
            <label htmlFor="q" className="sr-only">Search applications</label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                  <path d="M10 2a8 8 0 1 0 5.3 14l5.4 5.35 1.4-1.42-5.35-5.3A8 8 0 0 0 10 2Zm0 2a6 6 0 1 1-6 6 6 6 0 0 1 6-6Z" fill="currentColor"/>
                </svg>
              </span>
              <input
                id="q"
                type="search"
                className="input pl-10"
                placeholder="Search name, email, phone, ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {(loading || debouncedSearch !== search) && search.length > 0 && (
                <span className="absolute inset-y-0 right-0 flex items-center pr-3">
                  <Spinner size="sm" />
                </span>
              )}
            </div>
          </div>

          <div className="md:col-span-4">
            <label htmlFor="status" className="sr-only">Filter by status</label>
            <div className="relative">
              <select
                id="status"
                value={status ?? ''}
                onChange={(e) => setStatus(e.target.value ? (e.target.value as ApplicationStatusUi) : null)}
                className="input appearance-none pr-10"
              >
                <option value="">All statuses</option>
                {APPLICATION_STATUS_UI_VALUES.map((s) => (
                  <option key={s} value={s}>{STATUS_UI_META[s].label}</option>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <path d="M7 10l5 5 5-5Z" fill="currentColor"/>
                </svg>
              </span>
            </div>
          </div>

          <div className="md:col-span-2">
            <label htmlFor="sort" className="sr-only">Sort</label>
            <div className="relative">
              <select
                id="sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="input appearance-none pr-10"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <path d="M7 10l5 5 5-5Z" fill="currentColor"/>
                </svg>
              </span>
            </div>
          </div>
        </div>

        {/* Status chip filter (quick) */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setStatus(null)}
            className={[
              'rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition-colors',
              status === null
                ? 'bg-slate-900 text-white ring-slate-900'
                : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50',
            ].join(' ')}
          >
            All
          </button>
          {APPLICATION_STATUS_UI_VALUES.map((s) => {
            const m = STATUS_UI_META[s];
            const active = status === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(active ? null : s)}
                aria-pressed={active}
                className={[
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition-colors',
                  active
                    ? 'bg-brand-600 text-white ring-brand-600 hover:bg-brand-700'
                    : `${m.chip} hover:opacity-90`,
                ].join(' ')}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${
                  s === 'approved' ? 'bg-emerald-500' :
                  s === 'rejected' ? 'bg-rose-500' :
                  s === 'needs_revision' ? 'bg-sky-500' :
                  s === 'under_review' ? 'bg-amber-500' : 'bg-slate-500'
                }`} aria-hidden />
                {m.label}
              </button>
            );
          })}
          {(status !== null || debouncedSearch.length > 0) && (
            <button
              type="button"
              onClick={() => { setStatus(null); setSearch(''); }}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 bg-rose-50 hover:bg-rose-100"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M6.22 6.22a.75.75 0 0 1 1.06 0L12 10.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L13.06 12l4.72 4.72a.75.75 0 1 1-1.06 1.06L12 13.06l-4.72 4.72a.75.75 0 0 1-1.06-1.06L10.94 12 6.22 7.28a.75.75 0 0 1 0-1.06Z" fill="currentColor"/>
              </svg>
              Clear filters
            </button>
          )}
        </div>
      </section>

      {/* Results meta */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-500">
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Spinner size="sm" /> Loading results…
            </span>
          ) : (
            <>
              Showing{' '}
              <span className="font-semibold text-slate-900">{resultCount.toLocaleString()}</span>{' '}
              application{resultCount === 1 ? '' : 's'}
              {debouncedSearch && (
                <> matching <span className="font-mono text-slate-700">"{debouncedSearch}"</span></>
              )}
              {status && (
                <> with status{' '}
                  <span className="font-semibold text-slate-700">{STATUS_UI_META[status].label}</span>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Results */}
      {error ? (
        <ErrorState
          title="Could not load applications"
          message={error.message}
          retry={() => void load()}
        />
      ) : loading ? (
        <PageLoading label="Fetching applications…" />
      ) : sortedRows.length === 0 ? (
        <EmptyState
          title={debouncedSearch || status ? 'No applications match your filters' : 'No applications yet'}
          description={
            debouncedSearch || status
              ? 'Try removing some filters, clearing the search query, or checking back later for new submissions.'
              : 'Applications will appear here once applicants submit their PWD ID applications through the public form.'
          }
          action={
            debouncedSearch || status ? (
              <button
                type="button"
                onClick={() => { setStatus(null); setSearch(''); }}
                className="btn-secondary"
              >
                Clear filters
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th scope="col" className="px-6 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                      Applicant
                    </th>
                    <th scope="col" className="px-6 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                      App ID
                    </th>
                    <th scope="col" className="px-6 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                      Disability
                    </th>
                    <th scope="col" className="px-6 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                      Submitted
                    </th>
                    <th scope="col" className="px-6 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                      Status
                    </th>
                    <th scope="col" className="px-6 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {sortedRows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 font-bold text-sm ring-1 ring-brand-100">
                            {row.applicantName.charAt(0).toUpperCase() || 'A'}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900 truncate max-w-[18rem]">
                              {safeText(row.applicantName)}
                            </div>
                            <div className="text-xs text-slate-500 truncate max-w-[18rem]">
                              {safeText(row.applicantEmail || row.applicantPhone)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-slate-700">
                        #{row.applicationIdShort}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                        <div className="truncate max-w-[14rem]">{safeText(row.disability_type)}</div>
                        {row.disability_id_no && (
                          <div className="text-xs text-slate-500 font-mono truncate max-w-[14rem]">
                            {safeText(row.disability_id_no)}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                        {formatDate(row.applicationDate)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <Link
                          to={`/applications/${row.id}`}
                          className="btn-primary !py-2 !px-3 text-xs"
                        >
                          View
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
                            <path d="M10 17 15 12 10 7Z" fill="currentColor"/>
                          </svg>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <ul role="list" className="md:hidden space-y-3">
            {sortedRows.map((row) => (
              <li key={row.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 font-bold text-sm ring-1 ring-brand-100">
                    {row.applicantName.charAt(0).toUpperCase() || 'A'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900 truncate">
                        {safeText(row.applicantName)}
                      </h3>
                      <StatusBadge status={row.status} />
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <div>
                        <dt className="text-slate-500">App ID</dt>
                        <dd className="font-mono text-slate-700">#{row.applicationIdShort}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Submitted</dt>
                        <dd className="text-slate-700">{formatDate(row.applicationDate)}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-slate-500">Disability</dt>
                        <dd className="text-slate-700">{safeText(row.disability_type)}</dd>
                      </div>
                    </dl>
                    <div className="mt-3">
                      <Link to={`/applications/${row.id}`} className="btn-primary w-full !py-2.5">
                        View application
                        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                          <path d="M10 17 15 12 10 7Z" fill="currentColor"/>
                        </svg>
                      </Link>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
