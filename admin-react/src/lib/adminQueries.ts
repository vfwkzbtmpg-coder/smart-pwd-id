import type {
  ApplicationRow,
  ApplicantProfile,
  AdminUser,
  Database,
} from '@/types';
import type { PostgrestError } from '@supabase/supabase-js';
import {
  APPLICATION_COLUMNS,
  APP_TABLE_NAMES,
  ADMIN_ROLE_NAME,
  PROFILE_COLUMNS,
  dbStatusToUi,
} from '../../config/dbSchemaConfig';
import { supabase } from '../supabaseClient';
import type { ApplicationStatusUi } from '../../config/dbSchemaConfig';
import { uiStatusToDb } from '../../config/dbSchemaConfig';

/* ----------------------------- admin helpers ----------------------------- */

/**
 * Fetch the current admin user profile.
 * Security: RLS in 004_rls_admin_applications.sql guarantees that
 *           anon key user can only read own row from profiles unless
 *           their role is 'admin' (then they can see ALL profiles).
 *           We read 'me' (my profile by auth.uid()) to confirm role.
 */
export async function fetchCurrentAdminUser(): Promise<AdminUser | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from(APP_TABLE_NAMES.profiles)
    .select(
      [
        PROFILE_COLUMNS.id,
        PROFILE_COLUMNS.first_name,
        PROFILE_COLUMNS.last_name,
        PROFILE_COLUMNS.role,
        PROFILE_COLUMNS.account_type,
        PROFILE_COLUMNS.created_at,
      ].join(',')
    )
    .eq(PROFILE_COLUMNS.id, user.id)
    .maybeSingle();

  if (error || !data) {
    // admin user exists in auth.users but might not yet have a profile row (edge case)
    return {
      id: user.id,
      email: user.email ?? null,
      firstName: (user.user_metadata?.first_name as string) ?? null,
      lastName: (user.user_metadata?.last_name as string) ?? null,
      role: (user.user_metadata?.role as string) ?? null,
      accountType: (user.user_metadata?.account_type as string) ?? null,
      isAdmin:
        String((user.user_metadata?.role as string | undefined) ?? '')
          .toLowerCase()
          .trim() === String(ADMIN_ROLE_NAME).toLowerCase().trim(),
      createdAt: user.created_at ?? null,
    };
  }

  const me = data as any;
  const roleRaw = String(me[PROFILE_COLUMNS.role] ?? '').trim().toLowerCase();
  return {
    id: me[PROFILE_COLUMNS.id],
    email: user.email ?? null,
    firstName: me[PROFILE_COLUMNS.first_name],
    lastName: me[PROFILE_COLUMNS.last_name],
    role: me[PROFILE_COLUMNS.role],
    accountType: me[PROFILE_COLUMNS.account_type],
    isAdmin: roleRaw === String(ADMIN_ROLE_NAME).toLowerCase().trim(),
    createdAt: me[PROFILE_COLUMNS.created_at] ?? user.created_at ?? null,
  };
}

/* ----------------------------- application helpers ----------------------------- */

function buildApplicantName(p: ApplicantProfile): string {
  if (p.full_name) return p.full_name;
  const parts = [p.first_name, p.last_name].filter((x) => x && x.trim().length);
  return parts.join(' ').trim() || `Applicant ${p.id.slice(0, 8)}`;
}

function buildPhone(p: ApplicantProfile): string | null {
  return (
    (p.contact_number && p.contact_number.trim().length ? p.contact_number : null) ||
    (p.mobile && p.mobile.trim().length ? p.mobile : null) ||
    null
  );
}

function pwdAddr(p: ApplicantProfile): string {
  const parts = [
    p.address_house_no,
    p.address_street,
    `Barangay ${p.address_barangay ?? ''}`,
    p.address_city,
    p.address_province,
    p.address_postal_code,
  ]
    .map((s) => (s ? String(s).trim() : ''))
    .filter((s) => s.length);
  return parts.join(', ');
}

export { pwdAddr };

/** Dates kept as a raw string before migration 005 stored them in disability_type. */
const DATE_LIKE = /^[0-9]{1,4}[/.-][0-9]{1,2}[/.-][0-9]{2,4}$/;

/** Short date for the card's "Date issued" / "Valid until" lines. */
export function fmtDay(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }) : '—';
}

