"use strict";
/**
 * @phantomshield/shared — the canonical API contract shared by the backend,
 * the mobile app, and the web dashboard.
 *
 * This package is framework-agnostic on purpose: no fastify, mongoose, react,
 * or expo imports. It is the single source of truth for the wire format so the
 * three services can't drift out of sync (which is exactly how the mobile app
 * ended up POSTing to a route the backend didn't expose).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.THEFT_SIGNAL_LABEL = exports.ENCRYPTED_PHOTO_MAGIC = exports.ENCRYPTED_PHOTO_CONTENT_TYPE = exports.PLAN_META = exports.PLAN_LIMITS = void 0;
exports.normalizePlan = normalizePlan;
exports.encodeRecoveryKey = encodeRecoveryKey;
exports.decodeRecoveryKey = decodeRecoveryKey;
const LEGACY_PLAN_MAP = {
    guard: 'starter',
    elite: 'pro',
};
/** Coerce any stored/claimed plan value into a current PlanId. */
function normalizePlan(value) {
    if (value === 'free' || value === 'starter' || value === 'pro')
        return value;
    if (value === 'guard' || value === 'elite')
        return LEGACY_PLAN_MAP[value];
    return 'free';
}
exports.PLAN_LIMITS = {
    // Free is a real safety net, not a demo: evidence still reaches the cloud and
    // is still visible on the web if the phone is stolen. What's limited is depth
    // (history, volume, devices) and control (remote commands), not protection.
    free: {
        historyDays: 7,
        intruderSnapshots: 5,
        guardians: 1,
        devices: 1,
        remoteDashboard: true,
        remoteCommands: false,
        export: false,
        ads: true,
        locationOnEvents: true,
        findMyPhone: true,
    },
    starter: {
        historyDays: 30,
        intruderSnapshots: 50,
        guardians: 5,
        devices: 3,
        remoteDashboard: true,
        remoteCommands: true,
        export: true,
        ads: false,
        locationOnEvents: true,
        findMyPhone: true,
    },
    pro: {
        historyDays: 365,
        intruderSnapshots: -1,
        guardians: 5,
        devices: 10,
        remoteDashboard: true,
        remoteCommands: true,
        export: true,
        ads: false,
        locationOnEvents: true,
        findMyPhone: true,
    },
};
/** Display metadata for the paywall and plan badges. */
exports.PLAN_META = {
    free: { name: 'Free', tagline: 'Core protection, always on' },
    starter: { name: 'Starter', tagline: 'Full evidence and remote control' },
    pro: { name: 'Pro', tagline: 'Everything, for every device you own' },
};
// ─── End-to-end encrypted photos ──────────────────────────────────────────────
/** Content-Type of an end-to-end encrypted photo upload. */
exports.ENCRYPTED_PHOTO_CONTENT_TYPE = 'application/vnd.phantomshield.photo';
/**
 * Encrypted photo layout: MAGIC (4 bytes) || nonce (12) || AES-256-GCM ciphertext+tag.
 * The server stores it opaquely; only a holder of the owner's recovery key can read it.
 */
exports.ENCRYPTED_PHOTO_MAGIC = [0x50, 0x53, 0x45, 0x31]; // "PSE1"
/** Human-readable labels, shared by the app and the dashboard timeline. */
exports.THEFT_SIGNAL_LABEL = {
    sim_changed: 'SIM card was changed',
    sim_removed: 'SIM card was removed',
    airplane_mode: 'Airplane mode was switched on',
    shutdown: 'Device was powered off',
    rebooted: 'Device restarted',
};
// ─── Recovery key encoding ────────────────────────────────────────────────────
// The 32-byte photo key is shown to the owner once, as Crockford base32 in
// groups of four (52 characters). Crockford because it has no 0/O or 1/I/L
// confusion, and decoding forgives exactly those mix-ups when typed back.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function encodeRecoveryKey(bytes) {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const b of bytes) {
        value = (value << 8) | b;
        bits += 8;
        while (bits >= 5) {
            out += B32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0)
        out += B32[(value << (5 - bits)) & 31];
    return out.match(/.{1,4}/g).join('-');
}
/** Returns null when the text isn't a well-formed 32-byte recovery key. */
function decodeRecoveryKey(text) {
    const clean = text
        .toUpperCase()
        .replace(/[\s-]/g, '')
        .replace(/O/g, '0')
        .replace(/[IL]/g, '1');
    if (clean.length !== 52)
        return null;
    const out = [];
    let bits = 0;
    let value = 0;
    for (const ch of clean) {
        const v = B32.indexOf(ch);
        if (v < 0)
            return null;
        value = ((value << 5) | v) & 0xffff;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return out.length === 32 ? new Uint8Array(out) : null;
}
