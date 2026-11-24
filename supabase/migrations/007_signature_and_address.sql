-- ============================================================
-- 007  Applicant signature and address
-- ============================================================
-- The digital ID card prints the applicant's own signature and the
-- "IN CASE OF EMERGENCY, PLEASE NOTIFY" block, which includes an address
-- line. application-form.html already collects both, but the signature was
-- only noted as text inside review_notes and the address was never stored
-- in a column at all, so the card fell back to a manual upload and an
-- empty line. Store them properly so the card can fill itself in.

alter table public.pwd_applications add column if not exists signature_url text;
alter table public.pwd_applications add column if not exists address text;
