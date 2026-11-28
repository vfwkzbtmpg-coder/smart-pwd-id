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

declare global {
  interface Window {
    supabase?: SupabaseClient<Database>;
  }
}

/**
 * A production build has no server/server.js, so main.tsx loads
 * src/lib/api-client.js to answer /api/* in the browser. That shim takes the
 * client from window.supabase — the same global the static portal's pages
 * install — and throws "The Supabase client is not available on this page."
 * when it finds nothing there. The module import above is invisible to it, so
 * the instance is published here; every shimmed request (approve, reject,
 * review notes, messages, NFC card) needs it.
 */
window.supabase = supabase;

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
