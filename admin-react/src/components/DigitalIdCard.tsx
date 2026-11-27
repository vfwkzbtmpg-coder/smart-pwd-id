import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { fmtBirthdate, fmtDay, saveCardBackground, unlinkNfcCard } from '../lib/adminQueries';
import {
  buildVerifyLink,
  getVerifyBaseUrl,
  isLocalOnly,
  saveVerifyBaseUrl,
  verifyQrSvg,
} from '../lib/verifyLink';
import type { DigitalIdCardData } from '../types';
import type { ApplicationStatusUi } from '../../config/dbSchemaConfig';
import { ConfirmDialog } from './ui';
import './DigitalIdCard.css';

/**
 * The LGU background PNGs are served from the site root, one level above the
 * /admin/ sub-path this console is published under on GitHub Pages. BASE_URL is
 * '/smart-pwd-id/admin/' there and '/' in dev, so '../backgrounds/' resolves to
 * /smart-pwd-id/backgrounds/ and /backgrounds/ respectively.
 */
const BACKGROUND_BASE = `${import.meta.env.BASE_URL}../backgrounds/`;

/**
 * One tile per Metro Manila LGU, backed by a file in public/backgrounds/ named
 * after the city. The slug is what gets stored on the application row, so the
 * cardholder's own dashboard renders the identical card.
 */
const PLACES: Array<[string, string]> = [
  ['Caloocan', 'caloocan'],
  ['Las Piñas', 'las-pinas'],
  ['Makati', 'makati'],
  ['Malabon', 'malabon'],
  ['Mandaluyong', 'mandaluyong'],
  ['Manila (Regional Center)', 'manila'],
  ['Marikina', 'marikina'],
  ['Muntinlupa', 'muntinlupa'],
  ['Navotas', 'navotas'],
  ['Parañaque', 'paranaque'],
  ['Pasay', 'pasay'],
  ['Pasig', 'pasig'],
  ['Quezon City', 'quezon-city'],
  ['San Juan', 'san-juan'],
  ['Taguig', 'taguig'],
  ['Valenzuela', 'valenzuela'],
];

interface Props {
  appId: string;
  /** The application's user_id — the profile the NFC reader binds the card to. */
  userId: string;
  status: ApplicationStatusUi;
  card: DigitalIdCardData;
  /** Printed on the emergency line when no separate emergency number exists. */
  contactFallback?: string | null;
  /** Lets the page refresh the row after a background pick is persisted. */
  onBackgroundSaved?: (slug: string) => void;
}

interface NfcState {
  ok?: boolean;
  enrolling?: boolean;
  enrollName?: string;
  serial?: { connected?: boolean; message?: string };
  last?: { seq?: number; status?: string; name?: string; error?: string } | null;
}

function readImageFile(file: File | undefined, onDone: (dataUrl: string) => void) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => onDone(String(reader.result));
  reader.readAsDataURL(file);
}

/**
 * The applicant's digital PWD ID, built with the approved card design.
 * Markup, class names and animations are the design's own; only the values are
 * bound to live data. Flip, drag-to-rotate, background/signature/photo
 * overrides, print and the "Reader NFC Scan" control all behave exactly as
 * they do on the legacy admin pages.
 */
