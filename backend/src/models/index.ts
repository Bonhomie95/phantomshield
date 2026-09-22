import mongoose, { Schema, Document, Types } from 'mongoose';
import { PlanId, OAuthProvider } from '@/types';

// ─── User ─────────────────────────────────────────────────────────────────────

export interface IUser extends Document {
  _id:            Types.ObjectId;
  /** Absent for an Apple account whose email Apple never re-sent (see auth.ts). */
  email?:         string;
  name?:          string;
  photo?:         string;
  // Auth
  provider:       OAuthProvider;
  googleId?:      string;
  appleId?:       string;
  /** Apple refresh token, kept only so account deletion can revoke it (Apple requirement). */
  appleRefreshToken?: string | null;
  // Plan
  plan:           PlanId;
  planExpiresAt:  Date | null;
  /**
   * End-to-end photo encryption. SHA-256 of the owner's photo key, so a new
   * device can check a typed recovery key before using it. Reveals nothing
   * about the key itself (it is 256 random bits).
   */
  e2eKeyCheck?:   string | null;
  // Referrals
  referralCode?:  string;
  referredBy?:    Types.ObjectId | null;
  referralCount?: number;
  // State
  isActive:       boolean;
  lastLoginAt:    Date | null;
  createdAt:      Date;
  updatedAt:      Date;
}

const UserSchema = new Schema<IUser>(
  {
    // Sparse: Sign in with Apple does not re-send the email after the first
    // authorisation, so a user who deleted their account and signs up again
    // arrives with no email at all — that must still work.
    email:         { type: String, default: undefined, unique: true, sparse: true, lowercase: true, trim: true },
    name:          { type: String, default: null },
    photo:         { type: String, default: null },
    provider:      { type: String, enum: ['google', 'apple'], required: true },
    googleId:      { type: String, default: undefined, unique: true, sparse: true },
    appleId:       { type: String, default: undefined, unique: true, sparse: true },
    appleRefreshToken: { type: String, default: null, select: false },
    e2eKeyCheck:   { type: String, default: null },
    // Legacy values ('guard','elite') stay valid so existing rows load; every
    // read path normalises them via normalizePlan() from the shared contract.
    plan:          { type: String, enum: ['free', 'starter', 'pro', 'guard', 'elite'], default: 'free' },
    planExpiresAt: { type: Date, default: null },
    referralCode:  { type: String, default: null, unique: true, sparse: true },
    referredBy:    { type: Schema.Types.ObjectId, ref: 'User', default: null },
    referralCount: { type: Number, default: 0 },
    isActive:      { type: Boolean, default: true },
    lastLoginAt:   { type: Date, default: null },
  },
  { timestamps: true },
);

// email/googleId/appleId uniqueness is declared on the schema paths above, which
// already builds those indexes — re-declaring them here would create duplicates.
export const User = mongoose.model<IUser>('User', UserSchema);

// ─── Device ───────────────────────────────────────────────────────────────────

// Omit Document's own `model` accessor so our `model` (device model name) field
// doesn't clash with it under strict typing.
export interface IDevice extends Omit<Document, 'model'> {
  _id:             Types.ObjectId;
  userId:          Types.ObjectId;
  deviceId:        string;
  platform:        'ios' | 'android' | 'web';
  model:           string;
  osVersion:       string;
  appVersion:      string;
  pushToken:       string | null;
  isActive:        boolean;
  lastSeenAt:      Date;
  isLocked:        boolean;
  trackingEnabled: boolean;
  lostMode:        { enabled: boolean; message: string; contact: string; since: Date | null };
  createdAt:       Date;
}

