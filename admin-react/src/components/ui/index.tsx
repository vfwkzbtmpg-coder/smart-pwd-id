import React from 'react';
import { STATUS_UI_META } from '../../../config/dbSchemaConfig';
import type { ApplicationStatusUi } from '../../../config/dbSchemaConfig';

export function StatusBadge({ status }: { status: ApplicationStatusUi }) {
  const m = STATUS_UI_META[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide ${m.chip}`}
    >
      <span
        className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
          status === 'approved'
            ? 'bg-emerald-500'
            : status === 'rejected'
              ? 'bg-rose-500'
              : status === 'needs_revision'
                ? 'bg-sky-500'
                : status === 'under_review'
                  ? 'bg-amber-500'
                  : 'bg-slate-500'
        }`}
        aria-hidden
      />
      {m.label}
    </span>
  );
}

export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const px = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-10 w-10' : 'h-6 w-6';
  return (
    <svg className={`animate-spin text-brand-600 ${px}`} viewBox="0 0 24 24" fill="none" aria-label="Loading">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor"
            d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}

export function PageLoading({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6">
      <Spinner size="lg" />
      <div className="text-sm font-medium text-slate-500">{label ?? 'Loading…'}</div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string | undefined;
  icon?: React.ReactNode | undefined;
  action?: React.ReactNode | undefined;
}) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        {icon ?? (
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7">
            <path d="M20 7h-5V4H9v3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2ZM10.5 5.5h3V7h-3V5.5Z" fill="currentColor"/>
          </svg>
        )}
      </div>
      <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title,
  message,
  retry,
}: {
  title: string;
  message?: string | undefined;
  retry?: (() => void) | undefined;
}) {
  return (
    <div className="card p-6 sm:p-8">
      <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 ring-1 ring-rose-200">
          <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm1 15h-2v-2h2Zm0-4h-2V7h2Z" fill="currentColor"/>
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-lg font-bold text-slate-900">{title}</div>
          {message && <div className="mt-1 text-sm text-slate-600">{message}</div>}
        </div>
        {retry && (
          <button type="button" className="btn-secondary" onClick={retry}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open, title, description, confirmLabel = 'Confirm',
  cancelLabel = 'Cancel', danger, loading, onConfirm, onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description?: string | undefined;
  confirmLabel?: string | undefined;
  cancelLabel?: string | undefined;
  danger?: boolean | undefined;
  loading?: boolean | undefined;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode | undefined;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-sm p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmTitle"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
        <h3 id="confirmTitle" className="text-lg font-bold text-slate-900">{title}</h3>
        {description && <p className="mt-2 text-sm text-slate-600">{description}</p>}
        {children && <div className="mt-4">{children}</div>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading && <Spinner size="sm" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DataRow({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="py-3 first:pt-0 last:pb-0 sm:grid sm:grid-cols-3 sm:gap-4">
      <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500 sm:pt-1">{label}</dt>
      <dd className={`mt-0.5 sm:col-span-2 sm:mt-0 text-sm text-slate-800 ${mono ? 'font-mono' : ''}`}>
        {children}
      </dd>
    </div>
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

export function safeText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

export function DocLink({ label, url }: { label: string; url: string | null }) {
  if (!url) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        {label} — Not uploaded
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-brand-700 ring-1 ring-slate-200 hover:bg-brand-50"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        <path fill="currentColor" d="M12 2a10 10 0 0 0-7.35 16.76l-.94 3.39 3.49-.92A10 10 0 1 0 12 2Zm2 14h-4v-2h4Zm0-4h-4V8h4Z"/>
      </svg>
      View {label}
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
        <path fill="currentColor" d="M14 3h7v7h-2V6.41l-9.3 9.3-1.4-1.42L17.58 5H14Zm-9 4h5v2H7v11h11v-5h2v7H5Z"/>
      </svg>
    </a>
  );
}