export default function DigitalIdCard({
  appId,
  userId,
  status,
  card,
  contactFallback,
  onBackgroundSaved,
}: Props) {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const backBgInputRef = useRef<HTMLInputElement>(null);
  const sigInputRef = useRef<HTMLInputElement>(null);

  const [flipped, setFlipped] = useState(false);
  const [angle, setAngle] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ x: 0, y: 0, rotX: 0, rotY: 0 });

  const [photoOverride, setPhotoOverride] = useState('');
  const [signatureOverride, setSignatureOverride] = useState('');
  const [backBackground, setBackBackground] = useState('');

  const [bgFront, setBgFront] = useState(card.bgFront || '');
  const [bgMissing, setBgMissing] = useState<Record<string, boolean>>({});
  const [showBgGrid, setShowBgGrid] = useState(false);
  const [bgNote, setBgNote] = useState<{ text: string; error: boolean } | null>(null);

  const [nfcNote, setNfcNote] = useState<{ text: string; tone: '' | 'busy' | 'error' } | null>(null);
  const [nfcArmed, setNfcArmed] = useState(false);
  const nfcTimer = useRef<number | null>(null);
  const nfcArmedSeq = useRef<number | null>(null);

  const [baseUrl, setBaseUrl] = useState(() => getVerifyBaseUrl());
  const [qrSvg, setQrSvg] = useState('');
  const [linkNote, setLinkNote] = useState<{ text: string; error: boolean } | null>(null);

  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  // Only an approved application carries an ID number, and the verify endpoint
  // refuses anything else — so the QR and the NFC link exist only from there on.
  // The token makes the code unforgeable; Approve / Reject replaces it.
  const verifyLink = buildVerifyLink(baseUrl, card.idNumber, card.qrToken);

  useEffect(() => {
    if (!verifyLink) {
      setQrSvg('');
      return;
    }
    let alive = true;
    verifyQrSvg(verifyLink)
      .then((svg) => {
        if (alive) setQrSvg(svg);
      })
      .catch(() => {
        if (alive) setQrSvg('');
      });
    return () => {
      alive = false;
    };
  }, [verifyLink]);

  const saveBase = () => {
    const saved = saveVerifyBaseUrl(baseUrl);
    setBaseUrl(saved);
    setLinkNote({ text: `Verification address saved: ${saved}`, error: false });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(verifyLink);
      setLinkNote({
        text: 'Link copied — paste it into your NFC writer app as a URL record.',
        error: false,
      });
    } catch {
      setLinkNote({ text: 'Copy was blocked. Select the link and copy it manually.', error: true });
    }
  };

  const downloadQr = () => {
    if (!qrSvg) return;
    const href = URL.createObjectURL(new Blob([qrSvg], { type: 'image/svg+xml' }));
    const a = document.createElement('a');
    a.href = href;
    a.download = `pwd-qr-${card.idNumber || 'card'}.svg`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  const reducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const showBack = (value: boolean) => {
    setFlipped(value);
    setAngle({ x: 0, y: 0 });
  };

  const cardStyle: CSSProperties = {
    transform: `rotateX(${angle.x}deg) rotateY(${angle.y + (flipped ? 180 : 0)}deg)`,
    transition: dragging || reducedMotion() ? 'none' : 'transform .85s cubic-bezier(.2,.75,.25,1)',
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    setDragging(true);
    drag.current = { x: e.clientX, y: e.clientY, rotX: angle.x, rotY: angle.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setAngle({
      y: drag.current.rotY + (e.clientX - drag.current.x) * 0.65,
      x: Math.max(-22, Math.min(22, drag.current.rotX - (e.clientY - drag.current.y) * 0.35)),
    });
  };

  const finishDrag = () => {
    if (!dragging) return;
    setDragging(false);
    if (Math.abs(angle.y) > 90) setFlipped((f) => !f);
    setAngle({ x: 0, y: 0 });
  };

  const frontStyle: CSSProperties = bgFront
    ? {
        backgroundImage: `url("${BACKGROUND_BASE}${bgFront}.png")`,
        backgroundSize: '100% 100%',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }
    : {};

  const backStyle: CSSProperties = backBackground
    ? {
        backgroundImage: `url("${backBackground}")`,
        backgroundSize: '100% 100%',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }
    : {};

  /**
   * The pick is persisted immediately — waiting for Approve would lose the
   * choice if the admin closed the page, and a background-only save leaves the
   * application's status untouched.
   */
  const pickBackground = async (slug: string) => {
    if (bgMissing[slug]) return;
    setBgFront(slug);
    setBgNote({ text: 'Saving background…', error: false });
    const res = await saveCardBackground(appId, slug);
    if (res.ok) {
      setBgNote({
        text: "Saved — this background now appears on the cardholder's dashboard once the application is approved.",
        error: false,
      });
      onBackgroundSaved?.(slug);
    } else {
      setBgNote({
        text: 'Could not save the background: ' + (res.error?.message || 'please try again.'),
        error: true,
      });
    }
  };

  const stopNfcPolling = useCallback(() => {
    if (nfcTimer.current !== null) {
      window.clearInterval(nfcTimer.current);
      nfcTimer.current = null;
    }
    nfcArmedSeq.current = null;
    setNfcArmed(false);
  }, []);

  useEffect(() => stopNfcPolling, [stopNfcPolling]);

  const nfcState = async (): Promise<NfcState> => {
    const res = await fetch('/api/nfc/state');
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !json.ok) {
      throw new Error((json && json.message) || 'Could not reach the NFC reader service.');
    }
    return json as NfcState;
  };

  const pollNfc = async () => {
    let st: NfcState;
    try {
      st = await nfcState();
    } catch (err) {
      stopNfcPolling();
      setNfcNote({ text: (err as Error)?.message || 'Lost contact with the NFC reader.', tone: 'error' });
      return;
    }
    if (st.enrolling) return;
    // A tap that happened before the reader was armed must not be reported as
    // this card.
    const seq = st.last?.seq ?? 0;
    const tap = st.last && (nfcArmedSeq.current === null || seq > nfcArmedSeq.current) ? st.last : null;
    stopNfcPolling();
    if (tap && tap.status === 'enrolled') {
      setNfcNote({
        text: `Card linked to ${tap.name || card.name || 'this holder'}. The reader now verifies it as a valid PWD ID.`,
        tone: '',
      });
    } else if (tap && tap.error) {
      setNfcNote({ text: tap.error, tone: 'error' });
    } else {
      setNfcNote({ text: 'No card was linked. Press the button again and tap the new card.', tone: 'error' });
    }
  };

  const armReader = async () => {
    setNfcArmed(true);
    setNfcNote({ text: '', tone: '' });
    try {
      const res = await fetch('/api/nfc/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || !json.ok) {
        throw new Error((json && json.message) || 'Could not arm the NFC reader.');
      }
      let armed: NfcState | null = null;
      try {
        armed = await nfcState();
      } catch {
        /* the poll below reports the failure in the UI */
      }
      nfcArmedSeq.current = armed?.last?.seq ?? 0;
      if (armed && armed.serial && armed.serial.connected === false) {
        setNfcNote({
          text: `The reader is not connected (${armed.serial.message || 'no ESP32 on USB'}). Plug it in, then tap the card.`,
          tone: 'error',
        });
      } else {
        setNfcNote({
          text: `Reader armed for ${json.name || card.name || 'this holder'}. Tap the new card on the reader now.`,
          tone: 'busy',
        });
      }
      nfcTimer.current = window.setInterval(() => void pollNfc(), 1500);
    } catch (err) {
      stopNfcPolling();
      setNfcNote({ text: (err as Error)?.message || 'Could not arm the NFC reader.', tone: 'error' });
    }
  };

  const cancelScan = async () => {
    stopNfcPolling();
    setNfcNote({ text: 'Scan cancelled. No card was linked.', tone: '' });
    try {
      await fetch('/api/nfc/enroll/cancel', { method: 'POST' });
    } catch {
      /* nothing to recover — the reader is left disarmed either way */
    }
  };

  /**
   * The "my card was lost or stolen" counter action. Detaching the tag is what
   * actually stops someone else tapping it, so this is separate from the QR
   * token that Approve / Reject rotates.
   */
  const removeLostCard = async () => {
    setUnlinking(true);
    const result = await unlinkNfcCard(userId);
    setUnlinking(false);
    setConfirmUnlink(false);
    setNfcNote({
      text: result.ok
        ? 'Lost card detached. The old tag no longer verifies — run Reader NFC Scan to issue the replacement.'
        : result.message,
      tone: result.ok ? '' : 'error',
    });
  };

  const photoSrc = photoOverride || card.photoUrl;
  const signatureSrc = signatureOverride || card.signatureUrl;

  return (
    <div id="idCardPreview">
      <div
        className={`stage${dragging ? ' dragging' : ''}`}
      >
        <div className="card-intro">
          <div className="card-float">
            <div
              className="card"
              tabIndex={0}
              role="button"
              aria-label={`3D sample ID card, ${flipped ? 'back' : 'front'} side facing. Drag or touch to rotate. Press Enter or Space to flip.`}
              style={cardStyle}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  showBack(!flipped);
                }
              }}
            >
              <section className="face front" aria-label="Front of sample card" style={frontStyle}>
                <div className="content">
                  <div className="left">
                    <label className="photo" htmlFor={`photoInput-${appId}`}>
                      {photoSrc ? (
                        <img src={photoSrc} alt="Applicant photo" />
                      ) : (
                        <>
                          Click Upload Photo
                          <br />
                          to add sample image
                        </>
                      )}
                    </label>
                    <div className="signature">
                      <div className="sigline">
                        {signatureSrc ? (
                          <img src={signatureSrc} alt="Applicant signature" />
                        ) : (
                          <span>signature here</span>
                        )}
                      </div>
                      SIGNATURE
                    </div>
                  </div>
                  <div className="fields">
                    <div className="field">
                      <label>ID NO:</label>
                      <div className="value">{card.idNumber || 'PENDING'}</div>
                    </div>
                    <div className="field">
                      <label>NAME:</label>
                      <div className="value">{String(card.name || '—').toUpperCase()}</div>
                    </div>
                    <div className="field">
                      <label>TYPE OF DISABILITY:</label>
                      <div className="value">{card.disabilityType || '—'}</div>
                    </div>
                    <div className="field">
                      <label>DATE OF BIRTH:</label>
                      <div className="value small">{fmtBirthdate(card.birthdate)}</div>
                    </div>
                    <div className="field">
                      <label>SEX:</label>
                      <div className="value">{card.sex || '—'}</div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="face back" aria-label="Back of sample card" style={backStyle}>
                <div className="notice">
                  THE HOLDER OF THIS CARD IS A PERSON WITH DISABILITY AND IS ENTITLED TO ALL BENEFITS AND
                  PRIVILEGES IN ACCORDANCE WITH REPUBLIC ACTS 9442 AND 10754 NON-TRANSFERABLE. VALID FOR 3
                  YEARS.
                  <br />
                  ANY VIOLATION IS PUNISHABLE BY LAW. VALID ANYWHERE IN THE PHILIPPINES.
                </div>
                <div className="backmid">
                  <div className="backbox">
                    <div className="backtitle">IN CASE OF EMERGENCY, PLEASE NOTIFY:</div>
                    <div className="backfields">
                      <div className="backfield">
                        Name:<span className="blank">{card.emergencyName}</span>
                      </div>
                      <div className="backfield">
                        Contact No.:
                        <span className="blank">{card.emergencyContact || contactFallback || ''}</span>
                      </div>
                      <div className="backfield">
                        Address:<span className="blank">{card.address}</span>
                      </div>
                      <div className="backfield">
                        Blood type:<span className="blank">{card.bloodType}</span>
                      </div>
                      <div className="backfield">
                        Date issued:<span className="blank">{fmtDay(card.dateIssued)}</span>
                      </div>
                      <div className="backfield">
                        Valid until:<span className="blank">{fmtDay(card.validUntil)}</span>
                      </div>
                    </div>
                    <div className="auth">
                      ____________________________
                      <br />
                      AUTHORIZED SIGNATURE (DEMO)
                    </div>
                  </div>

                  {/* The printed QR. It carries the same link the NFC tag gets, so
                      one link serves both a camera scan and a phone tap. */}
                  <div className="backqr">
                    {qrSvg ? (
                      <div className="backqr-code" dangerouslySetInnerHTML={{ __html: qrSvg }} />
                    ) : (
                      <div className="backqr-code backqr-empty">{card.idNumber ? '…' : 'QR'}</div>
                    )}
                    <div className="backqr-cap">SCAN TO VERIFY</div>
                  </div>
                </div>
                <div className="foot">
                  DEMO DESIGN ONLY • NOT VALID FOR IDENTIFICATION OR DISCOUNT VERIFICATION
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>

      <div className="controls">
        <button type="button" onClick={() => showBack(!flipped)}>
          Flip Front / Back
        </button>
        <button type="button" className="secondary" onClick={() => showBack(false)}>
          Show Front
        </button>
        <button type="button" className="secondary" onClick={() => showBack(true)}>
          Show Back
        </button>
        <button type="button" className="secondary" onClick={() => window.print()}>
          Print Demo
        </button>
        <button type="button" className="secondary" onClick={() => photoInputRef.current?.click()}>
          Upload Sample Photo
        </button>
        <input
          id={`photoInput-${appId}`}
          ref={photoInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => readImageFile(e.target.files?.[0], setPhotoOverride)}
        />
        <button type="button" className="secondary" onClick={() => setShowBgGrid((v) => !v)}>
          Choose Front Background
        </button>
        <button type="button" className="secondary" onClick={() => backBgInputRef.current?.click()}>
          Upload Back Background
        </button>
        <input
          ref={backBgInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => {
            const input = e.target;
            readImageFile(input.files?.[0], setBackBackground);
          }}
        />
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setBgFront('');
            void pickBackground('');
          }}
        >
          Clear Front Bg
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setBackBackground('');
            if (backBgInputRef.current) backBgInputRef.current.value = '';
          }}
        >
          Clear Back Bg
        </button>
        <button type="button" className="secondary" onClick={() => sigInputRef.current?.click()}>
          Upload Signature
        </button>
        <input
          ref={sigInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => readImageFile(e.target.files?.[0], setSignatureOverride)}
        />
      </div>

      {showBgGrid && (
        <div className="bggrid">
          {PLACES.map(([name, slug]) => {
            const missing = bgMissing[slug];
            return (
              <button
                key={slug}
                type="button"
                className={`bgswatch${bgFront === slug ? ' active' : ''}`}
                data-slug={slug}
                data-empty={missing ? '1' : undefined}
                title={`Use the ${name} background`}
                onClick={() => void pickBackground(slug)}
              >
                {missing ? (
                  <div className="bgmissing">no image</div>
                ) : (
                  <img
                    src={`${BACKGROUND_BASE}${slug}.png`}
                    alt={`${name} background`}
                    onError={() => setBgMissing((prev) => ({ ...prev, [slug]: true }))}
                  />
                )}
                <b>{name}</b>
              </button>
            );
          })}
        </div>
      )}

      {bgNote && <p className={`bgsavenote${bgNote.error ? ' error' : ''}`}>{bgNote.text}</p>}

      {status === 'approved' && (
        <div className="nfc-row">
          <button type="button" disabled={nfcArmed} onClick={() => void armReader()}>
            {nfcArmed ? 'Waiting for tap…' : 'Reader NFC Scan'}
          </button>
          {nfcArmed && (
            <button type="button" className="secondary" onClick={() => void cancelScan()}>
              Cancel Scan
            </button>
          )}
          {/* Reported lost or stolen: drop the tag so the old card cannot be
              tapped through, then issue the replacement with Reader NFC Scan. */}
          <button
            type="button"
            className="secondary"
            disabled={nfcArmed || unlinking}
            onClick={() => setConfirmUnlink(true)}
          >
            Remove NFC CARD OLD
          </button>
          {nfcNote?.text && <span className={`nfc-note ${nfcNote.tone}`.trim()}>{nfcNote.text}</span>}
        </div>
      )}

      {/* The QR is printed on the card above; this is the same code at a size
          that can be scanned off the screen, plus the link to write to an NFC
          tag so a phone tap opens the verification page by itself. */}
      <div className="qrpanel">
        <div className="qrpanel-code">
          {qrSvg ? (
            <div className="qrpanel-svg" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          ) : (
            <div className="qrpanel-svg qrpanel-empty">
              {card.idNumber ? 'Building QR…' : 'Issued after approval'}
            </div>
          )}
        </div>

        <div className="qrpanel-copy">
          <strong>QR code &amp; NFC card link</strong>
          <small>
            Scanning this code — or tapping an NFC tag written with the link below — opens the
            verification page for <b>{card.idNumber || 'this holder'}</b>.
          </small>

          <label htmlFor={`verify-base-${appId}`}>Verification address</label>
          <div className="qrpanel-row">
            <input
              id={`verify-base-${appId}`}
              type="text"
              value={baseUrl}
              spellCheck={false}
              placeholder="https://the-address-your-phone-can-reach"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <button type="button" className="secondary" onClick={saveBase}>
              Save
            </button>
          </div>
          {isLocalOnly(baseUrl) && (
            <small className="qrpanel-warn">
              A phone cannot open a localhost address. Replace it with the address the phone can
              reach — the PC&rsquo;s Wi-Fi address, or your public URL.
            </small>
          )}

          <label htmlFor={`verify-link-${appId}`}>Link to write on the NFC tag</label>
          <div className="qrpanel-row">
            <input
              id={`verify-link-${appId}`}
              type="text"
              readOnly
              value={verifyLink || 'No link yet — an ID number is issued on approval.'}
            />
            <button type="button" className="secondary" disabled={!verifyLink} onClick={() => void copyLink()}>
              Copy link
            </button>
          </div>

          <div className="qrpanel-row">
            <button type="button" disabled={!qrSvg} onClick={downloadQr}>
              Download QR (.svg)
            </button>
            <button type="button" className="secondary" disabled={!qrSvg} onClick={() => window.print()}>
              Print card with QR
            </button>
          </div>

          <small className="qrpanel-note">
            Write the link to an NTAG213/215 sticker with any NFC writer app (for example
            &ldquo;NFC Tools&rdquo; &rarr; Write &rarr; URL). Tapping that sticker on an NFC phone then opens
            the browser straight to the verification page. This sticker is a separate tag from the ID
            cards the USB reader scans: those carry only a serial number, which a phone cannot read.
          </small>

          {linkNote?.text && (
            <p className={`qrpanel-note${linkNote.error ? ' error' : ''}`}>{linkNote.text}</p>
          )}
        </div>
      </div>

      <p className="hint">
        Responsive sample card. Use the buttons to flip the card or print the demo. This is not an official
        government ID.
      </p>

      <ConfirmDialog
        open={confirmUnlink}
        title="Remove the old NFC card?"
        description="Use this when the holder reports their card lost or stolen. The tag is detached from this holder immediately, so the old card stops verifying at any reader."
        confirmLabel={unlinking ? 'Removing…' : 'Remove old card'}
        cancelLabel="Keep card"
        danger
        loading={unlinking}
        onConfirm={() => void removeLostCard()}
        onCancel={() => !unlinking && setConfirmUnlink(false)}
      >
        <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 p-3 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-500 font-semibold">Holder</span>
            <span className="text-slate-800 font-semibold truncate max-w-[60%]">
              {card.name || 'This holder'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-500 font-semibold">PWD ID</span>
            <span className="font-mono text-slate-800">{card.idNumber || '—'}</span>
          </div>
          <p className="pt-1 text-slate-600">
            The QR code and NFC tag are reissued whenever this application is approved or rejected, so
            the replacement is issued by running <b>Reader NFC Scan</b> after this.
          </p>
        </div>
      </ConfirmDialog>
    </div>
  );
}