const DeviceSchema = new Schema<IDevice>(
  {
    userId:          { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deviceId:        { type: String, required: true },
    platform:        { type: String, enum: ['ios', 'android', 'web'], required: true },
    model:           { type: String, default: 'Unknown' },
    osVersion:       { type: String, default: 'Unknown' },
    appVersion:      { type: String, default: '1.0.0' },
    pushToken:       { type: String, default: null },
    isActive:        { type: Boolean, default: true },
    lastSeenAt:      { type: Date,    default: Date.now },
    isLocked:        { type: Boolean, default: false },
    trackingEnabled: { type: Boolean, default: true },
    lostMode: {
      enabled: { type: Boolean, default: false },
      message: { type: String, default: '' },
      contact: { type: String, default: '' },
      since:   { type: Date, default: null },
    },
  },
  { timestamps: true },
);

// A deviceId is unique PER USER, not globally: making it globally unique let a
// caller who merely knew another user's (client-generated) deviceId collide with
// or clobber that account's device record. The compound index also serves the
// common `{ userId }`-prefixed listing queries.
DeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
export const Device = mongoose.model<IDevice>('Device', DeviceSchema);

// ─── ActivityEvent ────────────────────────────────────────────────────────────

export interface IActivityEvent extends Document {
  _id:              Types.ObjectId;
  userId:           Types.ObjectId;
  deviceId:         string;
  eventId:          string;
  type:             string;
  appName?:         string;
  timestamp:        Date;
  duration?:        number;
  isAnomalous:      boolean;
  anomalyReason?:   string;
  encryptedPayload?: string;
  createdAt:        Date;
}

const ActivityEventSchema = new Schema<IActivityEvent>(
  {
    userId:           { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deviceId:         { type: String, required: true },
    eventId:          { type: String, required: true },
    type:             { type: String, required: true },
    appName:          { type: String },
    timestamp:        { type: Date,   required: true },
    duration:         { type: Number },
    isAnomalous:      { type: Boolean, default: false },
    anomalyReason:    { type: String },
    encryptedPayload: { type: String },
  },
  { timestamps: true },
);

ActivityEventSchema.index({ userId: 1, timestamp: -1 });
ActivityEventSchema.index({ userId: 1, deviceId: 1 });
// Dedupe is per-user: a global-unique eventId let one user pre-insert another
// user's (predictable) eventId and permanently block their sync / probe for it.
ActivityEventSchema.index({ userId: 1, eventId: 1 }, { unique: true });
// Anomaly queries (`{userId, isAnomalous:true}` sorted by time) had NO covering
// index, so /dashboard/overview fetched a user's entire history twice on every
// cache miss just to find five rows. A partial index is tiny and serves all of
// /overview, /activity?anomalous, and /sync/events?anomalousOnly.
ActivityEventSchema.index(
  { userId: 1, timestamp: -1 },
  { partialFilterExpression: { isAnomalous: true }, name: 'user_anomalies' },
);
// Retention must match what the plans actually SELL: Pro promises 365 days of
// history, so a 90-day TTL silently deleted three quarters of what a Pro
// subscriber paid for. Keep the ceiling at the longest sold window; per-plan
// trimming is enforced separately by applyRetention().
ActivityEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });
export const ActivityEvent = mongoose.model<IActivityEvent>('ActivityEvent', ActivityEventSchema);

// ─── IntruderEvent ────────────────────────────────────────────────────────────

export interface IIntruderEvent extends Document {
  _id:               Types.ObjectId;
  userId:            Types.ObjectId;
  deviceId:          string;
  eventId:           string;
  timestamp:         Date;
  pinLayer:          string;
  failedAttempt:     number;
  photoUrl?:         string;
  location?:         { lat: number; lng: number; accuracy: number };
  encryptedPhotoKey?: string;
}

const IntruderEventSchema = new Schema<IIntruderEvent>(
  {
    userId:            { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deviceId:          { type: String, required: true },
    eventId:           { type: String, required: true },
    timestamp:         { type: Date,   required: true },
    pinLayer:          { type: String, required: true },
    failedAttempt:     { type: Number, required: true },
    photoUrl:          { type: String },
    location: {
      lat:      { type: Number },
      lng:      { type: Number },
      accuracy: { type: Number },
    },
    encryptedPhotoKey: { type: String },
  },
  { timestamps: true },
);

IntruderEventSchema.index({ userId: 1, timestamp: -1 });
// Serves the monthly photo-quota count on the hottest security path, which
// otherwise scanned every one of the user's intruder events.
IntruderEventSchema.index(
  { userId: 1, createdAt: -1 },
  { partialFilterExpression: { photoUrl: { $exists: true } }, name: 'user_photo_quota' },
);
IntruderEventSchema.index({ userId: 1, eventId: 1 }, { unique: true });
// Bound growth for elite (unlimited-snapshot) users; 1 year matches the longest
// plausible retention need and keeps the collection from growing forever.
IntruderEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });
export const IntruderEvent = mongoose.model<IIntruderEvent>('IntruderEvent', IntruderEventSchema);

