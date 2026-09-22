'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  ENCRYPTED_PHOTO_CONTENT_TYPE, ENCRYPTED_PHOTO_MAGIC, decodeRecoveryKey, encodeRecoveryKey,
} from '@phantomshield/shared';
import { api, IntruderEvent, intruderPhotoUrl } from '@/lib/api';
import { Card, Badge, Button, EmptyState, Spinner, AlertBanner, INPUT_CLS } from '@/components/ui';

// ─── End-to-end encrypted photos ──────────────────────────────────────────────
// When the owner turns on encrypted photos, the phone encrypts each one with a
// key only they hold (shown once as a recovery key). The server stores only
// ciphertext; decryption happens here, in the browser.

const KEY_STORAGE = 'ps_photo_recovery_key';

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/** Decode + verify a typed recovery key. Returns null if it's malformed or not this account's key. */
async function importRecoveryKey(text: string, keyCheck: string | null): Promise<CryptoKey | null> {
  const decoded = decodeRecoveryKey(text);
  if (!decoded) return null;
  const raw = new Uint8Array(decoded); // ArrayBuffer-backed, as WebCrypto's types require
  if (keyCheck && toHex(await crypto.subtle.digest('SHA-256', raw)) !== keyCheck) return null;
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
}

/** Layout: "PSE1" (4) || nonce (12) || AES-256-GCM ciphertext+tag; AAD = event id. Throws on a wrong key. */
async function decryptPhoto(bytes: Uint8Array<ArrayBuffer>, key: CryptoKey, eventId: string): Promise<ArrayBuffer> {
  if (!ENCRYPTED_PHOTO_MAGIC.every((b, i) => bytes[i] === b)) throw new Error('Not an encrypted photo');
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(4, 16), additionalData: new TextEncoder().encode(eventId) },
    key,
    bytes.slice(16),
  );
}

// Storage can throw (private mode, blocked site data) — treat that as "nothing saved".
const readStoredKey = () => {
  try { return localStorage.getItem(KEY_STORAGE) ?? sessionStorage.getItem(KEY_STORAGE); } catch { return null; }
};
const clearStoredKey = () => {
  try { localStorage.removeItem(KEY_STORAGE); sessionStorage.removeItem(KEY_STORAGE); } catch { /* ignore */ }
};

/**
 * Fetches a photo through the proxy and renders it from an object URL, decrypting
 * it first when the server returns the encrypted content type.
 */
function Photo({ eventId, alt, className, cryptoKey, onLocked }: {
  eventId: string; alt: string; className: string; cryptoKey: CryptoKey | null;
  /** badKey = a key was provided but didn't decrypt this photo. */
  onLocked: (badKey: boolean) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      const res = await fetch(intruderPhotoUrl(eventId), { credentials: 'include' });
      if (!res.ok) return;
      let blob: Blob;
      if (res.headers.get('content-type')?.startsWith(ENCRYPTED_PHOTO_CONTENT_TYPE)) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        const plain = cryptoKey ? await decryptPhoto(bytes, cryptoKey, eventId).catch(() => null) : null;
        if (!plain) {
          if (!cancelled) { setLocked(true); setSrc(null); onLocked(!!cryptoKey); }
          return;
        }
        blob = new Blob([plain], { type: 'image/jpeg' });
      } else {
        blob = await res.blob();
      }
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
      setLocked(false);
    })().catch(() => { /* leave the placeholder */ });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [eventId, cryptoKey, onLocked]);

  if (locked) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-phantom-faint">
        <span className="text-3xl" aria-hidden="true">🔒</span>
        <span className="text-xs">Encrypted</span>
      </div>
    );
  }
  if (!src) return <span className="text-4xl opacity-20" aria-hidden="true">👤</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}

