import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Spinner, ConfirmDialog } from './ui';
import { getAppTitle } from '../supabaseClient';

const navItems = [
  {
    to: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <path d="M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z" fill="currentColor" />
      </svg>
    ),
  },
  {
    to: '/applications',
    label: 'Applications',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm4 18H6V4h7v5h5Z" fill="currentColor" />
      </svg>
    ),
  },
];

export default function AppLayout() {
  const { user, logout, state } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const appTitle = getAppTitle();

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      toast.success('Signed out', 'You have been logged out of the admin console.');
      navigate('/login', { replace: true });
    } catch (e) {
      toast.error('Sign-out failed', 'Please try again.');
    } finally {
      setLoggingOut(false);
      setConfirmOpen(false);
    }
  };

  const initials = (() => {
    const f = (user?.firstName ?? '').trim().charAt(0).toUpperCase();
    const l = (user?.lastName ?? '').trim().charAt(0).toUpperCase();
    if (f || l) return f + l;
    return (user?.email ?? 'A').trim().charAt(0).toUpperCase();
  })();

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 lg:border-r lg:border-slate-200 lg:bg-white">
        <div className="flex items-center gap-3 px-6 h-16 border-b border-slate-200">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white font-extrabold text-sm shadow-sm">
            ID
          </div>
          <div className="min-w-0">
            <div className="text-sm font-extrabold tracking-tight text-slate-900 truncate">{appTitle}</div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Admin Console</div>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                [
                  'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all',
                  isActive
                    ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-100'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                ].join(' ')
              }
            >
              <span className={state === 'authenticated' ? '' : 'opacity-60'}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-200">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-bold text-sm">
              {initials || 'A'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-900 truncate">
                {user?.firstName || user?.lastName
                  ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
                  : user?.email ?? 'Administrator'}
              </div>
              <div className="text-xs text-slate-500 truncate">{user?.email ?? '—'}</div>
            </div>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="btn-ghost !p-2"
              title="Sign out"
              aria-label="Sign out"
            >
              {loggingOut ? (
                <Spinner size="sm" />
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                  <path d="M5 21h7v-2H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2Zm11.17-9L13.5 8.33 14.92 6.91 20 12l-5.08 5.09L13.5 15.67 16.17 13H8v-2Z" fill="currentColor" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Top Bar */}
      <header className="lg:hidden sticky top-0 z-30 bg-white border-b border-slate-200 safe-pt-nav">
        <div className="flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white font-extrabold text-xs">
              ID
            </div>
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-slate-900 truncate">{appTitle}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Admin</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="btn-ghost !p-2"
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
              {menuOpen ? (
                <path d="M6.22 6.22a.75.75 0 0 1 1.06 0L12 10.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L13.06 12l4.72 4.72a.75.75 0 1 1-1.06 1.06L12 13.06l-4.72 4.72a.75.75 0 0 1-1.06-1.06L10.94 12 6.22 7.28a.75.75 0 0 1 0-1.06Z" fill="currentColor"/>
              ) : (
                <path d="M3 6h18v2H3Zm0 5h18v2H3Zm0 5h18v2H3Z" fill="currentColor"/>
              )}
            </svg>
          </button>
        </div>
        {menuOpen && (
          <div className="border-t border-slate-200 bg-white">
            <nav className="p-3 space-y-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    [
                      'group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold',
                      isActive
                        ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-100'
                        : 'text-slate-700 hover:bg-slate-50',
                    ].join(' ')
                  }
                >
                  {item.icon}
                  {item.label}
                </NavLink>
              ))}
              <div className="pt-2 mt-2 border-t border-slate-100 flex items-center gap-3 px-2 py-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-bold text-sm">
                  {initials || 'A'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-900 truncate">
                    {user?.firstName || user?.lastName
                      ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
                      : user?.email ?? 'Administrator'}
                  </div>
                  <div className="text-xs text-slate-500 truncate">{user?.email ?? '—'}</div>
                </div>
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); setConfirmOpen(true); }}
                  className="btn-secondary !py-2 !px-3 text-xs"
                >
                  Sign out
                </button>
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* Main content area */}
      <main className="flex-1 lg:pl-64 min-w-0">
        <div className="px-4 py-5 sm:px-6 lg:px-8 lg:py-8 safe-pb-tabbar">
          <Outlet />
        </div>
      </main>

      <ConfirmDialog
        open={confirmOpen}
        title="Sign out?"
        description="You will need to enter your credentials again to access the admin console."
        confirmLabel={loggingOut ? 'Signing out…' : 'Sign out'}
        cancelLabel="Stay signed in"
        loading={loggingOut}
        onConfirm={handleLogout}
        onCancel={() => !loggingOut && setConfirmOpen(false)}
      />
    </div>
  );
}
