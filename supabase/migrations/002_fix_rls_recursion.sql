-- ============================================================
-- Fix: RLS policies on profiles caused infinite recursion because
-- they SELECT from profiles inside the policy for the same table.
-- Solution: use auth.jwt() claims + a separate SECURITY DEFINER
-- helper function to check role without re-entering RLS.
-- ============================================================

-- Drop recursive policies first
drop policy if exists "Profiles — users view own" on public.profiles;
drop policy if exists "Profiles — users update own" on public.profiles;
drop policy if exists "Profiles — service role / verifiers read during verify" on public.profiles;

-- Helper (security definer, bypasses RLS) to look up a user's role
-- safely from inside RLS policies without recursion.
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

-- ----- Profiles: SELECT -----
-- Users see their own row; admins see every row;
-- verifiers see every row (to look up PWDs during verification).
create policy "Profiles — select"
  on public.profiles for select
  using (
    auth.uid() = id
    or coalesce(current_user_role(), '') in ('admin', 'verifier')
  );

-- ----- Profiles: UPDATE -----
-- Users can update only their own row.
create policy "Profiles — update"
  on public.profiles for update
  using (auth.uid() = id);

-- ----- Profiles: INSERT -----
-- Service role / trigger only; allow auth-uid matching insert.
create policy "Profiles — insert"
  on public.profiles for insert
  with check (auth.uid() = id);

-- ====================================================================
-- Also fix similar recursion risk in pwd_applications policy.
-- It used a subquery on profiles — safe because profiles RLS will
-- short-circuit via auth.uid() check, but let's use the helper
-- for consistency and reliability.
-- ====================================================================

drop policy if exists "Applications — users view own" on public.pwd_applications;
drop policy if exists "Applications — users create own" on public.pwd_applications;
drop policy if exists "Applications — admins manage" on public.pwd_applications;

create policy "Applications — view"
  on public.pwd_applications for select
  using (
    auth.uid() = user_id
    or coalesce(current_user_role(), '') = 'admin'
  );

create policy "Applications — insert"
  on public.pwd_applications for insert
  with check (auth.uid() = user_id);

create policy "Applications — admin all"
  on public.pwd_applications for all
  using (coalesce(current_user_role(), '') = 'admin')
  with check (coalesce(current_user_role(), '') = 'admin');

-- ====================================================================
-- verification_transactions — same pattern.
-- ====================================================================

drop policy if exists "Verifications — read own history or admin" on public.verification_transactions;
drop policy if exists "Verifications — verifiers + admins insert" on public.verification_transactions;

create policy "Verifications — view"
  on public.verification_transactions for select
  using (
    auth.uid() = pwd_id
    or auth.uid() = verifier_id
    or coalesce(current_user_role(), '') = 'admin'
  );

create policy "Verifications — insert"
  on public.verification_transactions for insert
  with check (
    coalesce(current_user_role(), '') in ('verifier', 'admin')
  );
