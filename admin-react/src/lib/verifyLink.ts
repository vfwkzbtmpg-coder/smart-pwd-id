import QRCode from 'qrcode';

/**
 * Everything that turns a PWD ID number into something a phone can open.
 *
 * The verification page lives on the Express site (server/server.js serves
 * public/), NOT on the console, so the address has to be one the phone can
 * actually reach — "localhost" means the phone itself and will never work.
 * The address is a per-installation setting the admin types once; it is kept
 * in localStorage so every card in the console builds the same link.
 */
const STORAGE_KEY = 'smartpwd.verifyBaseUrl';

/** Used until the admin saves an address of their own. */
export const DEFAULT_VERIFY_BASE = 'http://localhost:4000';

function trimBase(value: string): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function getVerifyBaseUrl(): string {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && saved.trim()) return trimBase(saved);
  } catch {
    /* private browsing — fall through to the default */
  }
  return DEFAULT_VERIFY_BASE;
}

export function saveVerifyBaseUrl(value: string): string {
  const clean = trimBase(value);
  try {
    if (clean) window.localStorage.setItem(STORAGE_KEY, clean);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* not fatal — the link is still built from the value that was typed */
  }
  return clean || DEFAULT_VERIFY_BASE;
}

/** True when the address can only ever be opened on this PC. */
export function isLocalOnly(baseUrl: string): boolean {
  return /(^|\/\/)(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(String(baseUrl || ''));
}

/**
 * The link a QR code prints and an NFC tag stores. verify.html reads `id` back
 * out of the query string and verifies it on load, so a tap needs no typing.
 *
 * `token` is the holder's profiles.qr_token. It is what makes the code
 * unforgeable: an ID number is guessable, the token is not, and Approve /
 * Reject reissues it so a photocopied card stops working at the next decision.
 * It is omitted when migration 012 has not been run, which keeps the old
 * ID-number-only links working.
 */
export function buildVerifyLink(baseUrl: string, idNumber: string, token?: string | null): string {
  const id = String(idNumber || '').trim();
  if (!id) return '';
  const base = trimBase(baseUrl) || DEFAULT_VERIFY_BASE;
  const link = `${base}/verify.html?id=${encodeURIComponent(id)}`;
  const secret = String(token || '').trim();
  return secret ? `${link}&t=${encodeURIComponent(secret)}` : link;
}

/**
 * Rendered as a standalone SVG string rather than a canvas so the same markup
 * can be dropped inside the printed card and downloaded as a file. Uses the
 * console's own build of the qrcode package — no CDN needed.
 */
export async function verifyQrSvg(text: string): Promise<string> {
  if (!text) return '';
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    color: { dark: '#152a47', light: '#ffffff' },
  });
}
