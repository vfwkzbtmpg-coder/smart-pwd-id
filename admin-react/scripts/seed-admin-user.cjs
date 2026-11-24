const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const rootDir = path.resolve(__dirname, '..', '..');
require('dotenv').config({ path: path.join(rootDir, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in root .env');
  console.error('   Looked at:', path.join(rootDir, '.env'));
  console.error('   Keys present:', Object.keys(process.env).filter(k => /^SUPABASE/i.test(k)).join(', ') || '(none)');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

const ADMINS_TO_SEED = [
  {
    email: 'admin@smartpwd.ph',
    password: 'Admin123',
    first_name: 'System',
    last_name: 'Admin',
    mobile: '09191234567',
  },
  {
    email: 'juandelacruz@example.com',
    password: 'JuanDela123!',
    first_name: 'Juan',
    last_name: 'Dela Cruz',
    mobile: '09171234567',
  },
];

async function upsertUser({ email, password, first_name, last_name, mobile }) {
  console.log(`\n🔎  Looking up user  ${email}`);
  const { data: list } = await sb.auth.admin.listUsers();
  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  let userId;
  if (existing) {
    userId = existing.id;
    console.log(`   ✅ Already exists (uid=${userId.slice(0, 8)}…)`);
    console.log(`   🔐 Resetting password to  "${password}"`);
    await sb.auth.admin.updateUserById(userId, { password });
  } else {
    console.log(`   ➕ Creating new user, password "${password}"`);
    const { data, error } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name, last_name, mobile },
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`   ✅ Created uid=${userId}`);
  }

  // Ensure a profiles row exists and role='admin' and account_type='pwd' (required constraint).
  const profilePayload = {
    id: userId,
    first_name,
    last_name,
    full_name: `${first_name} ${last_name}`,
    mobile,
    contact_number: mobile,
    role: 'admin',
    account_type: 'pwd',
    updated_at: new Date().toISOString(),
  };
  const { error: upsertErr } = await sb
    .from('profiles')
    .upsert(profilePayload, { onConflict: 'id' });
  if (upsertErr) {
    console.error('   ⚠️  profiles upsert problem (continuing):', upsertErr.message);
    console.error('      Code:', upsertErr.code, 'Details:', upsertErr.details);
    // Fallback: try an UPDATE of existing row to guarantee role='admin'
    const { error: upErr } = await sb
      .from('profiles')
      .update({ role: 'admin', account_type: 'pwd', first_name, last_name, updated_at: new Date().toISOString() })
      .eq('id', userId);
    if (upErr) console.error('      UPDATE also failed:', upErr.message);
    else console.log('   ✅ profiles row updated → role=admin');
  } else {
    console.log('   ✅ profiles row upserted → role=admin');
  }

  // Sign in attempt (verify)
  const { data: signData, error: signErr } = await sb.auth.signInWithPassword({
    email,
    password,
  });
  if (signErr) {
    console.error('   ❌ Sign-in VERIFY failed:', signErr.code, signErr.message);
  } else {
    console.log(`   ✅ Verified sign-in → uid=${signData.user.id.slice(0, 8)}…`);
    await sb.auth.signOut();
  }

  return { email, password, userId };
}

(async () => {
  console.log('========================================');
  console.log(' SMART PWD — Admin account seeder');
  console.log(' Project:', SUPABASE_URL.replace('https://', ''));
  console.log('========================================');

  const results = [];
  for (const u of ADMINS_TO_SEED) {
    try {
      results.push(await upsertUser(u));
    } catch (e) {
      console.error(`❌ Fatal for ${u.email}:`, e.message);
    }
  }

  console.log('\n========================================');
  console.log(' 🎯 Seed complete. Admin console credentials:');
  console.log('========================================');
  for (const r of results) {
    console.log(`   👤 Email   : ${r.email}`);
    console.log(`   🔑 Password: ${r.password}`);
    console.log(`   🧑‍💼 Role    : admin (in public.profiles.role)`);
    console.log('   ----------------------------------------');
  }
  console.log('\n💡 Paste these into the React admin login at http://localhost:5173/login');
  console.log('💡 Also work on the legacy HTML login at /login.html');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