/**
 * The card prints the birthdate in long form ("OCTOBER 15, 2000"). The form
 * collects it as dd/mm/yyyy, so both that and ISO are accepted.
 */
export function fmtBirthdate(v: string | null | undefined): string {
  const raw = String(v == null ? '' : v).trim();
  if (!raw) return '—';
  let d: Date | null = null;
  const dmy = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  const ymd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (dmy) d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  else if (ymd) d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  if (!d || isNaN(d.getTime())) return raw.toUpperCase();
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase();
}

/**
 * Returns all joined applications with applicant profile rows.
 * Security: uses ANON client, admin RLS on both tables enforces:
 *   - You must be signed in as an admin.
 *   - Otherwise count = 0.
 */
export async function fetchApplicationsJoined(
  filters: { status?: ApplicationStatusUi | undefined; search?: string | undefined } = {}
): Promise<{ rows: ApplicationRow[]; error: PostgrestError | null }> {
  const appCols = [
    APPLICATION_COLUMNS.id,
    APPLICATION_COLUMNS.user_id,
    APPLICATION_COLUMNS.verification_status,
    APPLICATION_COLUMNS.submitted_at,
    APPLICATION_COLUMNS.reviewed_at,
    APPLICATION_COLUMNS.reviewed_by,
    APPLICATION_COLUMNS.admin_notes,
    APPLICATION_COLUMNS.disability_type,
    APPLICATION_COLUMNS.disability_id_no,
    APPLICATION_COLUMNS.id_front_url,
    APPLICATION_COLUMNS.id_back_url,
    APPLICATION_COLUMNS.photo_url,
    APPLICATION_COLUMNS.medical_cert_url,
    APPLICATION_COLUMNS.barangay_cert_url,
    APPLICATION_COLUMNS.birthdate,
    APPLICATION_COLUMNS.sex,
    APPLICATION_COLUMNS.blood_type,
    APPLICATION_COLUMNS.emergency_name,
    APPLICATION_COLUMNS.emergency_contact,
    APPLICATION_COLUMNS.address,
    APPLICATION_COLUMNS.signature_url,
    APPLICATION_COLUMNS.bg_front,
    APPLICATION_COLUMNS.created_at,
    APPLICATION_COLUMNS.updated_at,
  ].join(',');

  const profCols = [
    PROFILE_COLUMNS.id,
    PROFILE_COLUMNS.first_name,
    PROFILE_COLUMNS.last_name,
    PROFILE_COLUMNS.middle_name,
    PROFILE_COLUMNS.full_name,
    PROFILE_COLUMNS.mobile,
    PROFILE_COLUMNS.contact_number,
    PROFILE_COLUMNS.pwd_id_number,
    PROFILE_COLUMNS.id_number,
    PROFILE_COLUMNS.expiration_date,
    PROFILE_COLUMNS.valid_until,
    PROFILE_COLUMNS.birthdate,
    PROFILE_COLUMNS.address_house_no,
    PROFILE_COLUMNS.address_street,
    PROFILE_COLUMNS.address_barangay,
    PROFILE_COLUMNS.address_city,
    PROFILE_COLUMNS.address_province,
    PROFILE_COLUMNS.address_postal_code,
    PROFILE_COLUMNS.application_status,
  ].join(',');

  let query = supabase
    .from(APP_TABLE_NAMES.applications)
    .select(`${appCols}, profiles!user_id(${profCols})`, { count: 'exact' });

  if (filters.status) {
    // We must match by raw DB status text. Since there are many
    // synonyms (Pending, Under Review, etc.) we map UI → all
    // possible DB synonyms via Postgres ILIKE IN list.
    const synMap: Record<ApplicationStatusUi, string[]> = {
      submitted:      ['Submitted', 'New'],
      under_review:   ['Pending', 'Under Review', 'In Review'],
      approved:       ['Approved'],
      rejected:       ['Rejected', 'Denied', 'Declined'],
      needs_revision: ['Needs Revision', 'For Revision', 'Revise', 'Revision'],
    };
    query = query.in(APPLICATION_COLUMNS.verification_status, synMap[filters.status]);
  }

  const { data, error } = await query;
  if (error) return { rows: [], error };

  const mapped: ApplicationRow[] = (data ?? []).map((row: any) => {
    const pRaw = row.profiles;

    // Rows created before migration 005 kept the birthdate inside disability_type,
    // so a date-like value there is the birthdate and the disability type is blank.
    const legacyDisabilityType = String(row[APPLICATION_COLUMNS.disability_type] ?? '').trim();
    const legacyBirthdate = DATE_LIKE.test(legacyDisabilityType) ? legacyDisabilityType : '';
    // pwd_applications is the authoritative source — profiles.birthdate is
    // normally empty, which is why this page used to show a dash.
    const birthdate =
      String(row[APPLICATION_COLUMNS.birthdate] ?? '').trim() ||
      legacyBirthdate ||
      String(pRaw[PROFILE_COLUMNS.birthdate] ?? '').trim();

    const applicant: ApplicantProfile = {
      id: pRaw[PROFILE_COLUMNS.id],
      first_name: pRaw[PROFILE_COLUMNS.first_name] ?? null,
      last_name: pRaw[PROFILE_COLUMNS.last_name] ?? null,
      middle_name: pRaw[PROFILE_COLUMNS.middle_name] ?? null,
      full_name: pRaw[PROFILE_COLUMNS.full_name] ?? null,
      email: null, // see fetchApplicationById (email is from auth service — server only)
      mobile: pRaw[PROFILE_COLUMNS.mobile] ?? null,
      contact_number: pRaw[PROFILE_COLUMNS.contact_number] ?? null,
      pwd_id_number: pRaw[PROFILE_COLUMNS.pwd_id_number] ?? null,
      id_number: pRaw[PROFILE_COLUMNS.id_number] ?? null,
      expiration_date: pRaw[PROFILE_COLUMNS.expiration_date] ?? null,
      valid_until: pRaw[PROFILE_COLUMNS.valid_until] ?? null,
      address_house_no: pRaw[PROFILE_COLUMNS.address_house_no] ?? null,
      address_street: pRaw[PROFILE_COLUMNS.address_street] ?? null,
      address_barangay: pRaw[PROFILE_COLUMNS.address_barangay] ?? null,
      address_city: pRaw[PROFILE_COLUMNS.address_city] ?? null,
      address_province: pRaw[PROFILE_COLUMNS.address_province] ?? null,
      address_postal_code: pRaw[PROFILE_COLUMNS.address_postal_code] ?? null,
      birthdate: birthdate || null,
      application_status: pRaw[PROFILE_COLUMNS.application_status] ?? null,
    };
    const statusRaw: string | null = row[APPLICATION_COLUMNS.verification_status] ?? null;
    const status = dbStatusToUi(statusRaw);
    return {
      id: row[APPLICATION_COLUMNS.id],
      user_id: row[APPLICATION_COLUMNS.user_id],
      statusRaw,
      status,
      submitted_at: row[APPLICATION_COLUMNS.submitted_at] ?? null,
      reviewed_at: row[APPLICATION_COLUMNS.reviewed_at] ?? null,
      reviewed_by: row[APPLICATION_COLUMNS.reviewed_by] ?? null,
      admin_notes: row[APPLICATION_COLUMNS.admin_notes] ?? null,
      disability_type: row[APPLICATION_COLUMNS.disability_type] ?? null,
      disability_id_no: row[APPLICATION_COLUMNS.disability_id_no] ?? null,
      created_at: row[APPLICATION_COLUMNS.created_at] ?? null,
      updated_at: row[APPLICATION_COLUMNS.updated_at] ?? null,
      documents: {
        id_front_url: row[APPLICATION_COLUMNS.id_front_url] ?? null,
        id_back_url: row[APPLICATION_COLUMNS.id_back_url] ?? null,
        photo_url: row[APPLICATION_COLUMNS.photo_url] ?? null,
        medical_cert_url: row[APPLICATION_COLUMNS.medical_cert_url] ?? null,
        barangay_cert_url: row[APPLICATION_COLUMNS.barangay_cert_url] ?? null,
      },
      applicant,
      card: {
        idNumber: applicant.id_number ?? '',
        qrToken: '', // filled in by fetchApplicationById — see fetchQrToken
        name: buildApplicantName(applicant),
        disabilityType: legacyBirthdate ? '' : legacyDisabilityType,
        birthdate,
        sex: (row[APPLICATION_COLUMNS.sex] as string | null) ?? '',
        photoUrl: row[APPLICATION_COLUMNS.photo_url] ?? '',
        signatureUrl: (row[APPLICATION_COLUMNS.signature_url] as string | null) ?? '',
        emergencyName: (row[APPLICATION_COLUMNS.emergency_name] as string | null) ?? '',
        emergencyContact: (row[APPLICATION_COLUMNS.emergency_contact] as string | null) ?? '',
        address: (row[APPLICATION_COLUMNS.address] as string | null) ?? '',
        bloodType: (row[APPLICATION_COLUMNS.blood_type] as string | null) ?? '',
        dateIssued: row[APPLICATION_COLUMNS.reviewed_at] ?? row[APPLICATION_COLUMNS.submitted_at] ?? null,
        validUntil: applicant.valid_until,
        bgFront: String(row[APPLICATION_COLUMNS.bg_front] ?? '').toLowerCase(),
      },
      applicantName: buildApplicantName(applicant),
      applicantEmail: applicant.email,
      applicantPhone: buildPhone(applicant),
      applicationIdShort: String(row[APPLICATION_COLUMNS.id] ?? '').slice(0, 8).toUpperCase(),
      applicationDate: row[APPLICATION_COLUMNS.submitted_at] ?? row[APPLICATION_COLUMNS.created_at] ?? null,
    };
  });

  if (filters.search && filters.search.trim().length) {
    const q = filters.search.trim().toLowerCase();
    const ok = mapped.filter((r) =>
      [
        r.applicantName,
        r.applicantEmail,
        r.applicantPhone,
        r.applicationIdShort,
        r.id,
        r.disability_type,
        r.disability_id_no,
      ]
        .map((s) => (s ?? '').toLowerCase())
        .some((s) => s.includes(q))
    );
    return { rows: ok, error: null };
  }
  return { rows: mapped, error: null };
}

