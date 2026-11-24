-- Per-cardholder controls for QR and NFC verification.
-- Defaults preserve the existing behavior for every current profile.
alter table public.profiles
  add column if not exists qr_enabled boolean not null default true,
  add column if not exists nfc_enabled boolean not null default true;

comment on column public.profiles.qr_enabled is
  'Whether authorized verifiers may validate this holder by QR code.';
comment on column public.profiles.nfc_enabled is
  'Whether authorized verifiers may validate this holder by NFC.';
