// Temporary test to check Supabase auth state + create a user via service role if needed.
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fvyinioymlegzfhrahbt.supabase.co';
// Service-role credential: environment only, never committed.
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set. Run with `node --env-file=.env server/ensure-user.js`.');
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

async function main() {
  const email = 'juandelacruz@example.com';
  const pw = 'JuanDela123!';

  // 1) Try to list users to see if the email is already registered.
  const { data: list, error: listErr } = await sb.auth.admin.listUsers();
  if (listErr) {
    console.error('List users failed:', listErr);
  } else {
    const matched = list.users.filter(u => u.email === email);
    console.log('Users matching email:', matched.length);
    if (matched.length) console.log(matched[0].id);
  }

  // 2) Try to sign in to confirm credentials work.
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
  if (error) {
    console.log('\nSign-in failed:', error.code, error.message);
    // Maybe user was never created — let's try creating via admin now.
    if (error.code === 'invalid_credentials') {
      console.log('\nCreating user via admin API...');
      const { data: create, error: createErr } = await sb.auth.admin.createUser({
        email,
        password: pw,
        email_confirm: true,
        user_metadata: { first_name: 'Juan', last_name: 'Dela Cruz', mobile: '09171234567' },
      });
      if (createErr) console.error('Create failed:', createErr);
      else {
        console.log('✅ Created user id =', create.user.id);
        // Also ensure the profiles row exists for this user.
        // (Trigger should do it — but let's verify.)
        const { count, error: pErr } = await sb
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('id', create.user.id);
        console.log('profiles rows for user:', count);
        if (pErr) console.error('profiles query:', pErr);
      }
    }
  } else {
    console.log('\n✅ Sign-in SUCCESS — uid:', data.user.id);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
