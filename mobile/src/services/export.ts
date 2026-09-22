/**
 * Evidence export — what the owner hands to the police or an insurer.
 *
 * Two forms of the same records:
 *   • a PDF report a person can read: every event with its photo, time, place
 *     and a map link, plus the integrity digest;
 *   • the raw JSON the digest is computed over, for anyone who wants to verify.
 *
 * Chain-of-custody matters for that use, so the file carries:
 *   • the exact time it was generated and by which app build,
 *   • a manifest of what is included and the totals,
 *   • a SHA-256 digest over the records, so any later edit is detectable.
 *
 * Photographs stay where they are (the app's private sandbox); the export
 * references them by id and filename rather than embedding megabytes of base64.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { usePhantomStore } from '@/stores/phantom';
import { getOrCreateDeviceId } from '@/services/api';
import { PLAN_LIMITS, normalizePlan } from '@phantomshield/shared';

export interface EvidenceExport {
  format: 'phantomshield.evidence.v1';
  generatedAt: string;
  app: { version: string; platform: string; deviceId: string };
  account: { email: string | null; plan: string | null };
  summary: {
    intruderPhotos: number;
    unlockEvents: number;
    guardEvents: number;
  };
  records: {
    intruderPhotos: PhotoRecord[];
    unlockEvents: unknown[];
    guardEvents: unknown[];
  };
  /** SHA-256 over JSON.stringify(records). Recompute to verify integrity. */
  integrity: { algorithm: 'SHA-256'; digest: string };
}

interface PhotoRecord {
  id: string;
  timestamp: string;
  trigger: string;
  isAnomaly: boolean;
  anomalyReason?: string;
  latitude?: number;
  longitude?: number;
  file: string | null;
}

/** Assemble the export document from on-device state. */
export async function buildEvidenceExport(): Promise<EvidenceExport> {
  const s = usePhantomStore.getState();

  const records = {
    // Photo bytes stay on-device; reference them so the file stays portable.
    intruderPhotos: s.intruderPhotos.map((p) => ({
      id: p.id,
      timestamp: p.timestamp,
      trigger: p.trigger,
      isAnomaly: p.isAnomaly,
      anomalyReason: p.anomalyReason,
      latitude: p.latitude,
      longitude: p.longitude,
      file: p.imageUri ? p.imageUri.split('/').pop() ?? null : null,
    })),
    unlockEvents: s.unlockEvents,
    guardEvents: s.guardEvents.map((g) => ({
      id: g.id,
      type: g.type,
      timestamp: g.timestamp,
      reason: g.reason,
      latitude: g.latitude,
      longitude: g.longitude,
      file: g.imageUri ? g.imageUri.split('/').pop() : null,
    })),
  };

  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify(records),
  );

  return {
    format: 'phantomshield.evidence.v1',
    generatedAt: new Date().toISOString(),
    app: {
      version: Constants.expoConfig?.version ?? 'unknown',
      platform: Platform.OS,
      deviceId: await getOrCreateDeviceId().catch(() => 'unknown'),
    },
    account: { email: s.user?.email ?? null, plan: s.user?.plan ?? null },
    summary: {
      intruderPhotos: records.intruderPhotos.length,
      unlockEvents: records.unlockEvents.length,
      guardEvents: records.guardEvents.length,
    },
    records,
    integrity: { algorithm: 'SHA-256', digest },
  };
}

export type ExportResult =
  | { ok: true; uri: string; summary: EvidenceExport['summary'] }
  | { ok: false; reason: 'empty' | 'unavailable' | 'failed' | 'upgrade_required' };

/** Whether the current plan includes evidence export. */
export function canExport(): boolean {
  const plan = normalizePlan(usePhantomStore.getState().user?.plan);
  return PLAN_LIMITS[plan].export;
}

/**
 * Write the evidence file and hand it to the OS share sheet.
 * Returns a result rather than throwing so the caller can show a real message.
 */
