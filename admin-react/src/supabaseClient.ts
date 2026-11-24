import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const SUPABASE_PUBLISHABLE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();

/**
 * Supabase client used by the admin React site.
 * NOTE: We deliberately uses ** publishable / anon key ONLY.
 *       NEVER use service_role in any file that ships to the browser.
 */
export const supabase: SupabaseClient<Database> = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export function assertEnv() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return false;
  }
  return true;
}

export function getAppTitle(): string {
  return (import.meta.env.VITE_APP_TITLE as string | undefined) || 'Smart PWD ID Admin Console';
}

export { SUPABASE_URL };
