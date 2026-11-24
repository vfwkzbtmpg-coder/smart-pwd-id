require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const users = [
  {
    email: 'admin@smartpwd.ph',
    password: 'Admin123',
    role: 'admin',
    meta: { first_name: 'System', last_name: 'Administrator', account_type: 'admin' },
  },
  {
    email: 'verifier@smartpwd.ph',
    password: 'verify123',
    role: 'verifier',
    meta: { first_name: 'Verifier', last_name: 'Staff', account_type: 'establishment' },
  },
  {
    email: 'ken@gmail.com',
    password: 'ken123456',
    role: 'pwd',
    meta: { first_name: 'Ken', last_name: 'Cardholder', account_type: 'pwd' },
  },
];

(async () => {
  for (const u of users) {
    console.log(`\n--- Setting up ${u.email} (role: ${u.role}) ---`);

    let authUser = null;

    const { data: signUp, error: signUpErr } = await supabase.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: u.meta,
    });

    if (signUpErr) {
      const msg = (signUpErr.message || '') + ' ' + (signUpErr.code || '');
      if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('registered')) {
        console.log('  User already exists in auth. Fetching...');
        const { data: list } = await supabase.auth.admin.listUsers();
        authUser = list.users.find(x => x.email === u.email);
        if (authUser) {
          console.log('  Resetting password to demo value...');
          const { error: updErr } = await supabase.auth.admin.updateUserById(authUser.id, {
            password: u.password,
          });
          if (updErr) console.error('  password reset error:', updErr.message);
          else console.log('  Password reset OK.');
        }
      } else {
        console.error('  createUser error:', signUpErr.message);
        continue;
      }
    } else {
      authUser = signUp.user;
      console.log('  Created auth user:', authUser.id);
    }

    if (!authUser) {
      console.error('  Could not resolve user.');
      continue;
    }

    await new Promise(r => setTimeout(r, 500));

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('id, role, application_status')
      .eq('id', authUser.id)
      .maybeSingle();

    if (profErr) {
      console.error('  profile lookup error:', profErr.message);
      continue;
    }

    if (!profile) {
      console.log('  Profile missing — inserting...');
      const { error: insErr } = await supabase.from('profiles').insert({
        id: authUser.id,
        first_name: u.meta.first_name,
        last_name: u.meta.last_name,
        role: u.role,
        account_type: u.meta.account_type,
        application_status: u.role === 'pwd' ? 'Not Submitted' : 'Approved',
      });
      if (insErr) console.error('  insert error:', insErr.message);
      else console.log('  Profile inserted with role:', u.role);
    } else if (profile.role !== u.role) {
      console.log(`  Updating role ${profile.role} -> ${u.role}`);
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ role: u.role })
        .eq('id', authUser.id);
      if (updErr) console.error('  update error:', updErr.message);
      else console.log('  Role updated.');
    } else {
      console.log('  Profile already correct.');
    }
  }

  console.log('\n=== Done ===');
  process.exit(0);
})();
