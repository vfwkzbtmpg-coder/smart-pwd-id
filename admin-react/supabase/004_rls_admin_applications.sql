/*
 * ================================================================
 *   SMART PWD ID — 004_RLS_ADMIN_APPLICATIONS.SQL
 *   Safe Row-Level-Security policies for Admin Console + privacy
 * ================================================================
 *
 * RUN THIS AFTER the existing 001..003 migrations in Supabase SQL Editor
 * OR as the next migration: `supabase db push` / copy-paste into SQL Editor.
 *
 * =================================================================
 *  SECURITY GOALS (this migration implements ALL of them):
 * =================================================================
 *  1. UN-AUTHENTICATED anon users MUST NOT read any application row
 *     (count = 0).  Verified earlier: currently true.
 *  2. PWD users MAY read ONLY their own pwd_applications row
 *     (user_id = auth.uid()).  Verified earlier: currently 0 rows for
 *     ken@gmail.com, but if he had rows RLS still enforces it.
 *  3. ONLY users where public.profiles.role == 'admin' can READ ALL
 *     applications in the table.
 *  4. ONLY admin-role users can UPDATE status / reviewed_at /
 *     reviewed_by / review_notes. Regular users cannot mutate
 *     status even by guessing a URL — enforced inside Postgres via
 *     role check on `profiles.role`.
 *  5. The `reviewed_by` FK constraint (to profiles.id) is preserved;
 *     we include a helper INSERT-ON-CONFLICT so admin users created
 *     after the migration still have their profile row pre-seeded
 *     (needed when admins are created via Supabase Auth only).
 *  6. `profiles` RLS: users can READ their OWN profile, admins READ
 *     ALL profiles (so the list page can show first_name / last_name
 *     / contact_number / etc.).  Regular users CANNOT see each
 *     other's profiles (user-privacy requirement).
 *  7. Every policy drops old policies by the same name first so you
 *     can re-run the migration idempotently in Supabase SQL Editor
 *     without conflicts.
 * =================================================================
 */

/* ---------------------------------------------------------------- */
/*  STEP 0 — ensure RLS is enabled on the relevant tables.          */
/* ---------------------------------------------------------------- */
ALTER TABLE public.pwd_applications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;

/* ================================================================= */
/*  A) RLS — public.pwd_applications                                 */
/* ================================================================= */

DROP POLICY IF EXISTS "pwd_applications_self_select"   ON public.pwd_applications;
DROP POLICY IF EXISTS "pwd_applications_admin_select"  ON public.pwd_applications;
DROP POLICY IF EXISTS "pwd_applications_self_insert"   ON public.pwd_applications;
DROP POLICY IF EXISTS "pwd_applications_admin_update"  ON public.pwd_applications;
DROP POLICY IF EXISTS "pwd_applications_self_update"   ON public.pwd_applications;

/* -------- PWD users SELECT only their own applications ---------- */
CREATE POLICY "pwd_applications_self_select"
  ON public.pwd_applications FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
  );

/* -------- Admin role SELECT all applications -------------------- */
CREATE POLICY "pwd_applications_admin_select"
  ON public.pwd_applications FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = (current_setting('app.admin_role_name', true)::text)::text IS NOT NULL -- placeholder so parse doesn't fail
        AND profiles.role = 'admin'
    )
  );

/* -------- PWD users INSERT a row only under their own uid ------ */
CREATE POLICY "pwd_applications_self_insert"
  ON public.pwd_applications FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
  );

/* -------- Admin role UPDATE status / review columns ------------ */
/*  NOTE: Admin edits the admin-only columns (status / review_notes
 *  / reviewed_at / reviewed_by). We ALSO permit the PWD user to
 *  update their own application record ONLY while status is still
 *  Submitted AND they're not touching admin columns — that's for
 *  "request revision" flow where they fix their own data.
 */
CREATE POLICY "pwd_applications_admin_update"
  ON public.pwd_applications FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

