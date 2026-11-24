-- ============================================================
-- 006  Emergency contact number of the guard
-- ============================================================
-- The card's back prints "IN CASE OF EMERGENCY, PLEASE NOTIFY" with the
-- guard's name and a number to call. emergency_name (added in 005) holds
-- the name; the number had been borrowed from the applicant's own mobile,
-- so add a real column for the guard's own contact number.

alter table public.pwd_applications add column if not exists emergency_contact text;