export default function VaultPage() {
  const [events, setEvents] = useState<IntruderEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [selected, setSelected] = useState<IntruderEvent | null>(null);
  const [keyCheck, setKeyCheck] = useState<string | null>(null);
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [hasLocked, setHasLocked] = useState(false);
  const [keyText, setKeyText] = useState('');
  const [remember, setRemember] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  // A ref keeps onLocked stable, so photos aren't refetched when keyCheck arrives.
  const keyCheckRef = useRef<string | null>(null);
  keyCheckRef.current = keyCheck;

  const onLocked = useCallback((badKey: boolean) => {
    setHasLocked(true);
    if (!badKey) return;
    if (keyCheckRef.current) {
      // The key verified, so this photo predates a key change (or is damaged).
      setKeyError("Some photos couldn't be opened with this recovery key.");
    } else {
      // Nothing to verify against — a failed decrypt is the only signal it's wrong.
      clearStoredKey();
      setCryptoKey(null);
      setKeyError("That recovery key didn't open these photos.");
    }
  }, []);

  const unlock = async () => {
    setUnlocking(true);
    setKeyError(null);
    try {
      const key = await importRecoveryKey(keyText, keyCheck);
      if (!key) {
        setKeyError(decodeRecoveryKey(keyText)
          ? "That isn't the recovery key for this account."
          : "That doesn't look like a recovery key. It's 52 letters and numbers, in groups of four.");
        return;
      }
      // Store the normalised form, so a re-typed key with odd spacing still matches.
      try {
        clearStoredKey();
        (remember ? localStorage : sessionStorage).setItem(KEY_STORAGE, encodeRecoveryKey(decodeRecoveryKey(keyText)!));
      } catch { /* storage unavailable — works for this page view only */ }
      setKeyText('');
      setCryptoKey(key);
    } finally {
      setUnlocking(false);
    }
  };

  // Close the detail modal on Escape.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  useEffect(() => {
    api.sync.intruder()
      .then(r => setEvents(r.events))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Re-use a recovery key saved on this browser, if it still verifies.
  useEffect(() => {
    api.dashboard.e2e()
      .then(async ({ keyCheck }) => {
        setKeyCheck(keyCheck);
        const saved = readStoredKey();
        if (!saved) return;
        const key = await importRecoveryKey(saved, keyCheck);
        if (key) setCryptoKey(key); else clearStoredKey();
      })
      .catch(() => { /* photos still load; encrypted ones stay locked */ });
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div className="space-y-8 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-light text-phantom-text tracking-tight">Intruder Vault</h1>
          <p className="text-phantom-muted text-sm mt-1">{events.length} captured event(s)</p>
        </div>
      </div>

      {error && <AlertBanner title="Error" message={error} variant="danger" />}

      {/* Disclosure notice */}
      <Card className="border-phantom-accent/10 bg-phantom-accent/5">
        <p className="text-xs text-phantom-muted leading-relaxed">
          <span className="text-phantom-accent font-semibold">Transparency notice:</span> Photos appear here only if you turned on
          intruder photos in the app. They are taken when a wrong PIN is entered or Guard Mode is triggered on your phone, stored privately
          in your account, and shown only to you after you sign in.
        </p>
      </Card>

      {cryptoKey && keyError && <AlertBanner title={keyError} variant="warning" onDismiss={() => setKeyError(null)} />}

      {hasLocked && !cryptoKey && (
        <Card className="space-y-3">
          <div>
            <p className="text-sm text-phantom-text font-medium">🔒 Unlock encrypted photos</p>
            <p className="text-xs text-phantom-muted mt-1">
              Some photos are end-to-end encrypted. Enter the recovery key you saved when you turned this on.
              It never leaves this browser.
            </p>
          </div>
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); unlock(); }}>
            <input
              className={`${INPUT_CLS} font-mono`}
              aria-label="Recovery key"
              placeholder="XXXX-XXXX-XXXX-…"
              autoComplete="off"
              spellCheck={false}
              value={keyText}
              onChange={(e) => setKeyText(e.target.value)}
            />
            <label className="flex items-center gap-2 text-xs text-phantom-muted">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember on this browser
            </label>
            {keyError && <p className="text-xs text-phantom-danger" role="alert">{keyError}</p>}
            <Button type="submit" variant="primary" loading={unlocking} disabled={!keyText.trim()}>Unlock</Button>
          </form>
        </Card>
      )}

      {events.length === 0 ? (
        <EmptyState
          icon="📸"
          title="No intruder events"
          sub="When someone enters the wrong PIN (if snapshot is enabled), their photo will appear here."
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {events.map((event, i) => (
            <div
              key={event.eventId ?? i}
              role="button"
              tabIndex={0}
              aria-label={`Intruder event, attempt ${event.failedAttempt}, ${format(new Date(event.timestamp), 'MMM d h:mm a')}`}
              className="bg-phantom-surface border border-phantom-border rounded-2xl overflow-hidden cursor-pointer hover:border-phantom-danger/40 focus:outline-none focus:ring-2 focus:ring-phantom-accent/50 transition-colors group"
              onClick={() => setSelected(event)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(event); } }}
            >
              {/* Photo area */}
              <div className="aspect-[3/4] bg-phantom-card flex items-center justify-center relative overflow-hidden">
                {event.hasPhoto ? (
                  <Photo
                    eventId={event.eventId}
                    alt={`Intruder snapshot, attempt ${event.failedAttempt}`}
                    className="w-full h-full object-cover"
                    cryptoKey={cryptoKey}
                    onLocked={onLocked}
                  />
                ) : (
                  <span className="text-4xl opacity-20">👤</span>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-phantom-bg/80 to-transparent" />
                <div className="absolute bottom-2 left-2 right-2">
                  <Badge variant="danger">Attempt #{event.failedAttempt}</Badge>
                </div>
              </div>

              {/* Meta */}
              <div className="p-3 space-y-1">
                <p className="text-xs text-phantom-text font-medium">
                  {format(new Date(event.timestamp), 'MMM d, h:mm a')}
                </p>
                <p className="text-xs text-phantom-muted capitalize">{event.pinLayer === 'guard' ? 'Guard Mode' : `PIN: ${event.pinLayer}`}</p>
                {event.location && (
                  <p className="text-xs text-phantom-faint truncate">
                    📍 {event.location.lat.toFixed(4)}, {event.location.lng.toFixed(4)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <div
          className="fixed inset-0 bg-phantom-bg/90 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Intruder detail"
        >
          <Card className="max-w-md w-full space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-light text-phantom-text">Intruder Detail</h2>
              <button onClick={() => setSelected(null)} aria-label="Close" className="text-phantom-muted hover:text-phantom-text p-1">✕</button>
            </div>

            <div className="aspect-[4/3] bg-phantom-card rounded-xl flex items-center justify-center overflow-hidden">
              {selected.hasPhoto ? (
                <Photo
                  eventId={selected.eventId}
                  alt={`Intruder snapshot, attempt ${selected.failedAttempt}`}
                  className="w-full h-full object-contain"
                  cryptoKey={cryptoKey}
                  onLocked={onLocked}
                />
              ) : (
                <span className="text-6xl opacity-20" aria-hidden="true">👤</span>
              )}
            </div>

            <div className="space-y-2 text-sm">
              <Row label="Time"    value={format(new Date(selected.timestamp), 'MMMM d, yyyy — h:mm:ss a')} />
              <Row label="PIN Layer" value={selected.pinLayer} />
              <Row label="Attempt" value={`#${selected.failedAttempt}`} />
              {selected.location && (
                <Row label="Location" value={`${selected.location.lat.toFixed(6)}, ${selected.location.lng.toFixed(6)}`} />
              )}
              {selected.location && (
                <Row label="Accuracy" value={`±${Math.round(selected.location.accuracy)}m`} />
              )}
              <Row label="Photo" value={selected.hasPhoto ? 'Backed up' : 'Not backed up'} />
            </div>

            {selected.location && (
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => window.open(`https://maps.google.com/?q=${selected.location!.lat},${selected.location!.lng}`, '_blank')}
              >
                📍 View on Google Maps
              </Button>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between items-start gap-4">
    <span className="text-phantom-faint shrink-0">{label}</span>
    <span className="text-phantom-text text-right font-mono text-xs">{value}</span>
  </div>
);