/**
 * Email addresses live in auth.users, which the anon key cannot read — only the
 * Express service (service_role) can. It exposes `userEmail` on
 * GET /api/applications, so that is the one place the console can get it from.
 * Returns null on any failure so the page still renders without the email.
 */
async function fetchApplicantEmail(userId: string): Promise<string | null> {
  if (!userId) return null;
  try {
    const res = await fetch(`/api/applications?user_id=${encodeURIComponent(userId)}`);
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !json.ok) return null;
    const list = Array.isArray(json.applications) ? json.applications : [];
    const hit = list.find((a: any) => a && a.userEmail) as { userEmail?: string } | undefined;
    const email = hit && hit.userEmail ? String(hit.userEmail).trim() : '';
    return email || null;
  } catch {
    return null;
  }
}

export async function fetchApplicationById(
  id: string
): Promise<{ row: ApplicationRow | null; error: PostgrestError | null }> {
  const { rows, error } = await fetchApplicationsJoined();
  if (error) return { row: null, error };
  const r = rows.find((x) => x.id === id) ?? null;
  if (!r) return { row: null, error: null };

  // The join above can only reach public.profiles, so the email arrives empty.
  // Fill it in from the server-side auth lookup.
  const email = await fetchApplicantEmail(r.user_id);
  if (email) {
    r.applicantEmail = email;
    r.applicant.email = email;
  }

  const qrToken = await fetchQrToken(r.user_id);
  if (qrToken) r.card.qrToken = qrToken;
  return { row: r, error: null };
}