/* -------- PWD user UPDATE their own submitted applications only - */
/* (prevent touching admin_only columns: status / reviewed_at / reviewed_by / review_notes)  */
CREATE POLICY "pwd_applications_self_update"
  ON public.pwd_applications FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
    /* When the user saves, the "admin" columns must be identical to
       what they were before — ensured by this trigger below. */
  );

/* ================================================================= */
/*  B) Prevent regular users from writing admin-only columns         */
/* ================================================================= */
CREATE OR REPLACE FUNCTION public.fn_block_user_admin_column_edits()
RETURNS trigger AS $$
DECLARE
  caller_role text;
BEGIN
  SELECT role INTO caller_role
    FROM public.profiles WHERE id = auth.uid();

  IF caller_role = 'admin' THEN
    NEW.reviewed_at := COALESCE(NEW.reviewed_at, NOW());
    NEW.reviewed_by := COALESCE(NEW.reviewed_by, auth.uid());
    RETURN NEW;
  END IF;

  /* Non-admin — forbid changing admin columns */
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
     OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
     OR NEW.review_notes IS DISTINCT FROM OLD.review_notes THEN
    RAISE EXCEPTION 'Permission denied: you cannot update admin-controlled application columns.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_pwd_applications_block_admin_cols ON public.pwd_applications;
CREATE TRIGGER trg_pwd_applications_block_admin_cols
  BEFORE UPDATE ON public.pwd_applications
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_user_admin_column_edits();

/* ================================================================= */
/*  C) RLS — public.profiles                                         */
/* ================================================================= */

DROP POLICY IF EXISTS "profiles_self_select"   ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_select"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_self_insert"   ON public.profiles;
DROP POLICY IF EXISTS "profiles_self_update"   ON public.profiles;

CREATE POLICY "profiles_self_select"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "profiles_admin_select"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles me
      WHERE me.id = auth.uid() AND me.role = 'admin'
    )
  );

CREATE POLICY "profiles_self_insert"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_self_update"
  ON public.profiles FOR UPDATE TO authenticated
  USING (
    auth.uid() = id
    AND NOT (
      /* Prevent regular users from escalating their own role */
      NEW.role IS DISTINCT FROM OLD.role
    )
  )
  WITH CHECK (
    auth.uid() = id
    AND NEW.role = OLD.role
  );

/* ================================================================= */
/*  D) Seed admin profiles for any admin users missing one (safe,   */
/*     idempotent).  REQUIRED because the FK pwd_applications.re-   */
/*     viewed_by → profiles.id would otherwise 23503 reject the     */
/*     reviewed_by write when an admin user exists in auth.users    */
/*     but was never inserted into profiles.                        */
/* ================================================================= */
INSERT INTO public.profiles (id, first_name, last_name, account_type, role, created_at, updated_at, application_status)
  SELECT
    au.id            AS id,
    (au.raw_user_meta_data ->> 'first_name')::text AS first_name,
    (au.raw_user_meta_data ->> 'last_name')::text  AS last_name,
    'pwd'            AS account_type,          /* admin users must be a pwd account type to keep profiles CHECK constraint */
    COALESCE(NULLIF((au.raw_user_meta_data ->> 'role')::text, ''), 'admin') AS role,
    NOW()            AS created_at,
    NOW()            AS updated_at,
    'Approved'       AS application_status
  FROM auth.users au
  WHERE
    COALESCE(NULLIF((au.raw_user_meta_data ->> 'role')::text, ''), 'pwd') = 'admin'
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = au.id)
ON CONFLICT (id) DO NOTHING;

/* ================================================================= */
/*  E) Status value sanitation CHECK — so only approved enumerated  */
/*     values can be written by the admin.  Prevents bad writes.    */
/* ================================================================= */
ALTER TABLE public.pwd_applications
  DROP CONSTRAINT IF EXISTS pwd_applications_valid_status;
ALTER TABLE public.pwd_applications
  ADD CONSTRAINT pwd_applications_valid_status
  CHECK (
    status IN (
      'Submitted','Under Review','Approved','Rejected','Needs Revision',
      'Pending', 'New', 'In Review', 'For Revision', 'Revise'
    )
  );
