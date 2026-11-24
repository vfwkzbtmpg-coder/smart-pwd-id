import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import DigitalIdCard from '../components/DigitalIdCard';
import MessagesThread from '../components/MessagesThread';
import {
  PageLoading,
  ErrorState,
  EmptyState,
  StatusBadge,
  ConfirmDialog,
  DataRow,
  formatDate,
  safeText,
  DocLink,
  Spinner,
} from '../components/ui';
import {
  fetchApplicationById,
  updateApplicationStatus,
  saveAdminNotesOnly,
  pwdAddr,
} from '../lib/adminQueries';
import type { ApplicationRow } from '../types';
import type { PostgrestError } from '@supabase/supabase-js';
import {
  APPLICATION_STATUS_UI_VALUES,
  STATUS_UI_META,
} from '../../config/dbSchemaConfig';
import type { ApplicationStatusUi } from '../../config/dbSchemaConfig';
import { uiStatusToDb } from '../../config/dbSchemaConfig';

interface PendingAction {
  status: ApplicationStatusUi;
  label: string;
  danger?: boolean;
}

const STATUS_ACTION_CONFIG: Record<
  ApplicationStatusUi,
  { btn: string; confirmTitle: string; confirmDesc: string; kind: 'primary' | 'success' | 'warn' | 'danger' | 'info' | 'slate' }
> = {
  submitted: {
    btn: 'Mark Submitted',
    confirmTitle: 'Reset status to Submitted?',
    confirmDesc: 'The application will be moved back to the Submitted queue (no review decision).',
    kind: 'slate',
  },
  under_review: {
    btn: 'Begin Review',
    confirmTitle: 'Mark as Under Review?',
    confirmDesc: 'This signals the file is being actively reviewed by an administrator.',
    kind: 'warn',
  },
  approved: {
    btn: 'Approve Application',
    confirmTitle: 'Approve this PWD ID application?',
    confirmDesc: 'Once approved, the applicant will be eligible to receive their PWD ID card. This action is recorded with your name and timestamp.',
    kind: 'success',
  },
  rejected: {
    btn: 'Reject Application',
    confirmTitle: 'Reject this application?',
    confirmDesc: 'The applicant will need to re-apply. We recommend leaving an admin note explaining why the application was rejected.',
    kind: 'danger',
  },
  needs_revision: {
    btn: 'Request Revision',
    confirmTitle: 'Send back for revision?',
    confirmDesc: 'The applicant will be asked to correct or supplement their submission. Please include clear admin notes listing what needs to be changed.',
    kind: 'info',
  },
};

