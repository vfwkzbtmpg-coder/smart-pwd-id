import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

type ToastKind = 'success' | 'error' | 'info' | 'warning';
interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string | undefined;
  timeoutMs: number;
}

interface ToastContextShape {
  show: (t: Omit<Toast, 'id' | 'timeoutMs'> & { timeoutMs?: number | undefined }) => void;
  success: (title: string, message?: string | undefined) => void;
  error: (title: string, message?: string | undefined) => void;
  info: (title: string, message?: string | undefined) => void;
  warn: (title: string, message?: string | undefined) => void;
  remove: (id: number) => void;
}

const ToastContext = createContext<ToastContextShape | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(1);

  const remove = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const show = useCallback<ToastContextShape['show']>((t) => {
    const id = nextIdRef.current++;
    const timeoutMs = t.timeoutMs ?? (t.kind === 'error' ? 6500 : 3800);
    setToasts((prev) => [...prev, { id, kind: t.kind, title: t.title, message: t.message, timeoutMs }]);
    if (timeoutMs > 0) {
      setTimeout(() => remove(id), timeoutMs);
    }
  }, [remove]);

  const value = useMemo<ToastContextShape>(
    () => ({
      show,
      remove,
      success: (title, message) => show({ kind: 'success', title, message }),
      error: (title, message) => show({ kind: 'error', title, message }),
      info: (title, message) => show({ kind: 'info', title, message }),
      warn: (title, message) => show({ kind: 'warning', title, message }),
    }),
    [show, remove]
  );

  const colorMap: Record<ToastKind, string> = {
    success: 'bg-emerald-600',
    error: 'bg-rose-600',
    info: 'bg-brand-600',
    warning: 'bg-amber-500',
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(100vw-2rem,22rem)] flex-col gap-3 safe-pt-nav"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto animate-[slideIn_180ms_ease-out] rounded-xl bg-white shadow-xl ring-1 ring-slate-200 overflow-hidden"
          >
            <div className={`h-1 w-full ${colorMap[t.kind]}`} />
            <div className="flex items-start gap-3 p-4">
              <div
                className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${colorMap[t.kind]}`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-900">{t.title}</div>
                {t.message && <div className="mt-0.5 text-sm text-slate-600">{t.message}</div>}
              </div>
              <button
                type="button"
                onClick={() => remove(t.id)}
                className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Dismiss"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <path
                    d="M6.22 6.22a.75.75 0 0 1 1.06 0L12 10.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L13.06 12l4.72 4.72a.75.75 0 1 1-1.06 1.06L12 13.06l-4.72 4.72a.75.75 0 0 1-1.06-1.06L10.94 12 6.22 7.28a.75.75 0 0 1 0-1.06Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
      <style>{`@keyframes slideIn { from { opacity: 0; transform: translateY(-6px);} to { opacity: 1; transform: none;} }`}</style>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextShape {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    if (import.meta.env.PROD) {
      throw new Error('useToast() must be used inside <ToastProvider>.');
    }
    console.warn(
      '[ToastContext] useToast() returned undefined — this typically happens during Vite HMR context refresh. ' +
        'Falling back to no-op toasts; reload for full functionality.'
    );
    const noop = () => { /* no-op during HMR mismatch */ };
    return {
      show: noop,
      success: noop,
      error: noop,
      info: noop,
      warn: noop,
      remove: noop,
    };
  }
  return ctx;
}