// ─── RefreshToken ─────────────────────────────────────────────────────────────

export interface IRefreshToken extends Document {
  _id:       Types.ObjectId;
  userId:    Types.ObjectId;
  deviceId:  string;
  tokenHash: string;
  expiresAt: Date;
  isRevoked: boolean;
  createdAt: Date;
}

const RefreshTokenSchema = new Schema<IRefreshToken>(
  {
    userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deviceId:  { type: String, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date,   required: true },
    isRevoked: { type: Boolean, default: false },
  },
  { timestamps: true },
);

RefreshTokenSchema.index({ userId: 1 });
RefreshTokenSchema.index({ tokenHash: 1 });
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const RefreshToken = mongoose.model<IRefreshToken>('RefreshToken', RefreshTokenSchema);

// ─── Referral (retired) ─────────────────────────────────────────────────────────────────
// A ledger, not a counter. `User.referralCount` was a bare `$inc`, so abuse
// could only be guessed at after the fact — there was no record of who referred
// whom, from which device, or when. Rewards are also no longer granted at
// redemption: they are held until the referred account actually activates, so
// the payout follows proven value rather than a signup.

export type ReferralStatus = 'pending' | 'rewarded' | 'rejected';

export interface IReferral extends Document {
  _id:          Types.ObjectId;
  referrerId:   Types.ObjectId;
  referredId:   Types.ObjectId;
  code:         string;
  status:       ReferralStatus;
  /** Device the redemption came from — the primary self-referral signal. */
  deviceId:     string | null;
  /** Hashed, never the raw address: enough to correlate, not to track. */
  ipHash:       string | null;
  rejectedReason?: string;
  redeemedAt:   Date;
  activatedAt:  Date | null;
  rewardedAt:   Date | null;
  createdAt:    Date;
}

const ReferralSchema = new Schema<IReferral>(
  {
    referrerId:  { type: Schema.Types.ObjectId, ref: 'User', required: true },
    referredId:  { type: Schema.Types.ObjectId, ref: 'User', required: true },
    code:        { type: String, required: true },
    status:      { type: String, enum: ['pending', 'rewarded', 'rejected'], default: 'pending' },
    deviceId:    { type: String, default: null },
    ipHash:      { type: String, default: null },
    rejectedReason: { type: String },
    redeemedAt:  { type: Date, default: Date.now },
    activatedAt: { type: Date, default: null },
    rewardedAt:  { type: Date, default: null },
  },
  { timestamps: true },
);

// One referral per referred account, ever.
ReferralSchema.index({ referredId: 1 }, { unique: true });
ReferralSchema.index({ referrerId: 1, status: 1 });
// Self-referral detection: find prior redemptions from the same handset.
ReferralSchema.index({ deviceId: 1 });
export const Referral = mongoose.model<IReferral>('Referral', ReferralSchema);

// ─── SubscriptionEvent ────────────────────────────────────────────────────────
// An append-only billing ledger. `User.plan` was mutated in place with no
// history, which made MRR, churn, trial→paid, refund rate, LTV and any cohort
// analysis literally uncomputable — and left support with no way to reconstruct
// what happened to a customer's subscription.

export interface ISubscriptionEvent extends Document {
  _id:            Types.ObjectId;
  userId:         Types.ObjectId;
  /** RevenueCat event id — the idempotency key. */
  eventId:        string;
  type:           string;
  /** Plan in force after applying this event. */
  planAfter:      string;
  planBefore:     string;
  productId?:     string;
  store?:         string;
  environment?:   string;
  periodType?:    string;
  priceUsd?:      number;
  currency?:      string;
  expiresAt:      Date | null;
  occurredAt:     Date;
  createdAt:      Date;
}

const SubscriptionEventSchema = new Schema<ISubscriptionEvent>(
  {
    userId:      { type: Schema.Types.ObjectId, ref: 'User', required: true },
    eventId:     { type: String, required: true },
    type:        { type: String, required: true },
    planAfter:   { type: String, required: true },
    planBefore:  { type: String, required: true },
    productId:   { type: String },
    store:       { type: String },
    environment: { type: String },
    periodType:  { type: String },
    priceUsd:    { type: Number },
    currency:    { type: String },
    expiresAt:   { type: Date, default: null },
    occurredAt:  { type: Date, required: true },
  },
  { timestamps: true },
);

