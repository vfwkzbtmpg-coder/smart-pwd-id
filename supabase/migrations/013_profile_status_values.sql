-- ============================================================
-- 013 — Let both tables carry the full set of review statuses
--
-- The admin console offers five review actions and PUT
-- /api/applications/:id writes the chosen one to pwd_applications
-- first, then mirrors it onto profiles. The two CHECK constraints
-- from 001_initial_schema.sql were narrower than that vocabulary,
-- and each was missing different values:
--
--   pwd_applications.status       allowed Pending, Under Review,
--                                 Approved, Rejected
--                                 -> rejected "Submitted" and "Needs Revision"
--   profiles.application_status   allowed Not Submitted, Pending,
--                                 Approved, Rejected
--                                 -> rejected "Under Review" and "Needs Revision"
--
-- A rejected value makes the UPDATE fail, and because the two
-- writes are separate statements the review ends up half-applied:
-- one table says one thing, the other says another, and the holder
-- stays verifiable under the previous approval.
--
-- Verified against the live API before this migration:
--   PUT 'Under Review'   -> 500 profiles_application_status_check
--   PUT 'Needs Revision' -> 500 pwd_applications_status_check
--   PUT 'Pending'        -> 200
--
-- Widening the lists cannot make anyone verifiable: /api/verify only
-- passes when profiles.application_status is exactly 'Approved'.
-- ============================================================

alter table public.pwd_applications
  drop constraint if exists pwd_applications_status_check;

alter table public.pwd_applications
  add constraint pwd_applications_status_check
  check (status = any (array[
    'Pending'::text,
    'Under Review'::text,
    'Needs Revision'::text,
    'Submitted'::text,
    'Approved'::text,
    'Rejected'::text
  ]));

alter table public.profiles
  drop constraint if exists profiles_application_status_check;

alter table public.profiles
  add constraint profiles_application_status_check
  check (application_status = any (array[
    'Not Submitted'::text,
    'Pending'::text,
    'Under Review'::text,
    'Needs Revision'::text,
    'Approved'::text,
    'Rejected'::text
  ]));
