# Smart PWD ID · Admin React Console

A secure, role-based admin UI for the Smart PWD ID system built with **React 18**, **TypeScript**, **Vite**, **Tailwind CSS**, and **Supabase Auth + PostgREST (anon client only)**.

---

## ✨ Features

| Feature | Details |
| --- | --- |
| **Admin Login** | Supabase email/password auth + server-side `public.profiles.role` admin check (non-admins are auto signed out and rejected) |
| **Protected Routes** | Every admin page is behind a `ProtectedRoute` that checks auth state and the `isAdmin` flag before rendering |
| **Dashboard** | 6 count cards (Total, Submitted, Under Review, Approved, Rejected, Needs Revision), status breakdown bar chart, and 6 most recent applications |
| **Applications List** | Debounced text search (name/email/phone/ID/disability), dropdown + chip status filter, sort (date, name), responsive (table desktop / cards mobile), URL-encoded filter state (`?status=&q=`) |
| **Application Details** | Full applicant profile, disability info, uploaded document links, admin notes editor (save / revert), 5 status-change actions each with a **confirmation dialog** that also commits the draft notes |
| **Reusable UI Components** | `StatusBadge`, `Spinner`, `PageLoading`, `EmptyState`, `ErrorState`, `ConfirmDialog`, `DataRow`, `formatDate`, `DocLink` — all in [components/ui/index.tsx](./src/components/ui/index.tsx) |
| **Toast System** | `ToastContext` with `success / error / info / warning`, auto-dismiss, manual close, rendered in a live ARIA region at the top-right |
| **Logout Function** | Confirmed via `ConfirmDialog`, signs out of Supabase, shows toast, redirects to `/login` |
| **Layout** | Desktop sidebar + mobile topbar + hamburger menu, avatar initials, safe-area padding for iOS, Inter font via Google Fonts |
| **Mobile Responsive** | All pages tested at `375px` width; list views switch from table → cards; action buttons wrap gracefully |
| **TypeScript Build** | `tsc --noEmit` (lint / typecheck) + `tsc -b && vite build` both pass (0 errors) |

---

## 📁 Project Structure

```
admin-react/
├── .env.example                  # Env template with placeholders + troubleshooting
├── index.html                    # Vite entry (Inter font, theme-color, SVG favicon)
├── package.json                  # deps + dev/build/lint/typecheck scripts
├── tailwind.config.js            # Brand color tokens, card shadow, Inter font stack
├── tsconfig.json                 # strict:true, @/* → src/* path alias
├── vite.config.ts                # Vite + React plugin
├── config/
│   └── dbSchemaConfig.ts         # Single source of truth: DB column names,
│                                 # status enum normalization, admin/verifier role names
├── src/
│   ├── main.tsx                  # React root → BrowserRouter + ToastProvider + AuthProvider
│   ├── App.tsx                   # Routes, <EnvGate>, <ProtectedRoute>
│   ├── index.css                 # Tailwind layers + button/card/input component classes
│   ├── supabaseClient.ts         # Anon-key-only Supabase client + env assertion helpers
│   ├── components/
│   │   ├── AppLayout.tsx         # Sidebar (desktop) / topbar + menu (mobile), logout
│   │   ├── ProtectedRoute.tsx    # Redirects to /login unless authenticated + isAdmin
│   │   └── ui/index.tsx          # All reusable UI primitives
│   ├── context/
│   │   ├── AuthContext.tsx       # login/logout, role enforcement, onAuthStateChange
│   │   └── ToastContext.tsx      # Toast system with 4 kinds + auto-dismiss
│   ├── lib/
│   │   └── adminQueries.ts       # fetchApplicationStats, fetchApplicationsJoined,
│   │                             # fetchApplicationById, updateApplicationStatus,
│   │                             # saveAdminNotesOnly
│   ├── pages/
│   │   ├── LoginPage.tsx         # Split-screen login form w/ validation
│   │   ├── DashboardPage.tsx     # Stats cards + breakdown bar + recent apps
│   │   ├── ApplicationsPage.tsx  # Search + filters + table/cards + URL state
│   │   └── ApplicationDetailsPage.tsx  # Status actions + confirm + notes + toasts
│   └── types/
│       └── index.ts              # Database row types + composite UI types
└── supabase/
    └── 004_rls_admin_applications.sql   # RLS policies required for the anon client
```