// Idempotency: the webhook checks this before applying an event.
SubscriptionEventSchema.index({ eventId: 1 }, { unique: true });
SubscriptionEventSchema.index({ userId: 1, occurredAt: -1 });
SubscriptionEventSchema.index({ type: 1, occurredAt: -1 });
export const SubscriptionEvent = mongoose.model<ISubscriptionEvent>(
  'SubscriptionEvent',
  SubscriptionEventSchema,
);

// ─── GuardSessionCount ────────────────────────────────────────────────────────
// Activation signal for referral settlement (and the natural home for an
// activation metric). Guard sessions run entirely on-device, so the server can
// only know one happened if the client says so — this counts those reports.

export interface IGuardSessionCount extends Document {
  _id:       Types.ObjectId;
  userId:    Types.ObjectId;
  sessions:  number;
  firstAt:   Date;
  lastAt:    Date;
}

const GuardSessionCountSchema = new Schema<IGuardSessionCount>(
  {
    userId:   { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    sessions: { type: Number, default: 0 },
    firstAt:  { type: Date, default: Date.now },
    lastAt:   { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const GuardSessionCount = mongoose.model<IGuardSessionCount>(
  'GuardSessionCount',
  GuardSessionCountSchema,
);

// ─── IntruderPhoto ────────────────────────────────────────────────────────────
// One row per stored photo. The bytes go to Cloudflare R2 when it is
// configured (the row then carries only `key`), otherwise they stay inline in
// `data` so the whole service can run on one database. A downscaled JPEG is
// ~100–300KB, far under the 16MB document limit; the route caps uploads at 3MB.

export interface IIntruderPhoto extends Document {
  _id:         Types.ObjectId;
  userId:      Types.ObjectId;
  eventId:     string;
  /** Bytes, when they live in MongoDB. Absent once R2 holds them. */
  data?:       Buffer;
  /** R2 object key, when the bytes live in R2 instead. */
  key?:        string;
  contentType: string;
  size:        number;
  createdAt:   Date;
}

const IntruderPhotoSchema = new Schema<IIntruderPhoto>(
  {
    userId:      { type: Schema.Types.ObjectId, ref: 'User', required: true },
    eventId:     { type: String, required: true },
    data:        { type: Buffer },
    key:         { type: String },
    contentType: { type: String, default: 'image/jpeg' },
    size:        { type: Number, required: true },
  },
  { timestamps: true },
);

IntruderPhotoSchema.index({ userId: 1, eventId: 1 }, { unique: true });
// Serves the monthly photo quota count.
IntruderPhotoSchema.index({ userId: 1, createdAt: -1 });
// Same ceiling as the event row, so a photo can never outlive its event.
IntruderPhotoSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });
export const IntruderPhoto = mongoose.model<IIntruderPhoto>('IntruderPhoto', IntruderPhotoSchema);

// ─── DeviceCommand ────────────────────────────────────────────────────────────
// Remote commands queued for a device that is offline. Keyed by (userId,
// deviceId): deviceIds are client-generated and only unique per user, so a
// queue keyed by deviceId alone would let one account's command reach another
// account's handset that happens to share the id.

export interface IDeviceCommand extends Document {
  _id:       Types.ObjectId;
  userId:    Types.ObjectId;
  deviceId:  string;
  command:   string;
  payload:   unknown;
  ts:        number;
  expiresAt: Date;
}

const DeviceCommandSchema = new Schema<IDeviceCommand>({
  userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
  deviceId:  { type: String, required: true },
  command:   { type: String, required: true },
  payload:   { type: Schema.Types.Mixed, default: {} },
  ts:        { type: Number, required: true },
  expiresAt: { type: Date, required: true },
});

DeviceCommandSchema.index({ userId: 1, deviceId: 1, ts: 1 });
DeviceCommandSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const DeviceCommand = mongoose.model<IDeviceCommand>('DeviceCommand', DeviceCommandSchema);

// ─── KeyValue ─────────────────────────────────────────────────────────────────
// Small expiring keys (token blocklist, WS tickets, presence, idempotency and
// throttle markers, short caches). Mongo's TTL monitor reaps expired rows about
// once a minute, so every read ALSO filters on expiresAt — see config/kv.ts.

export interface IKeyValue {
  _id:       string;
  value:     unknown;
  expiresAt: Date;
}

const KeyValueSchema = new Schema<IKeyValue>(
  {
    _id:       { type: String, required: true },
    value:     { type: Schema.Types.Mixed, default: null },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

KeyValueSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Presence lookup: "which of this user's devices are online".
KeyValueSchema.index({ 'value.userId': 1 }, { sparse: true });
export const KeyValue = mongoose.model<IKeyValue>('KeyValue', KeyValueSchema);

// ─── LocationPing ─────────────────────────────────────────────────────────────
// Device location history — the backbone of "where is my phone".
//
// Kept in its own collection rather than bolted onto IntruderEvent because the
// access pattern is completely different: high-volume, append-only, always read
// as a time-ordered trail for one device, and it must be cheap to expire.

export type LocationSource = 'background' | 'event' | 'locate' | 'theft_signal';

export interface ILocationPing extends Document {
  _id:        Types.ObjectId;
  userId:     Types.ObjectId;
  deviceId:   string;
  lat:        number;
  lng:        number;
  accuracy:   number;
  altitude?:  number;
  speed?:     number;
  heading?:   number;
  /** Battery 0–1 at capture time; a dying phone explains a trail going cold. */
  battery?:   number;
  source:     LocationSource;
  recordedAt: Date;
  createdAt:  Date;
}

const LocationPingSchema = new Schema<ILocationPing>(
  {
    userId:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deviceId:   { type: String, required: true },
    lat:        { type: Number, required: true, min: -90,  max: 90 },
    lng:        { type: Number, required: true, min: -180, max: 180 },
    accuracy:   { type: Number, required: true },
    altitude:   { type: Number },
    speed:      { type: Number },
    heading:    { type: Number },
    battery:    { type: Number, min: 0, max: 1 },
    source:     { type: String, enum: ['background', 'event', 'locate', 'theft_signal'], default: 'background' },
    recordedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// The only read shape that matters: one device's trail, newest first.
LocationPingSchema.index({ userId: 1, deviceId: 1, recordedAt: -1 });
// Dedupe: a retried batch must not double-write the same fix.
LocationPingSchema.index({ deviceId: 1, recordedAt: 1 }, { unique: true });
// Ceiling matches the longest plan window; per-plan trimming is a scheduled job.
LocationPingSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });
export const LocationPing = mongoose.model<ILocationPing>('LocationPing', LocationPingSchema);

// ─── Guardian ─────────────────────────────────────────────────────────────────
// Someone the owner trusts. Alerted by email, with a time-limited live-location
// link, when the phone may have been taken. Guardians need no app or account.

export interface IGuardian extends Document {
  _id:              Types.ObjectId;
  userId:           Types.ObjectId;
  name:             string;
  email:            string;
  alertOnGuard:     boolean;
  /** Lets the guardian stop the emails without an account. */
  unsubscribeToken: string;
  createdAt:        Date;
}

const GuardianSchema = new Schema<IGuardian>(
  {
    userId:           { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name:             { type: String, required: true, trim: true },
    email:            { type: String, required: true, lowercase: true, trim: true },
    alertOnGuard:     { type: Boolean, default: true },
    unsubscribeToken: { type: String, required: true, unique: true },
  },
  { timestamps: true },
);

GuardianSchema.index({ userId: 1, email: 1 }, { unique: true });
export const Guardian = mongoose.model<IGuardian>('Guardian', GuardianSchema);

// ─── ShareLink ────────────────────────────────────────────────────────────────
// A guardian's view of where the phone is. Only the SHA-256 of the token is
// stored, so a database read can't be turned into working links.

export interface IShareLink extends Document {
  _id:       Types.ObjectId;
  userId:    Types.ObjectId;
  deviceId:  string;
  tokenHash: string;
  reason:    string;
  expiresAt: Date;
  createdAt: Date;
}

const ShareLinkSchema = new Schema<IShareLink>(
  {
    userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deviceId:  { type: String, required: true },
    tokenHash: { type: String, required: true, unique: true },
    reason:    { type: String, default: '' },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

ShareLinkSchema.index({ userId: 1 });
ShareLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const ShareLink = mongoose.model<IShareLink>('ShareLink', ShareLinkSchema);
