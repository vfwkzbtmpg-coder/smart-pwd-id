const express = require('express');
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// Some ISP networks drop Node's TLS 1.3 handshake to supabase.co — the socket
// is closed mid-handshake and every query stalls for ~50s before failing.
// Capping at TLS 1.2 (which those networks pass through untouched) keeps the
// database reachable.
tls.DEFAULT_MAX_VERSION = 'TLSv1.2';

const app = express();
const port = process.env.PORT || 3000;

// --- SUPABASE SERVER CLIENT (SERVICE ROLE — NEVER expose to browser) ---
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fvyinioymlegzfhrahbt.supabase.co';
// The service-role key bypasses every RLS policy, so it is read from the
// environment and never written into the source. Locally it comes from .env
// (loaded with `node --env-file=.env`); on a host it comes from the project's
// environment variables.
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'SUPABASE_SERVICE_ROLE_KEY is not set. Refusing to start: without it every ' +
    'database request would run as an anonymous user and fail.'
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

// Application submissions upload documents as base64 data URLs, which are far
// larger than the 100kb JSON default — raise the limit so photo uploads don't
// fail with HTTP 413.
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ----------------------------- HELPERS -----------------------------------
/**
 * Email addresses live in auth.users, NOT in public.profiles, so they cannot be
 * selected through the profiles join. The Auth admin API is the only way to
 * read them — this returns a { userId: email } map for the whole project.
 */
async function getAuthEmailMap() {
  const map = {};
  try {
    const perPage = 1000;
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page: page, perPage: perPage });
      if (error) throw error;
      const users = (data && data.users) || [];
      users.forEach(function (u) {
        if (u && u.id) map[u.id] = u.email || (u.user_metadata && u.user_metadata.email) || '';
      });
      if (users.length < perPage) break;
    }
  } catch (err) {
    console.warn('[auth] could not load user emails:', (err && err.message) ? err.message : err);
  }
  return map;
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: '2-digit',
  });
}

/**
 * A fresh secret for one holder's QR code and NFC tag. 128 bits of randomness:
 * an ID number alone is guessable, this is not.
 */
function newQrToken() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Whether profiles.qr_token exists yet. Probed once and remembered, because
 * every verification would otherwise pay for a failing query until migration
 * 012 is applied. When it is missing we fall back to the old behaviour —
 * verification by ID number alone — instead of refusing every card in the
 * field.
 */
let qrTokenColumnReady = null;
async function qrTokenSupported() {
  if (qrTokenColumnReady !== null) return qrTokenColumnReady;
  const { error } = await supabase.from('profiles').select('qr_token').limit(1);
  qrTokenColumnReady = !(error && /qr_token/i.test(error.message || ''));
  if (!qrTokenColumnReady) {
    console.warn('[qr] profiles.qr_token is missing — run 012_qr_token.sql to enable rotating QR codes.');
  }
  return qrTokenColumnReady;
}

/**
 * Detaches a physical tag from a holder. Both columns are cleared because the
 * kiosk writes nfc_uid (migration 010) while older deployments still carry
 * nfc_id; clearing only one leaves the card verifying on the other.
 */
async function clearNfcBinding(userId) {
  const both = await supabase
    .from('profiles')
    .update({ nfc_uid: null, nfc_id: null })
    .eq('id', userId);
  if (!both.error) return true;
  if (!/nfc_uid/i.test(both.error.message || '')) return false;
  // Pre-010 database: nfc_uid does not exist, so fall back to the legacy column.
  const legacy = await supabase
    .from('profiles')
    .update({ nfc_id: null })
    .eq('id', userId);
  return !legacy.error;
}

// ----------------------------- API ENDPOINTS -----------------------------

/**
 * POST /api/verify
 * Verifies a PWD ID using the id_number or profile UUID.
 * Body: { pwdId: string, method: 'QR'|'NFC'|'RFID'|'Manual', verifierId?: string }
 */
