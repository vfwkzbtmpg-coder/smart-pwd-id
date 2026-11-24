-- ============================================================
-- 010 — Store NFC reader UIDs on PWD profiles
--
-- nfc_id is retained for compatibility with older deployments.
-- Existing values are copied forward so switching the kiosk to
-- nfc_uid does not detach already-issued cards.
--
-- The partial unique index prevents one physical tag from being
-- assigned to multiple profiles while allowing unissued cards.
-- ============================================================

alter table public.profiles
  add column if not exists nfc_uid text;

update public.profiles
set nfc_uid = nfc_id
where nfc_uid is null
  and nfc_id is not null;

create unique index if not exists profiles_nfc_uid_key
  on public.profiles (nfc_uid)
  where nfc_uid is not null;

comment on column public.profiles.nfc_uid is
  'Hardware UID of the holder''s NFC tag. NULL means no tag is issued.';
