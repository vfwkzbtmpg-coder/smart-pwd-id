-- ============================================================
-- 012 — Per-holder QR token
--
-- Until now a verify link carried only the ID number, so anyone who knew
-- (or guessed) "2026-0000-4821" could print a card that the verifier
-- accepted. This adds a per-holder secret that the link must also carry.
--
-- The token is rotated on every Approve / Reject, so a photocopied card or
-- a cloned NFC tag stops verifying the moment the holder's application is
-- reviewed again.
--
-- Existing holders are backfilled, which makes the token mandatory everywhere
-- the instant this runs: a code printed before it carries no token at all, so
-- it stops verifying immediately. Reissue each holder's code from the admin
-- console (or their own dashboard) to restore it.
--
-- If you instead need the cards already in the field to keep working, drop the
-- UPDATE below. A token is then issued the first time an application is
-- approved or rejected, and that holder's old code dies only at that moment.
-- ============================================================

alter table public.profiles
  add column if not exists qr_token text;

update public.profiles
   set qr_token = replace(gen_random_uuid()::text, '-', '')
 where qr_token is null
   and role = 'pwd';

-- Two holders must never share a token, or one card would verify as the other.
create unique index if not exists profiles_qr_token_key
  on public.profiles (qr_token)
  where qr_token is not null;

comment on column public.profiles.qr_token is
  'Secret carried by the holder''s QR code and NFC tag. Rotated on every Approve/Reject so a stolen or photocopied code stops verifying.';
