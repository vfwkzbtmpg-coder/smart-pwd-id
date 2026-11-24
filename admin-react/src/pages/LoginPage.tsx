import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Spinner } from '../components/ui';
import { getAppTitle } from '../supabaseClient';

export default function LoginPage() {
  const { state, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<{ email?: string; password?: string } | null>(null);

  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
  const appTitle = getAppTitle();

  useEffect(() => {
    if (state === 'authenticated') {
      navigate(from, { replace: true });
    }
  }, [state, navigate, from]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);
    if (submitting) return;

    const errors: { email?: string; password?: string } = {};
    const cleanedEmail = email.trim();
    if (!cleanedEmail) errors.email = 'Email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedEmail)) errors.email = 'Enter a valid email.';
    if (!password) errors.password = 'Password is required.';
    else if (password.length < 6) errors.password = 'Password must be at least 6 characters.';
    if (Object.keys(errors).length) {
      setFieldError(errors);
      return;
    }

    setSubmitting(true);
    try {
      const result = await login(cleanedEmail, password);
      if (result.ok) {
        toast.success(result.message || 'Signed in');
        navigate(from, { replace: true });
      } else {
        toast.error('Sign in failed', result.message);
      }
    } catch {
      toast.error('Sign in failed', 'An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-stretch bg-white lg:bg-slate-50">
      {/* Left visual panel */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 text-white p-10 xl:p-14">
        <div className="relative z-10 flex flex-col justify-between w-full">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 backdrop-blur ring-1 ring-white/20 font-extrabold text-lg">
              ID
            </div>
            <div>
              <div className="text-lg font-extrabold tracking-tight">{appTitle}</div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Admin Console</div>
            </div>
          </div>

          <div className="max-w-md">
            <h1 className="text-4xl xl:text-5xl font-extrabold tracking-tight leading-tight">
              Review, approve, and manage PWD ID applications.
            </h1>
            <p className="mt-5 text-white/80 text-base leading-relaxed">
              A secure, role-based workspace for administrators to verify applications,
              leave review notes, and track status changes end-to-end.
            </p>

            <ul className="mt-8 space-y-3 text-sm">
              {[
                'Live Supabase authentication with admin role enforcement',
                'Dashboard counts and searchable applications list',
                'Status transitions with confirmation dialogs & audit notes',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/30">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
                      <path d="m9 16.2-3.5-3.5L4 14.2 9 19.2 20 8.2 18.5 6.7Z" fill="currentColor" />
                    </svg>
                  </span>
                  <span className="text-white/85">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="text-xs text-white/60">
            © {new Date().getFullYear()} {appTitle}. Admin-only access.
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white font-extrabold">
              ID
            </div>
            <div>
              <div className="text-base font-extrabold text-slate-900">{appTitle}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Admin Console</div>
            </div>
          </div>

          <h1 className="h1">Sign in as Administrator</h1>
          <p className="mt-2 text-sm text-slate-600">
            Only accounts with the <span className="font-semibold text-slate-800">admin</span> role can access this console.
          </p>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit} noValidate>
            <div>
              <label htmlFor="email" className="label">Work email</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!fieldError?.email}
                aria-describedby={fieldError?.email ? 'email-error' : undefined}
                placeholder="admin@example.gov.ph"
                className="input"
              />
              {fieldError?.email && (
                <p id="email-error" className="mt-1.5 text-xs font-medium text-rose-600">{fieldError.email}</p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="label mb-0">Password</label>
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <div className="mt-1.5 relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={!!fieldError?.password}
                  aria-describedby={fieldError?.password ? 'password-error' : undefined}
                  placeholder="••••••••"
                  className="input pr-11"
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-slate-400">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                    {showPassword ? (
                      <path d="M2 4.27 3.28 3 21 20.72 19.73 22l-2.78-2.78A11.3 11.3 0 0 1 12 20C6 20 1.73 13.75.36 12.4a1.6 1.6 0 0 1 0-1.6 11.5 11.5 0 0 1 4.96-5.94L2 4.27ZM6.3 8.08A9.4 9.4 0 0 0 2.8 11a10.1 10.1 0 0 0 9.2 5.5 9.3 9.3 0 0 0 3.98-.89L13.7 14.3a3 3 0 0 1-3.98-3.98L6.3 8.08ZM12 6a6 6 0 0 1 6 6 6 6 0 0 1-.1 1.15l1.56 1.56A8 8 0 0 0 12 4a8 8 0 0 0-2.79.5l1.55 1.56A6 6 0 0 1 12 6Zm0 3a3 3 0 0 0-2.12.87L14.13 14.1A3 3 0 0 0 12 9Z" fill="currentColor" />
                    ) : (
                      <path d="M12 5a7 7 0 0 1 7 7 7 7 0 0 1-7 7 7 7 0 0 1-7-7 7 7 0 0 1 7-7m0-3a10 10 0 0 0-10 10 10 10 0 0 0 10 10 10 10 0 0 0 10-10A10 10 0 0 0 12 2Zm0 5a5 5 0 1 0 5 5 5 5 0 0 0-5-5Z" fill="currentColor" />
                    )}
                  </svg>
                </div>
              </div>
              {fieldError?.password && (
                <p id="password-error" className="mt-1.5 text-xs font-medium text-rose-600">{fieldError.password}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting || state === 'loading'}
              className="btn-primary w-full !py-3 text-base"
            >
              {submitting || state === 'loading' ? (
                <>
                  <Spinner size="sm" />
                  {submitting ? 'Signing in…' : 'Verifying…'}
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          <div className="mt-8 rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4 text-xs text-slate-600 leading-relaxed">
            <div className="font-semibold text-slate-800 mb-1">Locked out?</div>
            Make sure:
            <ul className="mt-2 list-disc pl-4 space-y-0.5">
              <li>Supabase credentials match an <span className="font-semibold">auth.users</span> record.</li>
              <li>A matching <span className="font-semibold">public.profiles</span> row exists with role = <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">admin</span>.</li>
              <li>RLS policies in <span className="font-mono">004_rls_admin_applications.sql</span> are applied.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
