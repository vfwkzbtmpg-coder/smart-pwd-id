-- ============================================================
-- 009 — Digital ID Card front background
--
-- The admin picks the cardholder's LGU background from the
-- "Choose Front Background" grid in the applications modal. Until
-- now that choice was preview-only, so an approved cardholder saw
-- a plain white card on their dashboard.
--
-- bg_front stores the LGU slug (e.g. 'quezon-city'), NOT a path or
-- a data URL. The card then loads backgrounds/<slug>.png, which is
-- how public/backgrounds/ is already laid out — one small column
-- instead of megabytes of base64 per row.
--
-- Idempotent: safe to re-run.
-- ============================================================

alter table public.pwd_applications
  add column if not exists bg_front text;

comment on column public.pwd_applications.bg_front is
  'LGU slug for the Digital ID Card front background, e.g. quezon-city -> backgrounds/quezon-city.png';