export async function exportEvidence(): Promise<ExportResult> {
  // `export` is a sold entitlement — enforce it here rather than trusting the
  // UI, and return a distinct reason so the caller can offer the upgrade.
  if (!canExport()) return { ok: false, reason: 'upgrade_required' };

  try {
    const doc = await buildEvidenceExport();

    const total =
      doc.summary.intruderPhotos +
      doc.summary.unlockEvents +
      doc.summary.guardEvents;
    if (total === 0) return { ok: false, reason: 'empty' };

    const stamp = doc.generatedAt.replace(/[:.]/g, '-');
    const uri = `${FileSystem.documentDirectory}phantomshield-evidence-${stamp}.json`;

    await FileSystem.writeAsStringAsync(uri, JSON.stringify(doc, null, 2), {
      encoding: FileSystem.EncodingType.UTF8,
    });

    if (!(await Sharing.isAvailableAsync())) {
      // The file still exists on disk even when there's no share sheet.
      return { ok: true, uri, summary: doc.summary };
    }

    await Sharing.shareAsync(uri, {
      mimeType: 'application/json',
      dialogTitle: 'Export PhantomShield evidence',
      UTI: 'public.json',
    });

    return { ok: true, uri, summary: doc.summary };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

// ─── PDF report ───────────────────────────────────────────────────────────────

/** Photos embedded in the PDF. More than this makes a file too big to email. */
const MAX_PDF_PHOTOS = 40;

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const mapLink = (lat?: number, lng?: number) =>
  lat != null && lng != null
    ? `<a href="https://maps.google.com/?q=${lat},${lng}">${lat.toFixed(5)}, ${lng.toFixed(5)}</a>`
    : '—';

async function photoDataUri(file: string | null): Promise<string | null> {
  if (!file) return null;
  const photo = usePhantomStore.getState().intruderPhotos.find((p) => p.imageUri?.endsWith(file));
  if (!photo) return null;
  try {
    const b64 = await FileSystem.readAsStringAsync(photo.imageUri, { encoding: FileSystem.EncodingType.Base64 });
    return `data:image/jpeg;base64,${b64}`;
  } catch {
    return null;
  }
}

async function reportHtml(doc: EvidenceExport): Promise<string> {
  const photos = doc.records.intruderPhotos.slice(0, MAX_PDF_PHOTOS);
  const rows = await Promise.all(
    photos.map(async (p) => {
      const img = await photoDataUri(p.file);
      return `<tr>
        <td class="ph">${img ? `<img src="${img}"/>` : '<div class="noimg">No photo</div>'}</td>
        <td><b>${esc(p.anomalyReason ?? p.trigger)}</b><br/>${esc(new Date(p.timestamp).toLocaleString())}<br/>
            Location: ${mapLink(p.latitude, p.longitude)}<br/><span class="muted">Event ${esc(p.id)}</span></td>
      </tr>`;
    }),
  );
  const failedPins = (doc.records.unlockEvents as { timestamp: string; isAnomaly: boolean; anomalyReason?: string }[])
    .filter((e) => e.isAnomaly);
  const omitted = doc.records.intruderPhotos.length - photos.length;

  return `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
    body{font-family:-apple-system,Roboto,Helvetica,Arial,sans-serif;color:#111;font-size:12px;margin:28px}
    h1{font-size:20px;margin:0 0 4px} h2{font-size:14px;margin:22px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
    .muted{color:#666} table{width:100%;border-collapse:collapse} td{vertical-align:top;padding:8px;border-bottom:1px solid #eee}
    .ph{width:150px} .ph img{width:140px;border-radius:6px} .noimg{width:140px;height:90px;background:#f2f2f2;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#999}
    .digest{font-family:Menlo,monospace;font-size:10px;word-break:break-all;background:#f6f6f6;padding:8px;border-radius:6px}
    .kv td{padding:3px 8px;border:none}
  </style></head><body>
  <h1>PhantomShield evidence report</h1>
  <div class="muted">Generated ${esc(new Date(doc.generatedAt).toLocaleString())} · app ${esc(doc.app.version)} (${esc(doc.app.platform)})</div>
  <h2>Summary</h2>
  <table class="kv">
    <tr><td>Account</td><td>${esc(doc.account.email ?? 'Not signed in')}</td></tr>
    <tr><td>Device ID</td><td>${esc(doc.app.deviceId)}</td></tr>
    <tr><td>Photos / Guard Mode events</td><td>${doc.summary.intruderPhotos} / ${doc.summary.guardEvents}</td></tr>
    <tr><td>Wrong PIN attempts</td><td>${failedPins.length}</td></tr>
  </table>
  <h2>Captured events</h2>
  ${rows.length ? `<table>${rows.join('')}</table>` : '<p class="muted">No photos were captured.</p>'}
  ${omitted > 0 ? `<p class="muted">${omitted} older photo(s) are listed in the JSON export but not shown here.</p>` : ''}
  ${failedPins.length ? `<h2>Wrong PIN attempts</h2><table>${failedPins
    .slice(0, 100)
    .map((e) => `<tr><td>${esc(new Date(e.timestamp).toLocaleString())}</td><td>${esc(e.anomalyReason ?? '')}</td></tr>`)
    .join('')}</table>` : ''}
  <h2>Integrity</h2>
  <p>SHA-256 over the event records (the <i>records</i> object of the JSON export). Any later change to the
  records produces a different value.</p>
  <div class="digest">${esc(doc.integrity.digest)}</div>
  </body></html>`;
}

/** Create the PDF report and open the share sheet. Same gating as the JSON export. */
export async function exportReportPdf(): Promise<ExportResult> {
  if (!canExport()) return { ok: false, reason: 'upgrade_required' };
  try {
    const doc = await buildEvidenceExport();
    if (doc.summary.intruderPhotos + doc.summary.unlockEvents + doc.summary.guardEvents === 0) {
      return { ok: false, reason: 'empty' };
    }
    const { uri } = await Print.printToFileAsync({ html: await reportHtml(doc) });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Share PhantomShield evidence report',
        UTI: 'com.adobe.pdf',
      });
    }
    return { ok: true, uri, summary: doc.summary };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
