import mongoose, { Schema, Document, Types } from 'mongoose';
import { PlanId, OAuthProvider } from '@/types';

// ─── User ─────────────────────────────────────────────────────────────────────

export interface IUser extends Document {
  _id:            Types.ObjectId;
  email:          string;
  name?:          string;
  photo?:         string;
  // Auth
  provider:       OAuthProvider;
  googleId?:      string;
  appleId?:       string;
  passwordHash?:  string;   // kept for potential future email/pass option; not used in OAuth flow
  // Plan
  plan:           PlanId;
  planExpiresAt:  Date | null;
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
    email:         { type: String, required: true, unique: true, lowercase: true, trim: true },
    name:          { type: String, default: null },
    photo:         { type: String, default: null },
    provider:      { type: String, enum: ['google', 'apple'], required: true },
    googleId:      { type: String, default: null, sparse: true },
    appleId:       { type: String, default: null, sparse: true },
    passwordHash:  { type: String, default: null, select: false },
    plan:          { type: String, enum: ['free', 'guard', 'elite'], default: 'free' },
    planExpiresAt: { type: Date, default: null },
    referralCode:  { type: String, default: null, unique: true, sparse: true },
    referredBy:    { type: Schema.Types.ObjectId, ref: 'User', default: null },
    referralCount: { type: Number, default: 0 },
    isActive:      { type: Boolean, default: true },
    lastLoginAt:   { type: Date, default: null },
  },
  { timestamps: true },
);

UserSchema.index({ email: 1 });
UserSchema.index({ googleId: 1 }, { sparse: true });
UserSchema.index({ appleId: 1 },  { sparse: true });
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
  },
  { timestamps: true },
);

DeviceSchema.index({ userId: 1 });
DeviceSchema.index({ deviceId: 1 }, { unique: true });
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
ActivityEventSchema.index({ eventId: 1 }, { unique: true });
ActivityEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
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
IntruderEventSchema.index({ eventId: 1 }, { unique: true });
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