/**
 * The holder's QR secret, kept out of the shared application select so the
 * console still lists applications on a database that has not run migration
 * 012 yet — it just builds ID-number-only links, as it did before.
 */
async function fetchQrToken(userId: string): Promise<string | null> {
  if (!userId) return null;
  try {
    const { data, error } = await supabase
      .from(APP_TABLE_NAMES.profiles)
      .select(PROFILE_COLUMNS.qr_token)
      .eq(PROFILE_COLUMNS.id, userId)
      .maybeSingle();
    if (error) return null;
    const token = (data as Record<string, unknown> | null)?.[PROFILE_COLUMNS.qr_token];
    return token ? String(token) : null;
  } catch {
    return null;
  }
}

/**
 * Detaches a lost NFC card from a holder. Runs through the Express service
 * because it needs the service-role key to clear both nfc_uid and the legacy
 * nfc_id column, and because RLS only lets a cardholder edit their own row.
 */
export async function unlinkNfcCard(
  userId: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? '';
    const res = await fetch(`/api/profiles/${encodeURIComponent(userId)}/nfc-card`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !json.ok) {
      return {
        ok: false,
        message: (json && json.message) || `The admin service refused the request (${res.status}).`,
      };
    }
    return { ok: true, message: json.message || 'The lost NFC card has been unlinked.' };
  } catch (err) {
    return {
      ok: false,
      message:
        (err as Error)?.message ||
        'Could not reach the admin service. Make sure the API on port 4000 is running.',
    };
  }
}