app.post('/api/verify', async (req, res) => {
  const { pwdId, method, verifierId } = req.body || {};
  const methodKey = String(method || 'Manual').trim().toUpperCase();

  if (!pwdId) {
    return res.status(400).json({
      ok: false,
      message: 'PWD ID is required for verification.',
    });
  }

  console.log(`[verify] Attempt for ID="${pwdId}" via ${method || 'unknown'}`);

  try {
    // Look up by id_number first (e.g. "2026-0000-4821") and fall back to UUID lookup
    const byUuid = /^[0-9a-fA-F-]{36}$/.test(String(pwdId));
    async function lookupProfile(includeMethodSettings) {
      let query = supabase
        .from('profiles')
        .select(includeMethodSettings
          ? 'id,first_name,last_name,id_number,application_status,role,valid_until,approved_at,qr_enabled,nfc_enabled'
          : 'id,first_name,last_name,id_number,application_status,role,valid_until,approved_at');
      query = byUuid ? query.eq('id', pwdId) : query.eq('id_number', pwdId);
      return query.limit(1);
    }

    let { data: profiles, error } = await lookupProfile(true);
    // Existing verification remains available while migration 011 is pending.
    if (error && /qr_enabled|nfc_enabled/i.test(error.message || '')) {
      ({ data: profiles, error } = await lookupProfile(false));
    }

    if (error) {
      console.error('[verify] Supabase error:', error.message);
      throw new Error('Database error during verification.');
    }

    const account = profiles && profiles[0];

    // The holder's secret is read in its own query so a database that has not
    // run migration 012 yet still verifies by ID number, exactly as before.
    let expectedToken = null;
    if (await qrTokenSupported()) {
      let tokenQuery = supabase.from('profiles').select('qr_token');
      tokenQuery = byUuid ? tokenQuery.eq('id', pwdId) : tokenQuery.eq('id_number', pwdId);
      const { data: tokenRows, error: tokenErr } = await tokenQuery.limit(1);
      if (tokenErr) console.warn('[verify] could not read qr_token:', tokenErr.message);
      expectedToken = (tokenRows && tokenRows[0] && tokenRows[0].qr_token) || null;
    }
    const suppliedToken = String((req.body && req.body.token) || '').trim();
    // A holder that has never been issued a token is not held to one, so cards
    // printed before migration 012 keep working until their next decision.
    const staleToken = !!(expectedToken && suppliedToken !== expectedToken);

    const expired = !!(account && account.valid_until
      && String(account.valid_until).slice(0, 10) < new Date().toISOString().slice(0, 10));
    const methodDisabled = !!(account && (
      (methodKey === 'QR' && account.qr_enabled === false)
      || (methodKey === 'NFC' && account.nfc_enabled === false)
    ));
    const isApproved =
      account &&
      account.application_status === 'Approved' &&
      account.role === 'pwd' &&
      !expired &&
      !methodDisabled &&
      !staleToken;
    const failureReason = isApproved
      ? null
      : !account
      ? 'ID not found'
      : account.role !== 'pwd'
      ? 'Not a PWD account'
      : account.application_status !== 'Approved'
      ? `Application status: ${account.application_status}`
      : expired
      ? 'ID expired'
      : methodDisabled
      ? `${methodKey} verification is disabled by the cardholder`
      : staleToken
      ? 'Code is out of date'
      : 'ID is not valid';

    // Log every verification attempt (success OR failure)
    try {
      await supabase.from('verification_transactions').insert({
        pwd_id: account ? account.id : '00000000-0000-0000-0000-000000000000',
        verifier_id: verifierId || null,
        method: ['QR', 'NFC', 'RFID', 'MANUAL'].includes(methodKey) ? (methodKey === 'MANUAL' ? 'Manual' : methodKey) : 'Manual',
        result: isApproved ? 'Success' : 'Failed',
        failure_reason: failureReason,
      });
    } catch (logErr) {
      console.warn('[verify] Could not log transaction:', logErr.message);
    }

    if (!isApproved) {
      return res.status(methodDisabled || staleToken ? 403 : 404).json({
        ok: false,
        message: staleToken
          ? 'This code is no longer valid. The PWD ID was reissued after this code was printed — ask the holder for their latest card.'
          : methodDisabled
          ? `${methodKey} verification is disabled by the cardholder.`
          : expired
          ? 'This PWD ID has expired.'
          : 'PWD ID not found, is not valid, or has not been approved yet.',
      });
    }

    // The printed card lives on pwd_applications (photo, LGU background,
    // signature, emergency details). profiles only holds the identity and the
    // issued ID number, so pull the newest application row for this holder.
    let card = null;
    try {
      const { data: apps, error: cardError } = await supabase
        .from('pwd_applications')
        .select('photo_url,signature_url,bg_front,birthdate,sex,blood_type,emergency_name,emergency_contact,address,disability_type,reviewed_at,submitted_at')
        .eq('user_id', account.id)
        .order('submitted_at', { ascending: false })
        .limit(1);
      if (cardError) throw cardError;

      const a = (apps && apps[0]) || {};
      // Rows written before migration 005 kept the birthdate inside
      // disability_type; a date-like value there IS the birthdate.
      const legacyDisabilityType = String(a.disability_type || '').trim();
      const legacyBirthdate = /^[0-9]{1,4}[/.-][0-9]{1,2}[/.-][0-9]{2,4}$/.test(legacyDisabilityType)
        ? legacyDisabilityType
        : '';

      card = {
        photoUrl: a.photo_url || '',
        signatureUrl: a.signature_url || '',
        bgFront: String(a.bg_front || '').toLowerCase(),
        birthdate: String(a.birthdate || '').trim() || legacyBirthdate,
        sex: a.sex || '',
        bloodType: a.blood_type || '',
        disabilityType: legacyBirthdate ? '' : legacyDisabilityType,
        emergencyName: a.emergency_name || '',
        emergencyContact: a.emergency_contact || '',
        address: a.address || '',
        dateIssued: a.reviewed_at || a.submitted_at || null,
      };
    } catch (cardErr) {
      // Verification is still valid without the artwork.
      console.warn('[verify] Could not load card details:', cardErr.message);
    }

    return res.status(200).json({
      ok: true,
      message: 'PWD ID is valid.',
      method: methodKey === 'MANUAL' ? 'Manual' : methodKey,
      account: {
        id: account.id,
        idNumber: account.id_number,
        firstName: account.first_name || '—',
        lastName: account.last_name || '—',
        validUntil: formatDate(account.valid_until),
        approvedAt: formatDate(account.approved_at),
      },
      card,
    });
  } catch (err) {
    console.error('[verify] Unhandled error:', err);
    return res.status(500).json({
      ok: false,
      message: err.message || 'Server error during verification.',
    });
  }
});

/**
 * GET /api/profiles/stats
 * Returns aggregate counts for the admin dashboard.
 */
