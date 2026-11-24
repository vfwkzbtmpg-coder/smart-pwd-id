import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { supabase } from '../supabaseClient';
import type { AdminUser } from '../types';
import { fetchCurrentAdminUser } from '../lib/adminQueries';

type AuthState = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextShape {
  state: AuthState;
  user: AdminUser | null;
  adminRole: string;
  login: (email: string, password: string) => Promise<{
    ok: boolean;
    code?: string | undefined;
    message: string;
  }>;
  logout: () => Promise<void>;
  refreshAdminProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextShape | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [state, setState] = useState<AuthState>('loading');

  const loadAdmin = useCallback(async () => {
    const u = await fetchCurrentAdminUser();
    setAdmin(u);
    setState(u ? 'authenticated' : 'unauthenticated');
  }, []);

  useEffect(() => {
    loadAdmin();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      if (!session?.user) {
        setAdmin(null);
        setState('unauthenticated');
        return;
      }
      await loadAdmin();
    });
    return () => subscription.unsubscribe();
  }, [loadAdmin]);

  const login = useCallback<AuthContextShape['login']>(async (email, password) => {
    const cleaned = {
      email: (email ?? '').trim(),
      password: (password ?? '').toString(),
    };
    if (!cleaned.email || !cleaned.password) {
      return { ok: false, message: 'Email and password are both required.' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned.email)) {
      return { ok: false, message: 'Please enter a valid email address.' };
    }
    if (cleaned.password.length < 6) {
      return { ok: false, message: 'Password must be at least 6 characters.' };
    }
    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleaned.email,
      password: cleaned.password,
    });
    if (error || !data?.user) {
      return {
        ok: false,
        code: error?.code,
        message: error?.message ?? 'Sign-in failed. Please try again.',
      };
    }
    const profile = await fetchCurrentAdminUser();
    setAdmin(profile);
    setState(profile ? 'authenticated' : 'unauthenticated');
    if (!profile) {
      await supabase.auth.signOut();
      return {
        ok: false,
        message: 'Your account does not have an administrator profile. Please contact a system admin.',
      };
    }
    if (!profile.isAdmin) {
      await supabase.auth.signOut();
      setAdmin(null);
      setState('unauthenticated');
      return {
        ok: false,
        message: 'Administrator access only. Your account is not permitted on this console.',
      };
    }
    return { ok: true, message: `Welcome back${profile.firstName ? `, ${profile.firstName}` : ''}!` };
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setAdmin(null);
    setState('unauthenticated');
  }, []);

  const value = useMemo<AuthContextShape>(
    () => ({
      state,
      user: admin,
      adminRole: admin?.role ?? '',
      login,
      logout,
      refreshAdminProfile: loadAdmin,
    }),
    [state, admin, login, logout, loadAdmin]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextShape {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    if (import.meta.env.PROD) {
      throw new Error('useAuth() must be used inside <AuthProvider>.');
    }
    console.warn(
      '[AuthContext] useAuth() returned undefined — this typically happens during Vite HMR context refresh. ' +
        'Falling back to safe defaults; reload the page if state becomes stale.'
    );
    const noop = async () => { /* no-op during HMR mismatch */ };
    return {
      state: 'loading',
      user: null,
      adminRole: '',
      login: async () => ({ ok: false, message: 'Auth context unavailable. Please reload the page.' }),
      logout: noop,
      refreshAdminProfile: noop,
    };
  }
  return ctx;
}