export async function fetchApplicationStats(): Promise<{
  error: PostgrestError | null;
  counts: Record<ApplicationStatusUi, number> & { total: number };
}> {
  const { rows, error } = await fetchApplicationsJoined();
  const counts: Record<ApplicationStatusUi, number> & { total: number } = {
    total: 0,
    submitted: 0,
    under_review: 0,
    approved: 0,
    rejected: 0,
    needs_revision: 0,
  };
  if (error) return { error, counts };
  counts.total = rows.length;
  for (const r of rows) {
    counts[r.status] = (counts[r.status] || 0) + 1;
  }
  return { error: null, counts };
}

export interface UpdateStatusPayload {
  id: string;
  status: ApplicationStatusUi;
  adminNotes?: string | undefined;
  adminUid: string;
}

/**
 * Calls the Express review endpoint (server/server.js, proxied by Vite).
 *
 * Admin decisions go through this endpoint instead of writing straight to
 * Supabase because the endpoint is what mirrors a decision onto `profiles`:
 * it sets application_status, issues the id_number and stamps valid_until.
 * Without that mirror an "Approved" row could never be verified by the NFC
 * reader or the QR scanner.
 */
async function putApplication(
  id: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; error: PostgrestError | null }> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? '';
    const res = await fetch(`/api/applications/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !json.ok) {
      return {
        ok: false,
        error: {
          message: (json && json.message) || `The admin service refused the change (${res.status}).`,
        } as unknown as PostgrestError,
      };
    }
    return { ok: true, error: null };
  } catch (err) {
    return {
      ok: false,
      error: {
        message:
          (err as Error)?.message ||
          'Could not reach the admin service. Make sure the API on port 4000 is running.',
      } as unknown as PostgrestError,
    };
  }
}

/**
 * Updates application status & admin notes.
 *
 * `adminUid` is required because pwd_applications.reviewed_by is a uuid column:
 * a non-uuid value (such as the role name "admin") would fail the whole UPDATE.
 */
export async function updateApplicationStatus({
  id,
  status,
  adminNotes,
  adminUid,
}: UpdateStatusPayload): Promise<{ ok: boolean; error: PostgrestError | null }> {
  const body: Record<string, unknown> = {
    status: uiStatusToDb(status),
    reviewedBy: adminUid,
  };
  if (typeof adminNotes === 'string') body.reviewNotes = adminNotes.trim();
  return putApplication(id, body);
}

/**
 * Saves the Digital ID Card front background (an LGU slug) on its own so the
 * pick survives even while the application is still undecided. Sending only
 * `bgFront` leaves the application status untouched.
 */
export async function saveCardBackground(
  id: string,
  slug: string
): Promise<{ ok: boolean; error: PostgrestError | null }> {
  return putApplication(id, { bgFront: slug });
}

export async function saveAdminNotesOnly(
  id: string,
  notes: string,
  adminUid: string
): Promise<{ ok: boolean; error: PostgrestError | null }> {
  const update: Database['public']['Tables']['pwd_applications']['Update'] = {
    [APPLICATION_COLUMNS.admin_notes]: notes.trim().length ? notes.trim() : null,
    [APPLICATION_COLUMNS.reviewed_at]: new Date().toISOString(),
    [APPLICATION_COLUMNS.reviewed_by]: adminUid,
  } as any;
  const { error } = await (supabase
    .from(APP_TABLE_NAMES.applications) as any)
    .update(update)
    .eq(APPLICATION_COLUMNS.id, id);
  return { ok: !error, error };
}