app.get('/api/profiles/stats', async (_req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      { count: total },
      { count: approved },
      { count: pending },
      { count: pendingApplications },
      { count: verificationsToday },
      { count: verificationsLast30Days },
    ] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('application_status', 'Approved'),
      supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('application_status', 'Pending'),
      supabase
        .from('pwd_applications')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'Pending'),
      supabase
        .from('verification_transactions')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', todayStart.toISOString()),
      supabase
        .from('verification_transactions')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', monthAgo.toISOString()),
    ]);

    res.json({
      ok: true,
      total: total || 0,
      approved: approved || 0,
      pending: pending || 0,
      pendingApplications: pendingApplications || 0,
      verificationsToday: verificationsToday || 0,
      verificationsLast30Days: verificationsLast30Days || 0,
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/**
 * GET /api/verification-logs
 * Returns recent verifications for admin / verifier reports.
 * Query: ?limit=50
 */
app.get('/api/verification-logs', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  try {
    const { data, error } = await supabase
      .from('verification_transactions')
      .select(`
        id, method, result, failure_reason, establishment, location, created_at,
        pwd:profiles!verification_transactions_pwd_id_fkey(id_number,first_name,last_name),
        verifier:profiles!verification_transactions_verifier_id_fkey(first_name,last_name)
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    res.json({ ok: true, logs: data || [] });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/**
 * GET /api/establishments
 * Lists all establishment accounts (profiles where account_type = 'establishment').
 */
app.get('/api/establishments', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, mobile, account_type, role, id_number, application_status, approved_at, valid_until, created_at')
      .eq('account_type', 'establishment')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const flat = (data || []).map(function (row) {
      return {
        id: row.id,
        name: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || 'Unnamed Establishment',
        mobile: row.mobile || '',
        idNumber: row.id_number || '',
        role: row.role || 'verifier',
        status: row.application_status || 'Not Submitted',
        approvedAt: row.approved_at || null,
        validUntil: row.valid_until || null,
        createdAt: row.created_at || null,
      };
    });

    res.json({ ok: true, establishments: flat });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/**
 * GET /api/applications
 * Lists PWD applications (admin dashboard).
 * Query:
 *   ?status=Pending  (optional) filter by pwd_applications.status (exact match).
 *   ?user_id=xxx     (optional) single-user view (used by user dashboard to fetch own app row).
 */
app.get('/api/applications', async (req, res) => {
  try {
    const statusFilter = (typeof req.query.status === 'string' && req.query.status.trim())
      ? String(req.query.status).trim()
      : null;
    const userIdFilter = (typeof req.query.user_id === 'string' && req.query.user_id.trim())
      ? String(req.query.user_id).trim()
      : null;

    let q = supabase
      .from('pwd_applications')
      .select(`
        id, status, submitted_at, reviewed_at, reviewed_by, review_notes, disability_type, disability_id_no,
        birthdate, sex, blood_type, emergency_name, emergency_contact, address, signature_url, bg_front,
        id_front_url, id_back_url, photo_url, medical_cert_url, barangay_cert_url,
        user_id,
        user:profiles!pwd_applications_user_id_fkey(id_number,first_name,last_name,mobile,application_status,valid_until)
      `)
      .order('created_at', { ascending: false });

    if (statusFilter) q = q.eq('status', statusFilter);
    if (userIdFilter) q = q.eq('user_id', userIdFilter);

    const { data, error } = await q;
    if (error) throw error;

    const emailMap = await getAuthEmailMap();

    // Migration 005 moved the birthdate out of disability_type into its own
    // column, but rows written before that still hold a date in disability_type.
    // Detect those so the card never prints a date as the disability type.
    const DATE_LIKE = /^[0-9]{1,4}[/.-][0-9]{1,2}[/.-][0-9]{2,4}$/;

    const flat = (data || []).map(function (row) {
      const u = row.user || {};
      const legacyDisabilityType = String(row.disability_type || '').trim();
      const legacyBirthdate = DATE_LIKE.test(legacyDisabilityType) ? legacyDisabilityType : '';
      return {
        id: row.id,
        user_id: row.user_id,
        userName: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || 'Unnamed applicant',
        userEmail: emailMap[row.user_id] || '',
        userMobile: u.mobile || '',
        idNumber: u.id_number || '',
        applicationStatus: u.application_status || row.status || 'Not Submitted',
        status: row.status || 'Pending',
        submittedAt: row.submitted_at || null,
        reviewedAt: row.reviewed_at || null,
        reviewedBy: row.reviewed_by || null,
        reviewNotes: row.review_notes || '',
        birthdate: row.birthdate || legacyBirthdate,
        disabilityType: legacyBirthdate ? '' : legacyDisabilityType,
        sex: row.sex || '',
        bloodType: row.blood_type || '',
        emergencyName: row.emergency_name || '',
        emergencyContact: row.emergency_contact || '',
        address: row.address || '',
        signatureUrl: row.signature_url || '',
        bgFront: row.bg_front || '',
        disabilityIdNo: row.disability_id_no || '',
        validUntil: u.valid_until || null,
        idFrontUrl: row.id_front_url || '',
        idBackUrl: row.id_back_url || '',
        photoUrl: row.photo_url || '',
        medicalCertUrl: row.medical_cert_url || '',
        barangayCertUrl: row.barangay_cert_url || '',
      };
    });

    res.json({ ok: true, applications: flat });
  } catch (err) {
    res.status(500).json({ ok: false, message: (err && err.message) ? err.message : 'Failed to list applications.' });
  }
});

/**
 * PUT /api/applications/:id
 * Admin review action: Approve or Reject a PWD application.
 *
 * Body:
 *   { status: 'Approved' | 'Rejected' | 'Submitted' | 'Pending' | 'Under Review' | 'Needs Revision',
 *     reviewNotes?: string, reviewedBy?: string }
 *
 * Behavior:
 *   - Updates pwd_applications.status (+ reviewed_at)
 *   - On Approve: sets profiles.application_status = 'Approved', bumps valid_until to +5y
 *     if not already set, and writes a generated id_number when missing.
 *   - On Reject: sets profiles.application_status = 'Rejected' (keeps id_number untouched).
 */
app.put('/api/applications/:id', async (req, res) => {
  const appId = String(req.params.id || '').trim();
  const body = req.body || {};
  const nextStatus = String(body.status || '').trim();
  const reviewNotes = (typeof body.reviewNotes === 'string') ? body.reviewNotes : null;
  // reviewed_by is a uuid column: a non-uuid value (e.g. the role name "admin")
  // would fail the whole UPDATE with "invalid input syntax for type uuid", so
  // only pass it through when it really is a uuid.
  const reviewedByRaw = (typeof body.reviewedBy === 'string') ? body.reviewedBy.trim() : '';
  const reviewedBy = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reviewedByRaw)
    ? reviewedByRaw
    : null;
  // The Digital ID Card front background is an LGU slug, never a path — so a
  // stray "../" or a full URL can never end up in the column. Lowercase
  // kebab-case only, matching the filenames in public/backgrounds/. An empty
  // string means "clear it", which is different from "not sent".
  const bgFrontProvided = (typeof body.bgFront === 'string');
  const bgFrontRaw = bgFrontProvided ? body.bgFront.trim() : '';
  const bgFront = bgFrontRaw ? bgFrontRaw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : '';

  const validStatuses = ['Approved', 'Rejected', 'Submitted', 'Pending', 'Under Review', 'Needs Revision'];
  const hasStatus = !!nextStatus;
  if (!appId) return res.status(400).json({ ok: false, message: 'Application id is required.' });
  // A background-only save (admin picking a card background while the
  // application stays Pending) is allowed and must not touch the status.
  if (!hasStatus && !bgFrontProvided) {
    return res.status(400).json({ ok: false, message: 'Provide a status, a bgFront, or both.' });
  }
  if (hasStatus && !validStatuses.includes(nextStatus)) {
    return res.status(400).json({ ok: false, message: 'Invalid status. Must be one of: ' + validStatuses.join(', ') });
  }

  const now = new Date().toISOString();

  try {
    // 1. Load current application row (we need user_id + any existing disability info)
    const { data: current, error: curErr } = await supabase
      .from('pwd_applications')
      .select('id, user_id, status, disability_type, disability_id_no')
      .eq('id', appId)
      .limit(1)
      .maybeSingle();
    if (curErr) throw new Error('pwd_applications load: ' + curErr.message);
    if (!current) return res.status(404).json({ ok: false, message: 'Application not found.' });
    const userId = current.user_id;

    // 2. Update the pwd_applications row itself
    const appPatch = {
      updated_at: now,
    };
    if (bgFrontProvided) appPatch.bg_front = bgFront || null;
    if (hasStatus) {
      appPatch.status = nextStatus;
      if (nextStatus === 'Approved' || nextStatus === 'Rejected') {
        appPatch.reviewed_at = now;
        if (reviewedBy) appPatch.reviewed_by = reviewedBy;
      }
    }
    if (reviewNotes != null) appPatch.review_notes = reviewNotes;

    const { error: upErr } = await supabase
      .from('pwd_applications')
      .update(appPatch)
      .eq('id', appId);
    if (upErr) throw new Error('pwd_applications update: ' + upErr.message);

    // 3. Mirror status onto profiles so user-facing dashboard sees Approved/Verified badge
    if (userId && hasStatus) {
      const profilePatch = { updated_at: now };

      if (nextStatus === 'Approved') {
        profilePatch.application_status = 'Approved';
        // Generate id_number if missing (PWD format: YYYY-XXXX-XXXX)
        const { data: prof, error: profSelErr } = await supabase
          .from('profiles')
          .select('id_number, valid_until')
          .eq('id', userId)
          .limit(1)
          .maybeSingle();
        if (profSelErr) throw new Error('profiles load: ' + profSelErr.message);
        if (!prof || !prof.id_number) {
          profilePatch.id_number =
            '2026-' +
            String(Math.floor(Math.random() * 10000)).padStart(4, '0') + '-' +
            String(Math.floor(Math.random() * 10000)).padStart(4, '0');
        }
        if (!prof || !prof.valid_until) {
          profilePatch.valid_until = new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000).toISOString();
        }
      } else if (nextStatus === 'Rejected') {
        profilePatch.application_status = 'Rejected';
      } else if (nextStatus === 'Pending' || nextStatus === 'Under Review') {
        profilePatch.application_status = nextStatus;
      } else if (nextStatus === 'Needs Revision') {
        profilePatch.application_status = 'Needs Revision';
      } else if (nextStatus === 'Submitted') {
        // "Mark Submitted" clears a previous decision, so the holder goes back
        // to having no approved profile and no verifiable ID.
        profilePatch.application_status = 'Not Submitted';
      }

      // Every decision reissues the holder's code. An ID number is guessable and
      // a printed card can be photocopied, so the QR and the NFC tag are only
      // ever made to match the card issued by the most recent review.
      if ((nextStatus === 'Approved' || nextStatus === 'Rejected') && await qrTokenSupported()) {
        profilePatch.qr_token = newQrToken();
      }

      const { error: profUpErr } = await supabase
        .from('profiles')
        .update(profilePatch)
        .eq('id', userId);
      if (profUpErr) throw new Error('profiles update: ' + profUpErr.message);

      // A rejected holder must not still get through by tapping the old tag.
      if (nextStatus === 'Rejected') await clearNfcBinding(userId);
    }

    // 4. Return enriched application (same flat shape as GET)
    const { data: refreshed, error: refErr } = await supabase
      .from('pwd_applications')
      .select(`
        id, status, submitted_at, reviewed_at, reviewed_by, review_notes, disability_type, disability_id_no,
        birthdate, sex, blood_type, emergency_name, emergency_contact, address, signature_url, bg_front,
        user_id,
        user:profiles!pwd_applications_user_id_fkey(id_number,first_name,last_name,mobile,application_status,valid_until)
      `)
      .eq('id', appId)
      .limit(1)
      .maybeSingle();
    if (refErr) throw new Error('refetch: ' + refErr.message);
    const u = (refreshed && refreshed.user) || {};
    const emailMap = await getAuthEmailMap();
    const flat = {
      id: refreshed ? refreshed.id : appId,
      user_id: userId,
      userName: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || '',
      userEmail: emailMap[userId] || '',
      idNumber: u.id_number || '',
      applicationStatus: u.application_status || (refreshed ? refreshed.status : nextStatus),
      status: refreshed ? refreshed.status : nextStatus,
      submittedAt: (refreshed && refreshed.submitted_at) || null,
      reviewedAt: (refreshed && refreshed.reviewed_at) || now,
      validUntil: u.valid_until || null,
      birthdate: (refreshed && refreshed.birthdate) || '',
      disabilityType: (refreshed && refreshed.disability_type) || '',
      sex: (refreshed && refreshed.sex) || '',
      bloodType: (refreshed && refreshed.blood_type) || '',
      emergencyName: (refreshed && refreshed.emergency_name) || '',
      emergencyContact: (refreshed && refreshed.emergency_contact) || '',
      address: (refreshed && refreshed.address) || '',
      signatureUrl: (refreshed && refreshed.signature_url) || '',
      bgFront: (refreshed && refreshed.bg_front) || '',
    };

    return res.json({ ok: true, application: flat });
  } catch (err) {
    console.error('[PUT /api/applications/:id]', err);
    return res.status(500).json({
      ok: false,
      message: (err && err.message) ? err.message : 'Failed to update application.'
    });
  }
});

/**
 * POST /api/submit-application
 * Client-side (browser) proxy to submit a PWD application.
 *
 * Body:
 *   { userId: string, birthdate: string, contact: string, address: string, files?: object }
 *
 * Why a proxy?  The browser may not always reach Supabase REST directly
 * (e.g. offline dev, CORS, sandboxed browsers).  The server holds the
 * service-role client and writes through that instead.
 */
app.post('/api/submit-application', async (req, res) => {
  const { userId, birthdate, contact, address, status, country, files, fileNames } = req.body || {};
  const disabilityType = typeof req.body.disabilityType === 'string' ? req.body.disabilityType.trim() : '';
  const sex = typeof req.body.sex === 'string' ? req.body.sex.trim() : '';
  const bloodType = typeof req.body.bloodType === 'string' ? req.body.bloodType.trim() : '';
  const emergencyName = typeof req.body.emergencyName === 'string' ? req.body.emergencyName.trim() : '';
  const emergencyContact = typeof req.body.emergencyContact === 'string' ? req.body.emergencyContact.trim() : '';

  if (!userId) {
    return res.status(400).json({ ok: false, message: 'userId is required.' });
  }
  if (!birthdate || !contact || !address || !status || !country) {
    return res.status(400).json({
      ok: false,
      message: 'birthdate, contact, address, status, and country are all required.',
    });
  }

  const uid = String(userId);
  const now = new Date().toISOString();

  const fileData = files && typeof files === 'object' ? files : {};
  const nameData = fileNames && typeof fileNames === 'object' ? fileNames : {};

  const medicalCertUrl = fileData['medical-cert'] || '';
  const idFrontUrl = fileData['valid-id'] || '';
  const idBackUrl = fileData['old-id'] || '';
  const barangayCertUrl = fileData['affidavit'] || '';
  const photoUrl = fileData['picture'] || '';
  const signatureUrl = fileData['signature'] || '';

  const fileSummary = Object.keys(nameData).map(k => k + ': ' + nameData[k]).join(', ');

  const reviewNotes =
    'Address: ' + address +
    ' | Contact: ' + contact +
    ' | Status: ' + String(status) +
    ' | Country: ' + String(country) +
    (fileSummary ? ' | Files: ' + fileSummary : '') +
    (signatureUrl ? ' | Signature: uploaded' : '');

  try {
    // --------------------------------------------------------------
    // 0. ENSURE the profile row exists BEFORE writing pwd_applications.
    //    If the user signed up via a path that bypassed the trigger or
    //    the trigger hasn't materialised yet, seed it here to avoid
    //    pwd_applications_user_id_fkey foreign key violations.
    // --------------------------------------------------------------
    {
      const { data: existingProfile, error: profSelErr } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', uid)
        .limit(1);
      if (profSelErr) throw new Error('profiles check: ' + profSelErr.message);

      if (!existingProfile || !existingProfile.length) {
        const { data: authMd, error: authErr } = await supabase.auth.admin.getUserById(uid);
        const authUser = authMd && authMd.user ? authMd.user : null;
        const md = authUser && authUser.user_metadata ? authUser.user_metadata : {};
        const accountType = (md && md.account_type) ? String(md.account_type) : 'pwd';
        const role = accountType === 'establishment' ? 'verifier' : (accountType === 'admin' ? 'admin' : 'pwd');
        const idNumber = role === 'verifier'
          ? 'EST-' + String(Math.floor(Math.random() * 10000)).padStart(4, '0')
          : '2026-' + String(Math.floor(Math.random() * 10000)).padStart(4, '0') + '-' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
        const validUntil = role === 'pwd' ? new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000).toISOString() : null;

        const { error: insErr } = await supabase.from('profiles').insert({
          id: uid,
          first_name: (md && md.first_name) ? String(md.first_name) : (md && md.firstName ? String(md.firstName) : ''),
          last_name: (md && md.last_name) ? String(md.last_name) : (md && md.lastName ? String(md.lastName) : ''),
          mobile: (md && md.mobile) ? String(md.mobile) : (md && md.phone ? String(md.phone) : String(contact)),
          account_type: accountType,
          role: role,
          id_number: idNumber,
          application_status: role === 'verifier' ? 'Approved' : 'Not Submitted',
          valid_until: validUntil,
        });
        if (insErr) throw new Error('profiles insert: ' + insErr.message);
      }
    }

    // 1. Mark the profile as Pending (and keep mobile up-to-date)
    const { error: profileErr } = await supabase
      .from('profiles')
      .update({
        mobile: String(contact),
        application_status: 'Pending',
        updated_at: now,
      })
      .eq('id', uid);
    if (profileErr) throw new Error('profiles update: ' + profileErr.message);

    // 2. Update existing application OR insert a new one
    const { data: existing, error: selErr } = await supabase
      .from('pwd_applications')
      .select('id')
      .eq('user_id', uid)
      .limit(1);
    if (selErr) throw new Error('pwd_applications select: ' + selErr.message);

    if (existing && existing.length) {
      const { error: upErr } = await supabase
        .from('pwd_applications')
        .update({
          status: 'Pending',
          submitted_at: now,
          birthdate: String(birthdate),
          disability_type: disabilityType || null,
          sex: sex || null,
          blood_type: bloodType || null,
          emergency_name: emergencyName || null,
          emergency_contact: emergencyContact || null,
          address: String(address),
          signature_url: signatureUrl,
          disability_id_no: String(country) + ' / ' + String(status),
          review_notes: reviewNotes,
          photo_url: photoUrl,
          id_front_url: idFrontUrl,
          id_back_url: idBackUrl,
          medical_cert_url: medicalCertUrl,
          barangay_cert_url: barangayCertUrl,
          updated_at: now,
        })
        .eq('id', existing[0].id);
      if (upErr) throw new Error('pwd_applications update: ' + upErr.message);
    } else {
      const { error: insErr } = await supabase
        .from('pwd_applications')
        .insert({
          user_id: uid,
          status: 'Pending',
          submitted_at: now,
          birthdate: String(birthdate),
          disability_type: disabilityType || null,
          sex: sex || null,
          blood_type: bloodType || null,
          emergency_name: emergencyName || null,
          emergency_contact: emergencyContact || null,
          address: String(address),
          signature_url: signatureUrl,
          disability_id_no: String(country) + ' / ' + String(status),
          review_notes: reviewNotes,
          photo_url: photoUrl,
          id_front_url: idFrontUrl,
          id_back_url: idBackUrl,
          medical_cert_url: medicalCertUrl,
          barangay_cert_url: barangayCertUrl,
        });
      if (insErr) throw new Error('pwd_applications insert: ' + insErr.message);
    }

    return res.json({ ok: true, submittedAt: now });
  } catch (err) {
    console.error('[submit-application]', err);
    return res.status(500).json({
      ok: false,
      message: (err && err.message) ? err.message : 'Failed to submit application.',
    });
  }
});

// ----------------------------- MESSAGES ----------------------------------
/**
 * A cardholder gets one private line to the PWD office. This is deliberately
 * NOT a social feature: there is no friends list, no friend requests and no
 * user-to-user chat. Every row belongs to a single applicant and is authored
 * either by that applicant ('pwd') or by the office ('admin').
 *
 * Both routes resolve the caller from their Supabase access token rather than
 * trusting the request body, so an applicant can never read or post into
 * somebody else's thread and can never sign a message as the admin.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveCaller(req) {
  const header = String(req.headers.authorization || '');
  const token = /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '').trim() : '';
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data || !data.user) return null;

  const uid = data.user.id;
  const { data: prof } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', uid)
    .limit(1)
    .maybeSingle();

  return { uid: uid, role: (prof && prof.role) ? prof.role : 'pwd' };
}

/**
 * Cardholders manage only their own verification preferences and NFC link.
 * All writes use the verified Supabase access token to resolve the profile id.
 */
app.get('/api/pwd/verification-settings', async (req, res) => {
  try {
    const caller = await resolveCaller(req);
    if (!caller) return res.status(401).json({ ok: false, message: 'Please log in again.' });

    const { data, error } = await supabase
      .from('profiles')
      .select('qr_enabled,nfc_enabled,nfc_id')
      .eq('id', caller.uid)
      .maybeSingle();
    if (error && /qr_enabled|nfc_enabled/i.test(error.message || '')) {
      const { data: legacy, error: legacyError } = await supabase
        .from('profiles')
        .select('nfc_id')
        .eq('id', caller.uid)
        .maybeSingle();
      if (legacyError) throw legacyError;
      if (!legacy) return res.status(404).json({ ok: false, message: 'Your profile could not be found.' });
      return res.json({
        ok: true,
        qrEnabled: true,
        nfcEnabled: true,
        nfcLinked: !!legacy.nfc_id,
        settingsAvailable: false,
      });
    }
    if (error) throw error;
    if (!data) return res.status(404).json({ ok: false, message: 'Your profile could not be found.' });

    res.json({
      ok: true,
      qrEnabled: data.qr_enabled !== false,
      nfcEnabled: data.nfc_enabled !== false,
      nfcLinked: !!data.nfc_id,
      settingsAvailable: true,
    });
  } catch (err) {
    const message = (err && err.message) || '';
    const needsMigration = /qr_enabled|nfc_enabled/i.test(message);
    res.status(500).json({
      ok: false,
      message: needsMigration
        ? 'Verification settings need database migration 011_verification_method_settings.sql.'
        : 'Could not load verification settings.',
    });
  }
});

app.put('/api/pwd/verification-settings', async (req, res) => {
  try {
    const caller = await resolveCaller(req);
    if (!caller) return res.status(401).json({ ok: false, message: 'Please log in again.' });

    const patch = {};
    const body = req.body || {};
    if (typeof body.qrEnabled === 'boolean') patch.qr_enabled = body.qrEnabled;
    if (typeof body.nfcEnabled === 'boolean') patch.nfc_enabled = body.nfcEnabled;
    if (!Object.keys(patch).length) {
      return res.status(400).json({ ok: false, message: 'Choose a QR or NFC setting to update.' });
    }

    const { data, error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', caller.uid)
      .select('qr_enabled,nfc_enabled,nfc_id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ ok: false, message: 'Your profile could not be found.' });

    res.json({
      ok: true,
      qrEnabled: data.qr_enabled !== false,
      nfcEnabled: data.nfc_enabled !== false,
      nfcLinked: !!data.nfc_id,
    });
  } catch (err) {
    const message = (err && err.message) || '';
    const needsMigration = /qr_enabled|nfc_enabled/i.test(message);
    res.status(500).json({
      ok: false,
      message: needsMigration
        ? 'Verification settings need database migration 011_verification_method_settings.sql.'
        : 'Could not save verification settings.',
    });
  }
});

app.delete('/api/pwd/nfc-card', async (req, res) => {
  try {
    const caller = await resolveCaller(req);
    if (!caller) return res.status(401).json({ ok: false, message: 'Please log in again.' });

    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', caller.uid)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ ok: false, message: 'Your profile could not be found.' });

    const cleared = await clearNfcBinding(caller.uid);
    if (!cleared) throw new Error('nfc unlink failed');

    res.json({ ok: true, nfcLinked: false, message: 'The lost NFC card has been unlinked.' });
  } catch (_) {
    res.status(500).json({ ok: false, message: 'Could not unlink the NFC card. Please try again.' });
  }
});

/**
 * DELETE /api/profiles/:userId/nfc-card
 *
 * The same "my card is lost" action, but run by an administrator from the
 * console. Holders who have lost a card usually cannot reach their own
 * account to do it themselves, so the counter needs a way to detach the tag
 * without waiting for the holder to log in.
 */
app.delete('/api/profiles/:userId/nfc-card', async (req, res) => {
  try {
    const caller = await resolveCaller(req);
    if (!caller) return res.status(401).json({ ok: false, message: 'Please log in again.' });
    if (caller.role !== 'admin') {
      return res.status(403).json({ ok: false, message: 'Only an administrator can unlink a cardholder\u2019s NFC card.' });
    }

    const userId = String(req.params.userId || '').trim();
    if (!UUID_RE.test(userId)) {
      return res.status(400).json({ ok: false, message: 'A valid cardholder id is required.' });
    }

    const cleared = await clearNfcBinding(userId);
    if (!cleared) throw new Error('nfc unlink failed');

    res.json({ ok: true, nfcLinked: false, message: 'The lost NFC card has been unlinked.' });
  } catch (_) {
    res.status(500).json({ ok: false, message: 'Could not unlink the NFC card. Please try again.' });
  }
});

function flatMessage(row) {
  return {
    id: row.id,
    userId: row.user_id,
    senderRole: row.sender_role || 'pwd',
    body: row.body || '',
    createdAt: row.created_at || null,
  };
}

/**
 * GET /api/messages
 * An applicant receives their own thread; an admin passes ?user_id=<uuid>
 * to open a specific applicant's thread.
 */
app.get('/api/messages', async (req, res) => {
  try {
    const caller = await resolveCaller(req);
    if (!caller) {
      return res.status(401).json({ ok: false, message: 'Please log in again.' });
    }

    const isAdmin = caller.role === 'admin';
    const requested = (typeof req.query.user_id === 'string') ? req.query.user_id.trim() : '';
    const userId = isAdmin ? (requested || caller.uid) : caller.uid;

    if (!UUID_RE.test(userId)) {
      return res.status(400).json({ ok: false, message: 'A valid applicant id is required.' });
    }

    const { data, error } = await supabase
      .from('messages')
      .select('id, user_id, sender_role, body, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(500);

    if (error) throw error;

    res.json({ ok: true, messages: (data || []).map(flatMessage) });
  } catch (err) {
    res.status(500).json({ ok: false, message: (err && err.message) ? err.message : 'Failed to load messages.' });
  }
});

/**
 * POST /api/messages
 * Body: { body: string, userId?: uuid }
 * The sender role is taken from the verified token, never from the body —
 * the above query is the only place a caller chooses a thread.
 */
app.post('/api/messages', async (req, res) => {
  try {
    const caller = await resolveCaller(req);
    if (!caller) {
      return res.status(401).json({ ok: false, message: 'Please log in again.' });
    }

    const text = (typeof req.body.body === 'string') ? req.body.body.trim() : '';
    if (!text) {
      return res.status(400).json({ ok: false, message: 'Write a message first.' });
    }

    const isAdmin = caller.role === 'admin';
    const requested = (typeof req.body.userId === 'string') ? req.body.userId.trim() : '';
    const userId = isAdmin ? (requested || caller.uid) : caller.uid;

    if (!UUID_RE.test(userId)) {
      return res.status(400).json({ ok: false, message: 'A valid applicant id is required.' });
    }

    const { data, error } = await supabase
      .from('messages')
      .insert({
        user_id: userId,
        sender_role: isAdmin ? 'admin' : 'pwd',
        body: text.slice(0, 4000),
      })
      .select('id, user_id, sender_role, body, created_at')
      .single();

    if (error) throw error;

    res.json({ ok: true, message: flatMessage(data) });
  } catch (err) {
    res.status(500).json({ ok: false, message: (err && err.message) ? err.message : 'Failed to send message.' });
  }
});

/**
 * Health check
 */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'Smart PWD ID API', uptime: process.uptime() });
});

// --------------------------- NFC READER (KIOSK) ---------------------------
/**
 * The USB reader is driven by the local kiosk service
 * (public/nfc/NFC VERIFY/server.py, default http://127.0.0.1:8000). The admin
 * page is served from this origin, so it cannot call the kiosk directly: a JSON
 * POST is preflighted and the kiosk answers without CORS headers. These routes
 * forward the two calls the "Reader NFC Scan" button needs.
 *
 * Arming the reader with { personId } binds the next tapped card's UID to that
 * profile's nfc_id — the same flow as the kiosk's own Registry tab.
 */
const NFC_KIOSK_URL = (process.env.NFC_KIOSK_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const KIOSK_OFFLINE = {
  ok: false,
  message: 'The NFC reader service is not running. Start it with "python server.py" '
    + 'in public/nfc/NFC VERIFY, then keep the ESP32 plugged in.',
};

async function callKiosk(pathname, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(NFC_KIOSK_URL + pathname, Object.assign({}, init, { signal: controller.signal }));
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { ok: response.ok, offline: false, json };
  } catch (_) {
    // Refused or timed out: the kiosk is simply not running.
    return { ok: false, offline: true, json: null };
  } finally {
    clearTimeout(timer);
  }
}

app.post('/api/nfc/enroll', async (req, res) => {
  const userId = (req.body && typeof req.body.userId === 'string') ? req.body.userId.trim() : '';
  if (!UUID_RE.test(userId)) {
    return res.status(400).json({ ok: false, message: 'A valid PWD ID holder is required.' });
  }
  const out = await callKiosk('/api/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ personId: userId }),
  });
  if (out.offline) return res.status(503).json(KIOSK_OFFLINE);
  if (!out.ok) {
    return res.status(502).json({ ok: false, message: (out.json && out.json.error) || 'The reader refused the request.' });
  }
  res.json({ ok: true, name: (out.json && out.json.name) || '' });
});

app.post('/api/nfc/enroll/cancel', async (_req, res) => {
  const out = await callKiosk('/api/enroll/cancel', { method: 'POST' });
  if (out.offline) return res.status(503).json(KIOSK_OFFLINE);
  res.json({ ok: true });
});

app.get('/api/nfc/state', async (_req, res) => {
  const out = await callKiosk('/api/state');
  if (out.offline) return res.status(503).json(KIOSK_OFFLINE);
  const s = out.json || {};
  res.json({
    ok: true,
    serial: s.serial || { connected: false, message: 'Unknown' },
    enrolling: !!s.enrolling,
    enrollName: s.enrollName || '',
    last: s.last || null,
  });
});

// ----------------------------- STATIC SITE -------------------------------
const staticPath = path.join(__dirname, '..', 'public');
app.use(express.static(staticPath, {
  setHeaders: function (res, filePath) {
    // Pages and their styles/scripts are edited constantly during
    // development; never let the browser serve a stale copy after a change.
    if (/\.(html|css|js)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-store, must-revalidate');
  },
}));
console.log(`[static] serving files from ${staticPath}`);

// ------------------------- FSL VIDEO LIBRARY -----------------------------
// FSL translation clips live in public/fsl-videos/. A clip's file name is the
// sentence it translates, e.g. "Your ID has been verified successfully.mp4",
// so dropping a file in is all that is needed to make the overlay play it.
// Sentence matching in js/app.js ignores case, spacing and punctuation.
// A file whose name starts with "_" is the fallback clip: it plays for every
// sentence that has no clip of its own.
const FSL_VIDEO_DIR = path.join(staticPath, 'fsl-videos');
const FSL_VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i;

app.get('/api/fsl-videos', async (_req, res) => {
  let names = [];
  try {
    names = await fs.promises.readdir(FSL_VIDEO_DIR);
  } catch (_) {
    // Folder has not been created yet: report an empty library.
    return res.json({ ok: true, videos: [] });
  }
  const videos = names
    .filter(function (name) { return FSL_VIDEO_EXT.test(name); })
    .map(function (name) {
      const raw = name.replace(FSL_VIDEO_EXT, '').trim();
      const isDefault = raw.charAt(0) === '_';
      const label = isDefault ? raw.slice(1).trim() : raw;
      return {
        sentence: label.replace(/_+/g, ' ').trim(),
        video_url: '/fsl-videos/' + encodeURIComponent(name),
        is_default: isDefault,
      };
    });
  res.json({ ok: true, videos: videos });
});

// ----------------------------- ERROR HANDLER -----------------------------
// Registered last so it also catches errors thrown by the routes above.
// Body-parser errors (413 payload too large, malformed JSON) would otherwise
// render an HTML error page, so the browser's res.json() fails and the user
// only sees a bare "HTTP 413". Reply with JSON instead.
app.use(function (err, req, res, next) {
  if (!err) return next();
  const status = err.status || err.statusCode || 500;
  if (status === 413) {
    return res.status(413).json({
      ok: false,
      message: 'Your uploaded files are too large. Please choose smaller images and try again.',
    });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, message: 'Invalid request body.' });
  }
  console.error('[server] unhandled error:', err);
  res.status(status).json({ ok: false, message: err.message || 'Internal server error.' });
});

// Listening only makes sense when this file is the entry point. On a
// serverless host the app is imported and invoked per request instead, and
// binding a port there would keep the function from ever returning.
if (require.main === module) {
  app.listen(port, () => {
    console.log(`\n============================================`);
    console.log(` Smart PWD ID server running`);
    console.log(` Local:   http://localhost:${port}`);
    console.log(` API:     http://localhost:${port}/api/health`);
    console.log(` Verify:  POST http://localhost:${port}/api/verify`);
    console.log(`============================================\n`);
  });
}

module.exports = app;