export default function ApplicationDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<ApplicationRow | null>(null);
  const [error, setError] = useState<PostgrestError | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);

  const [notes, setNotes] = useState<string>('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [showCard, setShowCard] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const { row: r, error: e } = await fetchApplicationById(id);
      if (e) {
        setError(e);
        toast.error('Could not load application', e.message);
      } else if (!r) {
        setRow(null);
      } else {
        setRow(r);
        setNotes(r.admin_notes ?? '');
        setNotesDirty(false);
      }
    } catch {
      toast.error('Application unavailable', 'Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => { void load(); }, [load]);

  const handleConfirmStatus = async () => {
    if (!pending || !row || !user) return;
    setSavingStatus(true);
    try {
      const notesToSave = notes.trim().length ? notes.trim() : row.admin_notes ?? undefined;
      const result = await updateApplicationStatus({
        id: row.id,
        status: pending.status,
        adminNotes: notesToSave,
        adminUid: user.id,
      });
      if (!result.ok) {
        toast.error(
          `Failed to ${pending.label.toLowerCase()}`,
          result.error?.message || 'Please try again.'
        );
        return;
      }
      toast.success(
        `Application ${STATUS_UI_META[pending.status].label.toLowerCase()}`,
        notesToSave ? 'Status updated and review notes saved.' : 'Status has been updated successfully.'
      );
      await load();
    } catch {
      toast.error('Update failed', 'An unexpected error occurred.');
    } finally {
      setSavingStatus(false);
      setPending(null);
    }
  };

  const handleSaveNotes = async () => {
    if (!row || !user) return;
    setSavingNotes(true);
    try {
      const result = await saveAdminNotesOnly(row.id, notes, user.id);
      if (!result.ok) {
        toast.error('Could not save notes', result.error?.message || 'Please try again.');
        return;
      }
      setNotesDirty(false);
      toast.success('Notes saved', 'Your review notes have been stored.');
      await load();
    } catch {
      toast.error('Save failed', 'An unexpected error occurred.');
    } finally {
      setSavingNotes(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <header>
          <Link to="/applications" className="text-sm font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path d="M14 17 9 12l5-5Z" fill="currentColor"/>
            </svg>
            Back to applications
          </Link>
        </header>
        <PageLoading label="Loading application details…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <header>
          <Link to="/applications" className="text-sm font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path d="M14 17 9 12l5-5Z" fill="currentColor"/>
            </svg>
            Back to applications
          </Link>
        </header>
        <ErrorState
          title="Could not load application"
          message={error.message}
          retry={() => void load()}
        />
      </div>
    );
  }

  if (!row) {
    return (
      <div className="space-y-6">
        <header>
          <Link to="/applications" className="text-sm font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path d="M14 17 9 12l5-5Z" fill="currentColor"/>
            </svg>
            Back to applications
          </Link>
        </header>
        <EmptyState
          title="Application not found"
          description={`We couldn't find an application with ID ${id ? `#${String(id).slice(0, 8).toUpperCase()}` : 'this identifier'}. It may have been deleted or the URL is incorrect.`}
          action={<Link to="/applications" className="btn-primary">Go to applications list</Link>}
        />
      </div>
    );
  }

  const applicant = row.applicant;
  const address = pwdAddr(applicant);

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <header className="space-y-4">
        <div>
          <Link to="/applications" className="text-sm font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path d="M14 17 9 12l5-5Z" fill="currentColor"/>
            </svg>
            Back to applications
          </Link>
        </div>

        <div className="card p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4 min-w-0">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 font-extrabold text-xl ring-1 ring-brand-100">
                {row.applicantName.charAt(0).toUpperCase() || 'A'}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="h1 truncate">{safeText(row.applicantName)}</h1>
                  <StatusBadge status={row.status} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
                  <span className="font-mono">Application #{row.applicationIdShort}</span>
                  <span className="hidden sm:inline text-slate-300">•</span>
                  <span>Submitted: {formatDate(row.applicationDate)}</span>
                  {row.reviewed_at && (
                    <>
                      <span className="hidden sm:inline text-slate-300">•</span>
                      <span>Last reviewed: {formatDate(row.reviewed_at)}</span>
                    </>
                  )}
                </div>
                {row.applicantEmail && (
                  <div className="mt-1 text-sm text-slate-500 truncate">
                    <a href={`mailto:${row.applicantEmail}`} className="hover:underline">
                      {row.applicantEmail}
                    </a>
                  </div>
                )}
                {row.applicantPhone && (
                  <div className="mt-0.5 text-sm text-slate-500">
                    <a href={`tel:${row.applicantPhone}`} className="hover:underline">
                      {row.applicantPhone}
                    </a>
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void load()}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <path d="M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z" fill="currentColor"/>
                </svg>
                Refresh
              </button>
              <Link to="/applications" className="btn-ghost">
                Cancel
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Review action banner (always visible sticky on wide screens) */}
      <section className="card p-5 sm:p-6 ring-2 ring-slate-200" aria-label="Review actions">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h2 className="h3">Change application status</h2>
            <p className="mt-1 text-sm text-slate-600 max-w-xl">
              Each status change is recorded with your name, email, and the current time. We recommend writing an admin note for Approved / Rejected / Needs Revision decisions.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {APPLICATION_STATUS_UI_VALUES.map((s) => {
              const cfg = STATUS_ACTION_CONFIG[s];
              const sameStatus = row.status === s;
              const cls =
                cfg.kind === 'success' ? 'btn-success' :
                cfg.kind === 'danger' ? 'btn-danger' :
                cfg.kind === 'warn' ? 'btn-warn' :
                cfg.kind === 'info' ? 'btn-info' :
                cfg.kind === 'slate' ? 'btn-slate' : 'btn-primary';
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setPending({ status: s, label: cfg.btn, danger: cfg.kind === 'danger' })}
                  disabled={sameStatus}
                  className={`${cls} !py-2 !px-3.5 text-xs sm:text-sm ${sameStatus ? 'ring-2 ring-offset-2 ring-slate-300' : ''}`}
                  aria-pressed={sameStatus}
                >
                  {sameStatus && (
                    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                      <path d="m9 16.2-3.5-3.5L4 14.2 9 19.2 20 8.2 18.5 6.7Z" fill="currentColor"/>
                    </svg>
                  )}
                  {cfg.btn}
                </button>
              );
            })}
          </div>
        </div>

        {/* Review notes: the internal memo that rides along with every status
            change. Kept collapsed and quiet so it no longer dominates the page,
            but still the single source for the note sent to the reviewer trail. */}
        <details className="group mt-5 border-t border-slate-200 pt-4">
          <summary className="kicker inline-flex cursor-pointer select-none list-none items-center gap-1.5 text-slate-600 hover:text-slate-900">
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
              aria-hidden="true"
            >
              <path d="M9 6l6 6-6 6Z" fill="currentColor"/>
            </svg>
            Review notes
            {notesDirty
              ? <span className="font-normal normal-case text-amber-600">· unsaved</span>
              : row.admin_notes
                ? <span className="font-normal normal-case text-slate-400">· saved</span>
                : null}
          </summary>

          <div className="mt-3">
            <label htmlFor="admin-notes" className="sr-only">Review notes</label>
            <textarea
              id="admin-notes"
              rows={3}
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setNotesDirty(true); }}
              placeholder="Notes for other administrators. Attached to the next status change."
              className="input resize-y"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-500">
                {notes.length} characters · administrators only
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary !px-3 !py-1.5 text-xs"
                  onClick={() => { setNotes(row.admin_notes ?? ''); setNotesDirty(false); }}
                  disabled={!notesDirty || savingNotes}
                >
                  Revert
                </button>
                <button
                  type="button"
                  className="btn-primary !px-3 !py-1.5 text-xs"
                  onClick={() => void handleSaveNotes()}
                  disabled={!notesDirty || savingNotes}
                >
                  {savingNotes && <Spinner size="sm" />}
                  {savingNotes ? 'Saving…' : 'Save notes'}
                </button>
              </div>
            </div>
          </div>
        </details>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: details */}
        <div className="space-y-6 lg:col-span-2">
          {/* Applicant info */}
          <section className="card p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="h3">Applicant information</h2>
              <span className="kicker">Profile</span>
            </div>
            <dl className="mt-4 divide-y divide-slate-100">
              <DataRow label="Full name">
                <span className="font-semibold text-slate-900">
                  {safeText(applicant.full_name || row.applicantName)}
                </span>
                <div className="text-xs text-slate-500 mt-0.5">
                  {[applicant.first_name, applicant.middle_name, applicant.last_name]
                    .filter(Boolean).join(' · ') || '—'}
                </div>
              </DataRow>
              <DataRow label="Email">
                {row.applicantEmail
                  ? <a href={`mailto:${row.applicantEmail}`}>{row.applicantEmail}</a>
                  : '—'}
              </DataRow>
              <DataRow label="Phone / Mobile">
                {row.applicantPhone
                  ? <a href={`tel:${row.applicantPhone}`}>{row.applicantPhone}</a>
                  : '—'}
              </DataRow>
              <DataRow label="Birthdate">
                {safeText(applicant.birthdate)}
              </DataRow>
              <DataRow label="Address">
                {address.trim() ? address : '—'}
              </DataRow>
              <DataRow label="PWD ID number (existing)">
                {safeText(applicant.pwd_id_number)}
                {applicant.expiration_date && (
                  <div className="text-xs text-slate-500 mt-0.5">
                    Valid until: {formatDate(applicant.expiration_date)}
                  </div>
                )}
              </DataRow>
            </dl>
          </section>

          {/* Application info */}
          <section className="card p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="h3">Application details</h2>
              <span className="kicker">PWD File #{row.applicationIdShort}</span>
            </div>
            <dl className="mt-4 divide-y divide-slate-100">
              <DataRow label="Application ID" mono>
                {row.id}
              </DataRow>
              <DataRow label="User ID" mono>
                {row.user_id}
              </DataRow>
              <DataRow label="Disability type">
                {safeText(row.disability_type)}
              </DataRow>
              <DataRow label="Disability ID / Reference no.">
                {safeText(row.disability_id_no)}
              </DataRow>
              <DataRow label="Submitted at">
                {formatDate(row.submitted_at || row.applicationDate)}
              </DataRow>
              <DataRow label="Reviewed at">
                {formatDate(row.reviewed_at)}
              </DataRow>
              <DataRow label="Reviewed by (UID)" mono>
                {row.reviewed_by ?? '—'}
              </DataRow>
              <DataRow label="Current DB status">
                <span className="inline-flex items-center gap-2">
                  <code className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-700">
                    {safeText(row.statusRaw)}
                  </code>
                  <span className="text-slate-400 text-xs">→ mapped to</span>
                  <StatusBadge status={row.status} />
                </span>
              </DataRow>
            </dl>
          </section>

          {/* Uploaded documents */}
          <section className="card p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="h3">Uploaded documents</h2>
              <span className="kicker">Supporting files</span>
            </div>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <DocLink label="ID (Front)" url={row.documents.id_front_url} />
              <DocLink label="ID (Back)" url={row.documents.id_back_url} />
              <DocLink label="Photo" url={row.documents.photo_url} />
              <DocLink label="Medical Certificate" url={row.documents.medical_cert_url} />
              <DocLink label="Barangay Certificate" url={row.documents.barangay_cert_url} />
            </div>
          </section>

          {/* Digital ID Card — the 3D flip card, background picker and the
              "Reader NFC Scan" control, exactly as on the legacy admin page.
              Keyed by application so switching rows resets the card's local
              state instead of carrying it across applicants. */}
          <section className="card p-5 sm:p-6">
            <button
              type="button"
              onClick={() => setShowCard((v) => !v)}
              aria-expanded={showCard}
              aria-controls="digital-id-card-body"
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <h2 className="h3">Digital ID Card</h2>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-brand-600">
                {showCard ? 'Hide' : 'Show'}
                <svg
                  viewBox="0 0 24 24"
                  className={`h-4 w-4 transition-transform ${showCard ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                >
                  <path d="M12 15.5 6.5 10l1.4-1.4 4.1 4.1 4.1-4.1L17.5 10Z" fill="currentColor"/>
                </svg>
              </span>
            </button>

            {showCard && (
              <div id="digital-id-card-body" className="mt-4">
                <DigitalIdCard
                  key={row.id}
                  appId={row.id}
                  userId={row.user_id}
                  status={row.status}
                  card={row.card}
                  contactFallback={row.applicantPhone}
                  onBackgroundSaved={() => void load()}
                />
              </div>
            )}
          </section>
        </div>

        {/* Right column: the applicant's private thread + quick actions */}
        <aside className="space-y-6">
          <MessagesThread
            key={row.user_id}
            userId={row.user_id}
            applicantName={row.applicantName}
          />

          {/* Quick actions menu */}
          <section className="card p-5 sm:p-6">
            <h2 className="h3">Quick actions</h2>
            <ul className="mt-4 space-y-2">
              <li>
                <button
                  type="button"
                  className="w-full btn-secondary !justify-start text-left"
                  onClick={() => navigate('/applications')}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                    <path d="M14 17 9 12l5-5Z" fill="currentColor"/>
                  </svg>
                  Back to applications list
                </button>
              </li>
              <li>
                {row.applicantEmail ? (
                  <a
                    href={`mailto:${row.applicantEmail}?subject=Re%20PWD%20ID%20Application%20%23${row.applicationIdShort}`}
                    className="w-full btn-secondary !justify-start text-left no-underline"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                      <path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 4-8 5-8-5V6l8 5 8-5Z" fill="currentColor"/>
                    </svg>
                    Email the applicant
                  </a>
                ) : (
                  <button type="button" className="w-full btn-secondary !justify-start text-left" disabled>
                    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                      <path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Z" fill="currentColor"/>
                    </svg>
                    Email not available
                  </button>
                )}
              </li>
              <li>
                <button
                  type="button"
                  className="w-full btn-secondary !justify-start text-left"
                  onClick={() => {
                    const text = [
                      `Application #${row.applicationIdShort}`,
                      `Name: ${row.applicantName}`,
                      `Status: ${uiStatusToDb(row.status)}`,
                      row.disability_type ? `Disability: ${row.disability_type}` : null,
                    ].filter(Boolean).join('\n');
                    navigator.clipboard?.writeText(text);
                    toast.info('Summary copied', 'Application summary copied to clipboard.');
                  }}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                    <path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11Z" fill="currentColor"/>
                  </svg>
                  Copy summary
                </button>
              </li>
            </ul>
          </section>
        </aside>
      </div>

      {/* Confirm status dialog */}
      <ConfirmDialog
        open={!!pending}
        title={pending ? STATUS_ACTION_CONFIG[pending.status].confirmTitle : ''}
        description={pending ? STATUS_ACTION_CONFIG[pending.status].confirmDesc : ''}
        confirmLabel={
          savingStatus
            ? `Updating to ${pending ? STATUS_UI_META[pending.status].label.toLowerCase() : 'status'}…`
            : pending?.label ?? 'Confirm'
        }
        cancelLabel="Cancel"
        danger={pending?.danger}
        loading={savingStatus}
        onConfirm={() => void handleConfirmStatus()}
        onCancel={() => !savingStatus && setPending(null)}
      >
        {pending && (
          <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 p-3 space-y-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500 font-semibold">New status</span>
              <StatusBadge status={pending.status} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500 font-semibold">Applicant</span>
              <span className="text-slate-800 font-semibold truncate max-w-[60%]">
                {safeText(row.applicantName)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500 font-semibold">Admin</span>
              <span className="text-slate-800 truncate max-w-[60%]">
                {user?.firstName || user?.lastName
                  ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
                  : user?.email ?? 'You'}
              </span>
            </div>
            <div className="flex items-start justify-between gap-3 pt-1">
              <span className="text-slate-500 font-semibold">Review note</span>
              <span className="text-right text-slate-700 max-w-[60%]">
                {notes.trim() ? 'Will be saved with this update.' : 'None.'}
              </span>
            </div>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
