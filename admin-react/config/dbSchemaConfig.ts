/**
 * ============================================================
 *   SMART PWD ID ADMIN REACT — DATABASE SCHEMA MAPPING CONFIG
 * ============================================================
 *
 * PURPOSE: Maps the "friendly" column names the React admin UI
 * expects to the ACTUAL column names present in your Supabase
 * tables. Edit this single file if your DB columns differ.
 *
 * Rationale: We discovered the real schema via live Supabase
 * queries (see README / RLS migration file). The tables are:
 *    - public.pwd_applications  (the application row)
 *    - public.profiles          (PII/identifiers, joined on user_id)
 *    - auth.users               (email, via Supabase Auth only)
 *
 * NOTES / LEGEND:
 *   ! = Different name in the real DB than the requirement spec.
 *   * = Field is not on pwd_applications at all, it's on
 *       profiles or must be looked up via auth.users admin API.
 *   PLACEHOLDER = if a column is totally missing, set a string
 *       placeholder and handle nulls gracefully in the UI.
 *
 * NO DB PASSWORDS / SERVICE_ROLE / JWT SECRETS IN THIS FILE.
 */

/** Public (anon) Supabase client only — service key lives on the server. */
export const APP_TABLE_NAMES = {
  /**
   * The canonical applications table (your requirement spec names it
   * "applications"). The live DB is `pwd_applications`.
   */
  applications: 'pwd_applications' as const,
  /** User / applicant profile table (joined by applications.user_id) */
  profiles: 'profiles' as const,
  /** Verification transactions table (optional / nullable) */
  verification_transactions: 'verification_transactions' as const,
} as const;

/** Admin role expected in public.profiles.role (configurable by .env) */
export const ADMIN_ROLE_NAME: string =
  (import.meta.env.VITE_ADMIN_ROLE_NAME as string | undefined) || 'admin';

/** Verifier role expected in public.profiles.role (read-only in this UI) */
export const VERIFIER_ROLE_NAME = 'verifier';

/**
 * Column-name mapping:   UI_NAME  →   actual_db_column
 * Edit this if your Supabase table schema has different column names.
 *
 * If a mapping for a real DB column is empty string / PLACEHOLDER_MISSING
 * the React UI will render the cell as "—" and skip it in updates.
 */
export const PLACEHOLDER_MISSING = '__MISSING_SCHEMA_COLUMN__';

export const APPLICATION_COLUMNS = {
  /* =========== primary keys =========== */
  id: 'id',
  user_id: 'user_id',

  /* =========== application status / audit =========== */
  // ! In spec: verification_status  ;  actual DB column: status
  verification_status: 'status',
  submitted_at: 'submitted_at',
  reviewed_at: 'reviewed_at',
  reviewed_by: 'reviewed_by',

  // ! In spec: admin_notes  ;  actual DB column: review_notes
  admin_notes: 'review_notes',

  created_at: 'created_at',
  updated_at: 'updated_at',

  /* =========== PWD / disability fields  (on pwd_applications table) =========== */
  // * Note: the live DB currently puts birthdate strings (e.g. "15/06/1990")
  //   into disability_type and country/citizenship strings into
  //   disability_id_no, so the UI labels are flexible.
  disability_type: 'disability_type',
  disability_id_no: 'disability_id_no',

  /* =========== uploaded documents  (all nullable)  =========== */
  id_front_url: 'id_front_url',
  id_back_url: 'id_back_url',
  photo_url: 'photo_url',
  medical_cert_url: 'medical_cert_url',
  barangay_cert_url: 'barangay_cert_url',

  /* =========== Digital ID Card fields (printed on the card) =========== */
  birthdate: 'birthdate',
  sex: 'sex',
  blood_type: 'blood_type',
  emergency_name: 'emergency_name',
  emergency_contact: 'emergency_contact',
  address: 'address',
  signature_url: 'signature_url',
  bg_front: 'bg_front',

  /* ====== fields from spec that ARE NOT on pwd_applications, they live on `profiles` ====== */
  // We join pwd_applications.user_id = profiles.id and read from there.
  // The mapping below is the column in `profiles`:
} as const;

/** Columns pulled from `profiles` for each application row (joined on user_id). */
export const PROFILE_COLUMNS = {
  id: 'id',
  first_name: 'first_name',
  middle_name: 'middle_name',
  last_name: 'last_name',
  full_name: 'full_name',
  mobile: 'mobile',
  contact_number: 'contact_number',
  pwd_id_number: 'pwd_id_number',
  id_number: 'id_number',
  expiration_date: 'expiration_date',
  valid_until: 'valid_until',
  address_house_no: 'address_house_no',
  address_street: 'address_street',
  address_barangay: 'address_barangay',
  address_city: 'address_city',
  address_province: 'address_province',
  address_postal_code: 'address_postal_code',
  birthdate: 'birthdate',
  role: 'role',
  account_type: 'account_type',
  application_status: 'application_status',
  created_at: 'created_at',
  updated_at: 'updated_at',
} as const;

/**
 * STATUS ENUM NORMALIZATION
 * =========================
 * Spec states the UI should show 5 statuses: submitted | under_review |
 * approved | rejected | needs_revision.
 *
 * The real DB currently uses "Pending" as the only stored value.
 * To keep both spec-compliant UI and backwards compatibility we map
 * DB values → UI values here (and the inverse when saving via the admin
 * status buttons).
 */

export const APPLICATION_STATUS_UI_VALUES = [
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'needs_revision',
] as const;

export type ApplicationStatusUi =
  (typeof APPLICATION_STATUS_UI_VALUES)[number];

/**
 * Map whatever status string is stored in DB → the canonical UI enum.
 * Add entries here if your DB stores legacy different values (case-insensitive).
 */
export function dbStatusToUi(raw: string | null | undefined): ApplicationStatusUi {
  if (!raw) return 'submitted';
  switch (String(raw).trim().toUpperCase()) {
    case 'SUBMITTED':
    case 'NEW':
      return 'submitted';
    case 'PENDING':
    case 'UNDER_REVIEW':
    case 'UNDER REVIEW':
    case 'IN_REVIEW':
      return 'under_review';
    case 'APPROVED':
    case 'APPROVE':
      return 'approved';
    case 'REJECTED':
    case 'DENIED':
    case 'DECLINED':
      return 'rejected';
    case 'NEEDS_REVISION':
    case 'REVISION':
    case 'FOR_REVISION':
    case 'REVISE':
      return 'needs_revision';
    default:
      return 'under_review'; // safest default for a Pending/new application
  }
}

/**
 * Map canonical UI enum → DB string.
 * If your DB uses different stored values, edit this mapping.
 */
export function uiStatusToDb(status: ApplicationStatusUi): string {
  switch (status) {
    case 'submitted':
      return 'Submitted';
    case 'under_review':
      return 'Under Review';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'needs_revision':
      return 'Needs Revision';
  }
}

/** Pretty labels shown in badges / filter dropdowns. */
export const STATUS_UI_META: Record<
  ApplicationStatusUi,
  { label: string; chip: string }
> = {
  submitted:      { label: 'Submitted',      chip: 'bg-slate-100 text-slate-700 ring-1 ring-slate-300' },
  under_review:   { label: 'Under review',   chip: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  approved:       { label: 'Approved',       chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  rejected:       { label: 'Rejected',       chip: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' },
  needs_revision: { label: 'Needs revision', chip: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
};