---

## 🚀 Setup Instructions

### 1. Prerequisites

- **Node.js ≥ 18** (LTS recommended; check with `node -v`)
- **npm ≥ 9** (ships with Node)
- A **Supabase project** with:
  - Tables `public.pwd_applications` and `public.profiles` (see migrations in the parent repo)
  - The RLS policies in [supabase/004_rls_admin_applications.sql](./supabase/004_rls_admin_applications.sql) **applied**
  - At least one `auth.users` record with a matching `public.profiles(id, role='admin')` row

### 2. Install Dependencies

```bash
cd admin-react
npm install
```

### 3. Configure Environment

```bash
# Copy the template and fill in your values (see comments inside the file for help)
copy .env.example .env        # Windows PowerShell users: use  Copy-Item .env.example .env
```

Edit `.env` with values from **Supabase Dashboard → Project Settings → API**:

| Variable | Required | Description |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | ✅ | e.g. `https://abcdefghij.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | The **anon / publishable** key (NOT the service_role) |
| `VITE_APP_TITLE` | Optional | Brand override for sidebar and login page |
| `VITE_ADMIN_ROLE_NAME` | Optional | Override the role string stored in `profiles.role` (default: `admin`) |

### 4. Start the Development Server

```bash
npm run dev
```

Then open **http://localhost:5173** in your browser.

Vite will:
- Hot-reload on changes to `src/**` and `config/**`
- Show a friendly **Missing configuration** card if `.env` is not filled in

### 5. Run TypeScript Typecheck / Lint

```bash
npm run lint       # tsc --noEmit  → no emitted files, just type errors
npm run typecheck  # alias of lint
```

### 6. Production Build

```bash
npm run build
```

Output is written to `dist/`. Preview locally with:

```bash
npm run preview    # http://localhost:5173  (production build)
```

### 7. Deploy

The output in `dist/` is a **fully static site** — deploy to:
- **Vercel**: Connect repo → framework = Vite (auto-detected). Remember to set the **Production** env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) in **Project Settings → Environment Variables**.
- **Netlify**: Drag & drop `dist/` or connect repo with `Build command = npm run build`, `Publish directory = dist`.
- **Any static host**: S3 + CloudFront, GitHub Pages, Render, Cloudflare Pages, etc.

---

## ✅ Manual Testing Checklist

Complete each item below before signing off on a release. Ticked boxes = verified.

### 🔐 Authentication & Role Check

- [ ] **Login page loads** at `/login` — split-screen hero, branded form, footer text
- [ ] **Empty submit → field errors**: clicking "Sign in" with no inputs shows inline
      "Email is required" / "Password is required" under the correct fields
- [ ] **Invalid email format → field error** (e.g. `bob@foo` shows "Enter a valid email")
- [ ] **Short password → field error** (5 chars shows "Password must be at least 6 characters")
- [ ] **Wrong credentials → error toast** ("Sign in failed / Invalid login credentials")
- [ ] **Non-admin user is rejected**: sign in with an account where `profiles.role != 'admin'`
      → toast **"Administrator access only"**, user is auto-signed-out of Supabase,
      stays on `/login`
- [ ] **Valid admin account signs in** → toast `"Welcome back, <Firstname>!"` and lands
      on `/dashboard`
- [ ] **Session persistence**: reload the page after signing in — no redirect back to
      `/login`; onAuthStateChange kept you in
- [ ] **Already-authenticated redirect**: navigate directly to `/login` while signed in
      → auto-redirected to `/dashboard`

### 🛡️ Protected Routes & Deep Links

- [ ] **Not signed in → hit `/applications`** → redirected to `/login`; after successful
      sign-in returns to `/applications` (preserves `from` in navigate state)
- [ ] **Not signed in → hit `/applications/<uuid>`** → same behavior, returns to deep
      link after login
- [ ] **Manually delete Supabase session cookie (`sb-...-auth-token`)** + reload any admin
      page → redirected to `/login` cleanly

### 🎯 Dashboard (Counts by Status)

- [ ] **6 stat cards render**: Total, Submitted, Under Review, Approved, Rejected,
      Needs Revision — each shows a numeric count, icon badge, coloured gradient tile
- [ ] **Cards are clickable filters** (except Total): clicking one navigates to
      `/applications?status=under_review` with the correct filter pre-selected
- [ ] **Status breakdown bar** shows stacked segments whose percentages sum to 100%;
      legend chips show per-status %
- [ ] **Zero-data view**: when no applications exist → `EmptyState` inside breakdown
      card AND inside recent-applications list
- [ ] **"Refresh" and "View all applications" buttons** navigate / reload correctly
- [ ] **6 most recent applications** shown sorted by submitted date DESC, each row
      links to `/applications/:id`

### 📋 Applications List

- [ ] **Responsive**: ≥768px renders a table with columns  Applicant · App ID ·
      Disability · Submitted · Status · Action; <768px renders stacked cards with
      "View application" CTA
- [ ] **Debounced search**: typing in the search box triggers a new fetch ~280 ms after
      the last keystroke (shows spinner during debounce)
- [ ] **Search works across**: name, email, phone, application ID (full and short),
      disability type, disability ID number
- [ ] **Dropdown status filter + chip filter are in sync**: clicking the "Approved"
      chip also updates the `<select>`; setting to "All statuses" via dropdown also
      deselects all chips
- [ ] **URL state preserved**: `?status=approved&q=juan` — copy URL to a new tab and the
      filters + search repopulate correctly
- [ ] **"Clear filters" button** appears whenever a filter/search is active and resets
      both (and the URL params)
- [ ] **Sort options** (Newest first / Oldest first / Name A→Z / Name Z→A) rearrange
      the results without re-fetching
- [ ] **Result count line** says "Showing 42 applications matching 'juan' with status Approved"
- [ ] **No matches** renders `EmptyState` with "No applications match your filters" and
      a working "Clear filters" action button
- [ ] **Network failure** renders `ErrorState` with a **Retry** button (re-runs fetch)
- [ ] **Each row has a "View" CTA** (table: small button; cards: full-width) that navigates
      to `/applications/:id`

### 📑 Application Details + Status Actions + Confirmation + Notes + Toasts

- [ ] **Header** shows: avatar initials, applicant name, status badge, short and long
      application IDs, submitted/reviewed timestamps, email/phone (clickable as
      mailto:/tel:)
- [ ] **Invalid ID** (bad UUID, non-existent row) renders `EmptyState` "Application not
      found" with "Go to applications list" CTA
- [ ] **5 status action buttons**: Mark Submitted, Begin Review, Approve Application,
      Reject Application, Request Revision
      - The currently-active status button is visually marked (ring + check icon) and
        disabled
      - Each one opens a `ConfirmDialog` with status-specific title, description, and
        a summary panel showing: new status, applicant, admin, note disposition
- [ ] **Approved / Rejected / Needs Revision confirmation dialogs** have the right
      danger/success colouring
- [ ] **Cancelling a confirmation** closes the dialog WITHOUT saving anything
- [ ] **Confirming a status change**:
      1. Dialog enters loading state ("Updating to approved…")
      2. Admin notes (if dirty) are saved ALONG with the status update in 1 request
      3. `reviewed_at` and `reviewed_by` are set server-side (see `updateApplicationStatus`)
      4. Toast appears: ✅ "Application approved / Status updated and review notes saved."
      5. Dialog closes, details page re-fetches (status badge, reviewed_at, reviewed_by
         all reflect the change)
- [ ] **Admin notes editor**:
      - Type in the textarea → "Unsaved changes" flag updates at the bottom-right
      - **Save notes** (no status change) → dedicated "Notes saved" toast
      - **Revert** discards unsaved edits and resets to the last saved value
      - 0-length "Save notes only" correctly writes `NULL` to `review_notes` column
- [ ] **Quick actions sidebar**: Back to list, Email applicant, Copy summary — all work
      (Copy summary uses `navigator.clipboard` and shows an info toast)
- [ ] **Document links**: uploaded URLs render as "View <Label>" green-tinted buttons
      that open an **in-page preview overlay** (images inline, PDFs in an embedded
      frame; Esc / Close / backdrop closes it — no new browser tab); missing uploads
      render as dashed-border "Label — Not uploaded" placeholders

### 🍞 Toast System

- [ ] **4 toast kinds all render correctly**: success (green), error (red), info
      (blue), warning (amber) — each has a matching top accent bar + dot
- [ ] **Toasts auto-dismiss**: success/info/warning after ~3.8 s; errors after ~6.5 s
- [ ] **Manual dismiss (✕ button)** works instantly; removing one does not affect the
      others
- [ ] **Stack ordering** — newest toast appears at the top of the stack
- [ ] **aria-live="polite"** region present on the container for screen readers

### 🚪 Logout

- [ ] **Desktop sidebar**: click the sign-out icon on the user chip → confirmation
      dialog "Sign out?"
- [ ] **Mobile menu**: open the hamburger menu → "Sign out" chip → same confirmation
- [ ] **Confirming logout**: dialog shows loading state, Supabase signs out, toast
      **"Signed out / You have been logged out of the admin console."**, redirected
      to `/login` with `replace`
- [ ] **After logout**: navigating to `/dashboard` via URL bar now bounces back to
      `/login` (ProtectedRoute enforcement)

### 🔧 Build / Type Safety

- [ ] `npm run lint` (tsc --noEmit) passes with **0 errors / 0 warnings**
- [ ] `npm run build` runs `tsc -b && vite build` and produces a `dist/` folder with
      `index.html`, JS, CSS asset files — **no build errors**
- [ ] No `any` escape hatches outside of DB driver typing (the 2 casts inside
      `adminQueries.ts` are both on `.from(...) as any` and needed due to a supabase-js
      `Update → never` quirk with dynamic column keys; all other code is strict-TS)

### 📱 Mobile / Responsiveness

Test at 375 px (iPhone SE width) and 414 px (iPhone 12/13/14 width):

- [ ] **Login**: single-column stacked layout, "Locked out?" help box still readable
- [ ] **Dashboard**: cards are 1 column, no horizontal scroll; stat tiles wrap nicely
- [ ] **Applications list**: renders as cards (NOT the table); "View" CTA is easy to tap
- [ ] **Details page**: 1-column layout, action buttons wrap instead of overflow
- [ ] **Safe-area insets**: top bars respect `env(safe-area-inset-top)` on notched iPhones
      (no content under the Dynamic Island)

---

## 🔌 Supabase RLS Required

The admin console uses the **anon** key by design. For reads and writes to succeed,
run the SQL in [supabase/004_rls_admin_applications.sql](./supabase/004_rls_admin_applications.sql)
against your Supabase DB. It creates policies like:

```sql
-- Profiles: admins read all; users read own; admins write status cols
-- Applications: admins read all + write approved columns; users write own on insert
```

If you skip this, the dashboard/listing will show **0 rows** even when data exists
(that is RLS working correctly — returning a silent empty set, not an error).

---

## 🛠️ Common Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Missing configuration" banner instead of login | Copy `.env.example` → `.env` and fill `VITE_SUPABASE_URL` + anon key; restart dev server |
| "Administrator access only" after correct password | `update public.profiles set role = 'admin' where id = '<auth.users.id>';` |
| Dashboard shows **0 rows** but apps exist | Apply `004_rls_admin_applications.sql` policies; verify `pwd_applications.user_id = profiles.id` join exists |
| `Cannot find module '@/...'` import errors | Run `npm run build` / restart TS server; `@/* → src/*` mapping is in `tsconfig.json` |
| Status save fails with **"new row violates row-level security"** | Check the `trg_pwd_applications_block_admin_cols` trigger + RLS — you must be `role='admin'` |

---

## 📜 Scripts (package.json)

```jsonc
{
  "dev":      "vite --port 5173",       // Local dev server
  "build":    "tsc -b && vite build",   // Typecheck + production build to dist/
  "preview":  "vite preview --port 5173",
  "lint":     "tsc --noEmit",           // Type-only check
  "typecheck":"tsc --noEmit"
}
```
