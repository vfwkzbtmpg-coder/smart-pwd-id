import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { Spinner } from './ui';

/**
 * The applicant's private 1:1 line to the office — the React console twin of the
 * "Messages" card in legacy public/applications.html.
 *
 * Both endpoints require a verified Supabase token; the sender role is decided
 * server-side from that token, never from anything this component sends.
 */

interface Message {
  id: string;
  userId: string;
  senderRole: string;
  body: string;
  createdAt: string | null;
}

/** Standard staff messages, wording kept identical to applications.html. */
const PRESETS: Array<{ key: string; label: string; hint: string; body: string }> = [
  {
    key: 'a',
    label: 'Message A — Document correction',
    hint: 'Action needed for your application',
    body:
      'Subject: Action needed for your application\n' +
      'Your application needs a correction before staff can finish reviewing it. Please sign in to Smart PWD NFC Verify to see which document needs attention. You can submit the correction online; please wait for further instructions before travelling to City Hall.',
  },
  {
    key: 'b',
    label: 'Message B — Review complete',
    hint: 'Documents passed initial screening',
    body:
      'Your submitted documents have passed the initial screening and have been reviewed by authorized staff. Your application is ready for the next verification step. Please follow the appointment instructions in your account. This is not yet an approval of your PWD application.',
  },
  {
    key: 'c',
    label: 'Message C — Appointment confirmed',
    hint: 'City Hall appointment details',
    body:
      'Your City Hall appointment is confirmed. Please check your account for the date, time, official office location, reference number, and required original documents. If you cannot attend, reschedule before travelling.',
  },
];

interface Props {
  /** The applicant's profile uuid — the thread is keyed on this. */
  userId: string;
  applicantName: string;
}

function when(v: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toLocaleString();
}

export default function MessagesThread({ userId, applicantName }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>('');
  const [text, setText] = useState('');
  const [presetKey, setPresetKey] = useState<string>('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>('');
  const threadRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      setLoadError('This application has no linked account, so it has no message thread.');
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? '';
      const res = await fetch(`/api/messages?user_id=${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || !json.ok) {
        throw new Error((json && json.message) || 'Could not load the conversation.');
      }
      setMessages(Array.isArray(json.messages) ? json.messages : []);
    } catch (err) {
      setLoadError((err as Error)?.message || 'Could not load the conversation.');
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const pickPreset = (p: (typeof PRESETS)[number]) => {
    setPresetKey(p.key);
    setText(p.body);
  };

  const handleSend = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError('');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? '';
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId, body }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || !json.ok) {
        throw new Error((json && json.message) || 'Could not send the message.');
      }
      setText('');
      setPresetKey('');
      await load();
    } catch (err) {
      setSendError((err as Error)?.message || 'Could not send the message.');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="card p-5 sm:p-6" aria-label="Messages">
      <div className="flex items-center justify-between gap-3">
        <h2 className="h3">Messages</h2>
        <button
          type="button"
          className="btn-ghost !px-2 !py-1 text-xs"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? <Spinner size="sm" /> : null}
          Refresh
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Private thread with {applicantName || 'this applicant'}. Replies appear on their dashboard only.
      </p>

      <div
        ref={threadRef}
        className="mt-4 h-72 space-y-3 overflow-y-auto rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"
        aria-live="polite"
      >
        {loading && !messages.length ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading conversation…</p>
        ) : loadError ? (
          <p className="py-8 text-center text-sm text-rose-600">{loadError}</p>
        ) : !messages.length ? (
          <p className="py-8 text-center text-sm text-slate-500">
            No messages yet. The applicant has not written to the office.
          </p>
        ) : (
          messages.map((m) => {
            const fromAdmin = m.senderRole === 'admin';
            return (
              <div key={m.id} className={`flex ${fromAdmin ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[85%]">
                  <div
                    className={
                      fromAdmin
                        ? 'rounded-2xl rounded-br-sm bg-brand-600 px-3.5 py-2 text-sm text-white shadow-sm'
                        : 'rounded-2xl rounded-bl-sm bg-white px-3.5 py-2 text-sm text-slate-800 ring-1 ring-slate-200 shadow-sm'
                    }
                  >
                    <span className="whitespace-pre-wrap break-words">{m.body}</span>
                  </div>
                  <div
                    className={`mt-1 text-[11px] text-slate-500 ${fromAdmin ? 'text-right' : 'text-left'}`}
                  >
                    {fromAdmin ? 'PWD Admin' : applicantName || 'Applicant'} · {when(m.createdAt)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-4">
        <span className="kicker">Standard staff messages</span>
        <div className="mt-2 grid grid-cols-1 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => pickPreset(p)}
              className={`rounded-lg bg-white px-3 py-2 text-left ring-1 transition-all hover:bg-slate-50 ${
                presetKey === p.key ? 'ring-2 ring-orange-400' : 'ring-slate-200'
              }`}
            >
              <span className="block text-xs font-semibold text-slate-800">{p.label}</span>
              <span className="block text-[11px] text-slate-500">{p.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="msg-reply" className="sr-only">Reply to the applicant</label>
        <textarea
          id="msg-reply"
          rows={3}
          maxLength={4000}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // Hand-editing means it is no longer the chosen template.
            setPresetKey('');
          }}
          placeholder={`Reply to ${applicantName || 'the applicant'}…`}
          className="input resize-y"
        />
        {sendError && <p className="mt-2 text-xs text-rose-600">{sendError}</p>}
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">{text.length} / 4000</span>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleSend()}
            disabled={sending || !text.trim()}
          >
            {sending && <Spinner size="sm" />}
            {sending ? 'Sending…' : 'Send reply'}
          </button>
        </div>
      </div>
    </section>
  );
}
