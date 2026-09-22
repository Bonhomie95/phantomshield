/**
 * @phantomshield/shared — the canonical API contract shared by the backend,
 * the mobile app, and the web dashboard.
 *
 * This package is framework-agnostic on purpose: no fastify, mongoose, react,
 * or expo imports. It is the single source of truth for the wire format so the
 * three services can't drift out of sync (which is exactly how the mobile app
 * ended up POSTing to a route the backend didn't expose).
 */
export type PlanId = 'free' | 'starter' | 'pro';
/**
 * Plan identifiers that existed before the free/starter/pro restructure.
 * Rows in Mongo, RevenueCat entitlements and JWTs issued before the change can
 * still carry these, so every read path normalises through `normalizePlan`.
 */
export type LegacyPlanId = 'guard' | 'elite';
/** Coerce any stored/claimed plan value into a current PlanId. */
export declare function normalizePlan(value: unknown): PlanId;
export interface PlanLimits {
    historyDays: number;
    /** Snapshots uploaded to the cloud per month. -1 means unlimited. */
    intruderSnapshots: number;
    /** Guardian contacts alerted (with a live-location link) when the phone may be stolen. */
    guardians: number;
    devices: number;
    /**
     * Can sign in to the web dashboard and SEE their evidence.
     *
     * Deliberately true on every tier, including free. The entire point of this
     * product is that you can find out what happened to a phone you no longer
     * hold — paywalling the only surface that still works when the device is
     * gone would make the free tier actively unsafe, and it is also the single
     * best demonstration of why the paid tiers are worth buying.
     */
    remoteDashboard: boolean;
    /** Can send lock / wipe / alert / locate commands to a device from the web. */
    remoteCommands: boolean;
    /** Evidence export (JSON with integrity digest). */
    export: boolean;
    /** Whether ads are shown. Paid tiers are ad-free. */
    ads: boolean;
    /** Device reports its location on every security event. */
    locationOnEvents: boolean;
    /**
     * Continuous background location ("Find My Phone") and the map.
     * On every tier: a phone you cannot find is the failure this product exists
     * to prevent. Plans differ in how much HISTORY you keep, not in whether you
     * can locate your own device.
     */
    findMyPhone: boolean;
}
export declare const PLAN_LIMITS: Record<PlanId, PlanLimits>;
/** Display metadata for the paywall and plan badges. */
export declare const PLAN_META: Record<PlanId, {
    name: string;
    tagline: string;
}>;
export type OAuthProvider = 'google' | 'apple';
export type DevicePlatform = 'ios' | 'android' | 'web';
export interface DeviceInfo {
    deviceId: string;
    platform: DevicePlatform;
    model?: string;
    osVersion?: string;
    appVersion?: string;
    pushToken?: string;
}
/** POST /api/auth/oauth request body. */
export interface OAuthRequest {
    provider: OAuthProvider;
    idToken: string;
    /** Apple only returns user data on the very first authentication. */
    appleUserData?: {
        email?: string;
        name?: string;
    };
    device: DeviceInfo;
}
export interface AuthUser {
    id: string;
    email: string;
    name?: string | null;
    photo?: string | null;
    plan: PlanId;
    provider: OAuthProvider;
    createdAt: string;
}
/** POST /api/auth/oauth response body. */
export interface AuthResponse {
    accessToken: string;
    refreshToken: string;
    isNewUser: boolean;
    user: AuthUser;
}
/** POST /api/auth/refresh request/response. */
export interface RefreshRequest {
    refreshToken: string;
    deviceId: string;
}
export interface RefreshResponse {
    accessToken: string;
    refreshToken: string;
}
export interface GeoLocation {
    lat: number;
    lng: number;
    accuracy: number;
}
/** POST /api/sync/intruder request body. */
export interface IntruderUpload {
    id: string;
    timestamp: number;
    pinLayer: string;
    failedAttempt: number;
    /** Encrypted on the client before upload. */
    photoBase64?: string;
    encryptedPhotoKey?: string;
    location?: GeoLocation;
}
export type DeviceCommand = 'lock_app' | 'send_alert' | 'locate' | 'lost_mode' | 'lost_mode_off';
/** Lost mode: a message for whoever finds the phone, shown on its lock screen. */
export interface LostModeState {
    enabled: boolean;
    /** Shown to the finder. */
    message: string;
    /** A number or email the finder can use to reach the owner. */
    contact: string;
    since: string | null;
}
/** Someone the owner trusts, alerted with a live-location link on a theft signal. */
export interface Guardian {
    id: string;
    name: string;
    email: string;
    /** Also alert when Guard Mode is triggered (theft signals always alert). */
    alertOnGuard: boolean;
    createdAt: string;
}
/** GET /api/public/share/:token — what a guardian's link shows. No photos, no account data. */
export interface SharedLocationView {
    ownerName: string;
    device: {
        model: string;
        platform: DevicePlatform;
    };
    reason: string;
    createdAt: string;
    expiresAt: string;
    last: {
        lat: number;
        lng: number;
        accuracy: number;
        battery?: number;
        recordedAt: string;
    } | null;
    trail: {
        lat: number;
        lng: number;
        recordedAt: string;
    }[];
}
/** Content-Type of an end-to-end encrypted photo upload. */
export declare const ENCRYPTED_PHOTO_CONTENT_TYPE = "application/vnd.phantomshield.photo";
/**
 * Encrypted photo layout: MAGIC (4 bytes) || nonce (12) || AES-256-GCM ciphertext+tag.
 * The server stores it opaquely; only a holder of the owner's recovery key can read it.
 */
export declare const ENCRYPTED_PHOTO_MAGIC: number[];
export type WSMessageType = 'connected' | 'intruder_alert' | 'device_locked' | 'location_update' | 'theft_signal' | 'ping' | 'pong';
/** OS-level indicators that a device may no longer be with its owner. */
export type TheftSignalType = 'sim_changed' | 'sim_removed' | 'airplane_mode' | 'shutdown' | 'rebooted';
/** Human-readable labels, shared by the app and the dashboard timeline. */
export declare const THEFT_SIGNAL_LABEL: Record<TheftSignalType, string>;
/** One position report from a device. */
export interface LocationPingUpload {
    lat: number;
    lng: number;
    accuracy: number;
    altitude?: number;
    speed?: number;
    heading?: number;
    /** 0–1 */
    battery?: number;
    /** epoch milliseconds */
    recordedAt: number;
    source?: 'background' | 'event' | 'locate' | 'theft_signal';
}
export interface WSMessage<T = unknown> {
    type: WSMessageType;
    payload: T;
    timestamp: number;
}
export declare function encodeRecoveryKey(bytes: Uint8Array): string;
/** Returns null when the text isn't a well-formed 32-byte recovery key. */
export declare function decodeRecoveryKey(text: string): Uint8Array | null;
