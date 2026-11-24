# Debug Session: supabase-auth-failure
- **Status**: [OPEN]
- **Issue**: Login and Register pages do not successfully authenticate via Supabase Auth. Forms submit but authentication fails.
- **Debug Server**: PENDING
- **Log File**: .dbg/trae-debug-log-supabase-auth-failure.ndjson

## Reproduction Steps
1. Start server: `npm start`
2. Open http://localhost:3000/login.html
3. Enter valid email + password (or register a new account)
4. Click Sign In / Create Account
5. Observe: authentication does not succeed, or error appears

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Supabase `const supabase = supabase.createClient()` TDZ / naming collision | High | Low | **CONFIRMED**: Log #3 pre-fix: `ReferenceError: Cannot access 'supabase' before initialization` at login.html:172:24. Post-fix log shows createClient SUCCESS. |
| B | Supabase URL / publishable key are wrong or mismatched | High | Low | **CONFIRMED**: Pre-fix used project `krrnstmiaidngoumayox` + JWT anon key. Spec requires `fvanpmyxrwotnafdnjyo` + `sb_publishable_...`. Both corrected. |
| C | `getSession` on a destroyed/undefined client throws | Medium | Low | **CONFIRMED**: Pre-fix browser console: `TypeError: Cannot read properties of undefined (reading 'getSession')` (login.html:187). Post-fix client successfully gets auth. |
| D | CORS or network request failure | Medium | Low | *Pending post-fix sign-in attempt.* |
| E | Redirect to "/" before session persists | Low | Low | *Pending.* |

## Log Evidence
[Pending instrumentation]

## Verification Conclusion
[Pending]
