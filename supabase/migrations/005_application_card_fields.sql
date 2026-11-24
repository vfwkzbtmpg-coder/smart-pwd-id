-- ============================================================
-- 005  PWD application fields printed on the digital ID card
-- ============================================================
-- The card prints TYPE OF DISABILITY, SEX, DATE OF BIRTH and the
-- "IN CASE OF EMERGENCY, PLEASE NOTIFY" details. pwd_applications had no
-- columns for them, so the birthdate had been parked in disability_type.
-- Add the missing columns, then move the legacy birthdate values into the
-- real birthdate column so disability_type only ever holds a disability type.

alter table public.pwd_applications add column if not exists birthdate text;
alter table public.pwd_applications add column if not exists sex text;
alter table public.pwd_applications add column if not exists blood_type text;
alter table public.pwd_applications add column if not exists emergency_name text;

-- Legacy rows stored the birthdate in disability_type (e.g. "12/02/2004").
-- Move anything that looks like a date across and clear disability_type.
update public.pwd_applications
   set birthdate = disability_type,
       disability_type = null
 where birthdate is null
   and disability_type ~ '^[0-9]{1,4}[/.-][0-9]{1,2}[/.-][0-9]{2,4}$';