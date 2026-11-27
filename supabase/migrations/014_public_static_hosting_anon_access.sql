-- ============================================================
-- 014  Anonymous access for the static-hosted site
--
-- !! READ THIS BEFORE RUNNING !!
--
-- The site is now served as plain files from a static host, so there is no
-- server to hold the service-role key. QR verification therefore runs in the
-- visitor's browser with the PUBLISHABLE key — which is embedded in the page
-- source and can be read by anyone.
--
-- These three policies grant what verification needs to any visitor, whether
-- they are signed in or not.
-- What that means in practice, stated plainly:
--
--   * profiles_select_anon makes EVERY PWD record world-readable. Anyone who
--     views the page source can download the whole profiles table: names,
--     addresses, birthdates, disability details, photos, ID numbers.
--   * vt_insert_anon lets any visitor write rows into
--     verification_transactions, so the audit trail can be fabricated or
--     flooded by anyone. It is no longer evidence of anything.
--   * applications_select_anon exposes every applicant's uploaded documents,
--     including the ID photos and medical certificates held as data URLs.
--
-- This is a deliberate trade-off, confirmed by the project owner rather than a
-- default. Before this site carries real cardholder data in public, replace
-- these policies with a SECURITY DEFINER function (and a narrow view for the
-- verification read) that achieves the same result without exposing the tables.
-- Only one SQL paste is needed either way.
--
-- The three policies below apply to anon AND authenticated, not to anon alone.
-- Policies are additive: a request that carries a signed-in user's token runs
-- as authenticated and would otherwise ignore these and fall back to the much
-- narrower rules in 003 — a signed-in establishment would then see a card with
-- every printed field blank, a signed-in holder scanning someone else's card
-- would get a false "not found", and their audit row would be silently refused.
--
-- Reversal: drop the three policies at the bottom of this file and the
-- widened access is gone again immediately. No table or column is touched by
-- this migration.
--
-- Idempotent — safe to run more than once.
-- ============================================================

alter table public.profiles                  enable row level security;
alter table public.pwd_applications          enable row level security;
alter table public.verification_transactions enable row level security;

-- ----------------------------------------------------------------
-- 1. Verification reads a holder's card.
--    The QR scanner on verify.html is used by establishments and members of
--    the public, some signed in and some not, so the lookup has to work for
--    both roles. The columns read are first_name, last_name, id_number,
--    application_status, role, valid_until, approved_at, qr_enabled,
--    nfc_enabled and qr_token.
-- ----------------------------------------------------------------
drop policy if exists "profiles_select_anon" on public.profiles;
create policy "profiles_select_anon"
  on public.profiles for select
  to anon, authenticated
  using (true);

-- ----------------------------------------------------------------
-- 2. Verification writes its audit row.
--    Every scan — success or failure — is recorded, which requires both roles
--    to be able to insert. The shape of the row is chosen by the browser, so
--    it carries no more authority than the visitor who wrote it.
-- ----------------------------------------------------------------
drop policy if exists "verification_transactions_insert_anon" on public.verification_transactions;
create policy "verification_transactions_insert_anon"
  on public.verification_transactions for insert
  to anon, authenticated
  with check (true);

-- ----------------------------------------------------------------
-- 3. Verification reads the issued card artwork.
--    pwd_applications holds the photo, signature, LGU background and emergency
--    details that are printed on the Digital ID Card shown after a successful
--    scan.
-- ----------------------------------------------------------------
drop policy if exists "pwd_applications_select_anon" on public.pwd_applications;
create policy "pwd_applications_select_anon"
  on public.pwd_applications for select
  to anon, authenticated
  using (true);

-- ----------------------------------------------------------------
-- Done. The remaining endpoints — messages, verification settings, NFC card
-- removal, the admin application review and the public application form — all
-- run as the signed-in user and keep the policies from 003/008 unchanged.
-- ----------------------------------------------------------------
