-- ============================================================
-- 008  Admin messages
-- ============================================================
-- A cardholder needs one private line to the PWD office: send a message,
-- receive the office's reply. Deliberately NOT a social feature — there is
-- no friends list, no friend requests and no user-to-user thread. Every row
-- belongs to exactly one applicant (user_id) and carries a sender_role that
-- is either 'pwd' (the applicant) or 'admin' (the PWD office), so a thread
-- can only ever be applicant <-> admin.

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  sender_role text not null check (sender_role in ('pwd', 'admin')),
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists messages_thread_idx
  on public.messages (user_id, created_at);

-- ----------------------------------------------------------------
-- RLS — reuse the recursion-safe current_user_role() helper created
-- by 003_clean_rls_all_policies.sql.
-- ----------------------------------------------------------------
-- Same helper as 003 — repeated here so this migration also works on a
-- database that never had 003 applied.
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

alter table public.messages enable row level security;

drop policy if exists "messages_select" on public.messages;
drop policy if exists "messages_insert" on public.messages;
drop policy if exists "messages_delete" on public.messages;

-- Applicant reads only their own thread; the admin reads every thread.
create policy "messages_select"
  on public.messages for select
  using (
    auth.uid() = user_id
    or coalesce(current_user_role(), '') = 'admin'
  );

-- Applicant may only post into their own thread as 'pwd'; the admin may
-- post anywhere as 'admin'. A user can never impersonate the office.
create policy "messages_insert"
  on public.messages for insert
  with check (
    (auth.uid() = user_id and sender_role = 'pwd')
    or (
      coalesce(current_user_role(), '') = 'admin'
      and sender_role = 'admin'
    )
  );

create policy "messages_delete"
  on public.messages for delete
  using (coalesce(current_user_role(), '') = 'admin');
