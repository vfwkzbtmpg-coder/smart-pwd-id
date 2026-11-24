-- ============================================================
-- Smart PWD ID — Initial Database Schema
-- ============================================================
-- This migration sets up:
--   1. profiles           — user metadata linked to auth.users
--   2. pwd_applications   — PWD ID application workflow
--   3. verification_transactions — every ID check logged
--   4. fsl_library        — Filipino Sign Language video bank
--   5. Auto-create profile trigger on auth.users insert
--   6. Row-Level Security (RLS) policies for each table
-- ============================================================

-- Enable extensions
create extension if not exists "pgcrypto";

-- ============================================================
-- 1. PROFILES TABLE
-- ============================================================
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  first_name      text,
  last_name       text,
  mobile          text,
  account_type    text not null default 'pwd' check (account_type in ('pwd', 'establishment')),
  role            text not null default 'pwd' check (role in ('pwd', 'verifier', 'admin')),
  id_number       text unique,
  application_status text not null default 'Not Submitted'
    check (application_status in ('Not Submitted', 'Pending', 'Approved', 'Rejected')),
  approved_at     timestamptz,
  valid_until     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.profiles is 'Extended user profile for every Smart PWD ID account.';
comment on column public.profiles.role is 'pwd = regular cardholder, verifier = establishment staff, admin = system admin.';
comment on column public.profiles.id_number is 'System-assigned PWD ID number (e.g. 2026-0000-4821) or EST-xxxx.';

-- Auto-update updated_at on row change
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.handle_updated_at();

-- ============================================================
-- 2. PWD APPLICATIONS TABLE
-- ============================================================
create table if not exists public.pwd_applications (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  status             text not null default 'Pending'
    check (status in ('Pending', 'Under Review', 'Approved', 'Rejected')),
  submitted_at       timestamptz,
  reviewed_at        timestamptz,
  reviewed_by        uuid references public.profiles(id),
  review_notes       text,
  disability_type    text,
  disability_id_no   text,
  id_front_url       text,
  id_back_url        text,
  photo_url          text,
  medical_cert_url   text,
  barangay_cert_url  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

drop trigger if exists pwd_applications_updated_at on public.pwd_applications;
create trigger pwd_applications_updated_at
before update on public.pwd_applications
for each row execute function public.handle_updated_at();

-- ============================================================
-- 3. VERIFICATION TRANSACTIONS TABLE
-- ============================================================
create table if not exists public.verification_transactions (
  id           uuid primary key default gen_random_uuid(),
  pwd_id       uuid not null references public.profiles(id),
  verifier_id  uuid references public.profiles(id),
  method       text not null check (method in ('QR', 'NFC', 'RFID', 'Manual')),
  result       text not null check (result in ('Success', 'Failed')),
  failure_reason text,
  establishment text,
  location     text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_verifications_pwd on public.verification_transactions(pwd_id);
create index if not exists idx_verifications_created on public.verification_transactions(created_at desc);

-- ============================================================
-- 4. FSL (Filipino Sign Language) LIBRARY
-- ============================================================
create table if not exists public.fsl_library (
  id           uuid primary key default gen_random_uuid(),
  sentence     text not null unique,
  video_url    text not null,
  category     text default 'General',
  duration_sec integer default 0,
  created_at   timestamptz not null default now()
);

-- ============================================================
-- 5. AUTO-CREATE PROFILE TRIGGER
--    Whenever a row is inserted into auth.users, the public
--    profile row is automatically seeded from auth metadata.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_account_type text;
  v_role         text;
  v_id_number    text;
  v_valid_until  timestamptz;
begin
  v_account_type := coalesce(new.raw_user_meta_data ->> 'account_type', 'pwd');

  if v_account_type = 'establishment' then
    v_role := 'verifier';
    v_id_number := 'EST-' || to_char(nextval('seq_est_id') % 10000, 'FM0000');
  else
    v_role := 'pwd';
    v_id_number := '2026-' || to_char(floor(random() * 10000)::int, 'FM0000')
                            || '-' || to_char(floor(random() * 10000)::int, 'FM0000');
    v_valid_until := now() + interval '5 years';
  end if;

  insert into public.profiles (
    id, first_name, last_name, mobile, account_type, role,
    id_number, application_status, valid_until
  ) values (
    new.id,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'mobile',
    v_account_type,
    v_role,
    v_id_number,
    case when v_role = 'verifier' then 'Approved' else 'Not Submitted' end,
    v_valid_until
  );

  return new;
end;
$$ language plpgsql security definer;

-- Helper sequence for establishment IDs
do $$ begin
  create sequence if not exists public.seq_est_id start with 1 increment by 1;
exception when others then null; end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ============================================================
-- 6. ROW-LEVEL SECURITY (RLS) POLICIES
-- ============================================================
alter table public.profiles                enable row level security;
alter table public.pwd_applications        enable row level security;
alter table public.verification_transactions enable row level security;
alter table public.fsl_library             enable row level security;

-- ----- PROFILES -----
-- Users can read & update their own profile; admins read all;
-- verifiers can read basic profile fields when verifying.
create policy "Profiles — users view own"
  on public.profiles for select
  using (auth.uid() = id or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  ));

create policy "Profiles — users update own"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Profiles — service role / verifiers read during verify"
  on public.profiles for select
  using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role in ('verifier', 'admin')
  ));

-- ----- APPLICATIONS -----
create policy "Applications — users view own"
  on public.pwd_applications for select
  using (auth.uid() = user_id or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  ));

create policy "Applications — users create own"
  on public.pwd_applications for insert
  with check (auth.uid() = user_id);

create policy "Applications — admins manage"
  on public.pwd_applications for all
  using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  ));

-- ----- VERIFICATION TRANSACTIONS -----
create policy "Verifications — read own history or admin"
  on public.verification_transactions for select
  using (
    auth.uid() = pwd_id or auth.uid() = verifier_id or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "Verifications — verifiers + admins insert"
  on public.verification_transactions for insert
  with check (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role in ('verifier', 'admin')
  ));

-- ----- FSL LIBRARY — readable by all authenticated users -----
create policy "FSL library — read all authenticated"
  on public.fsl_library for select
  using (auth.role() = 'authenticated');

create policy "FSL library — admin manage"
  on public.fsl_library for all
  using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  ));

-- ============================================================
-- 7. SEED SAMPLE FSL VIDEOS
-- ============================================================
insert into public.fsl_library (sentence, video_url, category, duration_sec) values
  ('Hello, welcome to Smart PWD ID.',       'https://example.com/fsl/hello.mp4',       'Greeting', 3),
  ('Please scan your QR code.',             'https://example.com/fsl/scan-qr.mp4',     'Workflow', 4),
  ('Your ID has been verified successfully.','https://example.com/fsl/verified.mp4',    'Result',   3),
  ('Sorry, verification failed.',           'https://example.com/fsl/failed.mp4',      'Result',   3),
  ('Thank you, have a great day.',          'https://example.com/fsl/thank-you.mp4',   'Greeting', 3)
on conflict (sentence) do nothing;
