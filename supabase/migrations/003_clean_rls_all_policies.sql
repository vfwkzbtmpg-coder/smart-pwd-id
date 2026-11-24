-- ============================================================
-- Clean RLS Policy Reset — drop ALL policies on ALL protected
-- tables (profiles, pwd_applications, verification_transactions,
-- fsl_library) then recreate them cleanly using the recursion-
-- safe current_user_role() SECURITY DEFINER helper.
--
-- This migration is idempotent: you can re-run it safely.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. Ensure the recursion-safe role-lookup helper exists.
-- ----------------------------------------------------------------
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() limit 1;
$$;

grant execute on function public.current_user_role() to authenticated, anon;

-- ----------------------------------------------------------------
-- 2. Drop every policy that ever existed on these tables —
--    both the 001_initial_schema names and the 002_fix_rls_recursion
--    names — so we start from a blank slate.
-- ----------------------------------------------------------------

-- ---------- public.profiles ----------
drop policy if exists "Profiles — users view own"                   on public.profiles;
drop policy if exists "Profiles — users update own"                 on public.profiles;
drop policy if exists "Profiles — service role / verifiers read during verify" on public.profiles;
drop policy if exists "Profiles — select"                           on public.profiles;
drop policy if exists "Profiles — update"                           on public.profiles;
drop policy if exists "Profiles — insert"                           on public.profiles;

-- ---------- public.pwd_applications ----------
drop policy if exists "Applications — users view own"               on public.pwd_applications;
drop policy if exists "Applications — users create own"             on public.pwd_applications;
drop policy if exists "Applications — admins manage"                on public.pwd_applications;
drop policy if exists "Applications — view"                         on public.pwd_applications;
drop policy if exists "Applications — insert"                       on public.pwd_applications;
drop policy if exists "Applications — admin all"                    on public.pwd_applications;

-- ---------- public.verification_transactions ----------
drop policy if exists "Verifications — read own history or admin"   on public.verification_transactions;
drop policy if exists "Verifications — verifiers + admins insert"   on public.verification_transactions;
drop policy if exists "Verifications — view"                        on public.verification_transactions;
drop policy if exists "Verifications — insert"                      on public.verification_transactions;

-- ---------- public.fsl_library ----------
drop policy if exists "FSL library — read all authenticated"        on public.fsl_library;
drop policy if exists "FSL library — admin manage"                  on public.fsl_library;
drop policy if exists "FSL — select"                                on public.fsl_library;
drop policy if exists "FSL — admin all"                             on public.fsl_library;

-- ----------------------------------------------------------------
-- 3. Ensure RLS is actually ENABLED on every protected table.
-- ----------------------------------------------------------------
alter table public.profiles                     enable row level security;
alter table public.pwd_applications             enable row level security;
alter table public.verification_transactions    enable row level security;
alter table public.fsl_library                  enable row level security;

-- ----------------------------------------------------------------
-- 4. Recreate policies — CLEAN, non-recursive, easy to audit.
-- ----------------------------------------------------------------

-- ================================================================
-- TABLE: public.profiles
--   role breakdown:
--     pwd       → see/update ONLY their own row
--     verifier  → see ALL rows (needed to verify any PWD)
--     admin     → see/update ALL rows
--   insert: allowed iff inserted row's id === auth.uid()
--           (needed if the auth trigger is ever bypassed or
--            if the client tries to eagerly seed their own row)
-- ================================================================

create policy "profiles_select"
  on public.profiles for select
  using (
    auth.uid() = id
    or coalesce(current_user_role(), '') in ('verifier', 'admin')
  );

create policy "profiles_insert"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update"
  on public.profiles for update
  using (
    auth.uid() = id
    or coalesce(current_user_role(), '') = 'admin'
  );

-- ================================================================
-- TABLE: public.pwd_applications
--   pwd     → see/create their OWN application row
--   admin   → see/edit ALL applications end-to-end
--   (verifiers have no business reading this table)
-- ================================================================

create policy "pwd_applications_select"
  on public.pwd_applications for select
  using (
    auth.uid() = user_id
    or coalesce(current_user_role(), '') = 'admin'
  );

create policy "pwd_applications_insert"
  on public.pwd_applications for insert
  with check (
    auth.uid() = user_id
    or coalesce(current_user_role(), '') = 'admin'
  );

create policy "pwd_applications_update"
  on public.pwd_applications for update
  using (coalesce(current_user_role(), '') = 'admin')
  with check (coalesce(current_user_role(), '') = 'admin');

create policy "pwd_applications_delete"
  on public.pwd_applications for delete
  using (coalesce(current_user_role(), '') = 'admin');

-- ================================================================
-- TABLE: public.verification_transactions
--   pwd       → see rows where they ARE the PWD (their own history)
--   verifier  → see rows they created, and INSERT new ones
--   admin     → full read + insert + delete (audit)
-- ================================================================

create policy "verification_transactions_select"
  on public.verification_transactions for select
  using (
    auth.uid() = pwd_id
    or auth.uid() = verifier_id
    or coalesce(current_user_role(), '') = 'admin'
  );

create policy "verification_transactions_insert"
  on public.verification_transactions for insert
  with check (
    coalesce(current_user_role(), '') in ('verifier', 'admin')
  );

create policy "verification_transactions_delete"
  on public.verification_transactions for delete
  using (coalesce(current_user_role(), '') = 'admin');

-- ================================================================
-- TABLE: public.fsl_library
--   authenticated users → read the video bank
--   admin               → full CRUD to manage the library
-- ================================================================

create policy "fsl_library_select"
  on public.fsl_library for select
  using (auth.role() = 'authenticated');

create policy "fsl_library_insert"
  on public.fsl_library for insert
  with check (coalesce(current_user_role(), '') = 'admin');

create policy "fsl_library_update"
  on public.fsl_library for update
  using (coalesce(current_user_role(), '') = 'admin')
  with check (coalesce(current_user_role(), '') = 'admin');

create policy "fsl_library_delete"
  on public.fsl_library for delete
  using (coalesce(current_user_role(), '') = 'admin');

-- ----------------------------------------------------------------
-- 5. Quick sanity comment — nothing to run, just here so reviewers
--    can see what changed at a glance.
-- ----------------------------------------------------------------
-- Done:
--   • current_user_role() SECURITY DEFINER (bypasses RLS, no recursion)
--   • 16 policies dropped → 14 clean, auditable policies recreated
--   • fsl_library: added explicit insert/update/delete for admins
--   • pwd_applications: added explicit update/delete for admins
--   • verification_transactions: added delete for admins
--   • profiles: verifiers can read every row (required for QR/NFC verify)
