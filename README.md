# PhantomShield — Full Monorepo

**Your phone. Your eyes. Always.**

This repository contains all three production services for PhantomShield:

```
phantomshield/
├── mobile/      ← React Native (Expo) mobile app
├── backend/     ← Node.js + Fastify REST API + WebSocket
└── dashboard/   ← Next.js 14 web dashboard
```

---

## Architecture Overview

```
┌─────────────────┐     HTTPS/WSS      ┌──────────────────────┐
│  Mobile App     │◄──────────────────►│  Backend API         │
│  (React Native) │                    │  (Fastify + Node.js) │
└─────────────────┘                    │                      │
                                       │  ┌────────────────┐  │
┌─────────────────┐     HTTPS/WSS      │  │ MongoDB Atlas  │  │
│  Web Dashboard  │◄──────────────────►│  │ Redis          │  │
│  (Next.js 14)   │                    │  │ BullMQ         │  │
└─────────────────┘                    └──────────────────────┘
```

---

## Quick Start — All Three Services

### Prerequisites

| Tool       | Version  |
|------------|----------|
| Node.js    | ≥ 20.x   |
| npm        | ≥ 10.x   |
| MongoDB    | Atlas or local |
| Redis      | ≥ 7.x (local or Upstash) |
| Expo CLI   | `npm i -g expo-cli` |
| EAS CLI    | `npm i -g eas-cli` |

---

### 0. Install (monorepo)

This is an npm-workspaces monorepo. Install once from the repo root — it links
the shared contract package (`@phantomshield/shared`) into every service:

```bash
npm install                # at the repo root
npm run typecheck          # builds shared + typechecks all workspaces
npm test                   # backend unit tests
```

### 1. Backend

```bash
cd backend
cp .env.example .env       # Fill in your secrets
npm run dev                # Starts on http://localhost:3002
```

**Required `.env` values:**
```
MONGODB_URI=mongodb+srv://...
REDIS_URL=redis://localhost:6379
JWT_SECRET=<64-char random string>
JWT_REFRESH_SECRET=<64-char random string>
```

**API Health check:**
```bash
curl http://localhost:3002/health
```

---

### 2. Dashboard

```bash
cd dashboard
cp .env.local.example .env.local   # Set API URL
npm install
npm run dev                         # Starts on http://localhost:3000
```

Open: http://localhost:3000 → redirects to `/dashboard`

---

### 3. Mobile App

```bash
cd mobile
npm install
npx expo start             # Scan QR with Expo Go, or:
npx expo start --ios       # iOS simulator (Mac only)
npx expo start --android   # Android emulator
```

For full feature testing (biometrics, camera, background tasks), use a **development build**:
```bash
eas build --profile development --platform ios
eas build --profile development --platform android
```

---

## Phase Summary

### Phase 1 — Auth + Sync (✅ Complete)
- Google + Apple OAuth sign-in (provider ID token verified server-side)
- JWT access tokens (15min) + rotating refresh tokens (7 days)
- Device binding — tokens are tied to a per-device id, scoped per user
- Batch event sync with an optional checksum corruption guard
- Intruder event upload with monthly plan limits
- Retention enforcement per plan (7/30/90 days)
- All routes rate-limited via Redis

### Phase 2 — Real-Time Dashboard (✅ Complete)
- WebSocket server (`/ws`) with JWT auth and heartbeat
- Live event broadcasting: anomaly alerts, intruder alerts
- Device presence tracking via Redis TTL keys
- Remote device commands: lock, wipe logs, alert sound
- Command queue for offline devices (persisted in Redis)
- Next.js 14 dashboard with Overview, Activity, Vault, Devices, Settings
- Auto-reconnecting WebSocket client with live alert toasts

### Phase 3 — Push Notifications (✅ Complete)
- Expo push notification integration (iOS + Android)
- BullMQ job queue for reliable delivery with retries
- Notification templates: anomaly alert, intruder alert, device actions
- Push token registration and management endpoints
- Invalid token auto-cleanup on receipt errors

---

## Deployment

### Backend → Railway

```bash
cd backend
railway login
railway new
railway add mongodb redis
railway up
```

Or use the included `Dockerfile`:
```bash
docker build -t phantomshield-backend .
docker run -p 3001:3001 --env-file .env phantomshield-backend
```

### Dashboard → Vercel

```bash
cd dashboard
vercel
# Set env vars in Vercel dashboard:
# NEXT_PUBLIC_API_URL=https://api.phantomshield.app/api
# NEXT_PUBLIC_WS_URL=wss://api.phantomshield.app
```

### Mobile → EAS (App Store / Play Store)

```bash
cd mobile
eas build --platform ios     --profile production
eas build --platform android --profile production
eas submit --platform ios
eas submit --platform android
```

---

## Environment Variables Reference

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3002) |
| `NODE_ENV` | No | `development` or `production` |
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `REDIS_URL` | ✅ | Redis connection URL |
| `JWT_SECRET` | ✅ | 64-char secret for access tokens |
| `JWT_REFRESH_SECRET` | ✅ | 64-char secret for refresh tokens |
| `EXPO_ACCESS_TOKEN` | No | For Expo push notifications |
| `R2_ACCOUNT_ID` | No | Cloudflare R2 for photo storage |
| `FRONTEND_URL` | No | Allowed CORS origin |

### Dashboard (`dashboard/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | ✅ | Backend API base URL (include `/api`) |
| `NEXT_PUBLIC_WS_URL` | ✅ | WebSocket URL (`wss://...`) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | ✅ | Google OAuth Web client ID (sign-in) |

### Mobile (`mobile/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `EXPO_PUBLIC_API_URL` | ✅ | Backend API base URL (include `/api`, port 3002) |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | ✅ | Google OAuth Web client ID |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | ✅ | Google OAuth iOS client ID |
| `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` | ✅ | Google OAuth Android client ID |

---

## Security Checklist (Before Launch)

- [ ] Generate strong JWT secrets (use `openssl rand -hex 64`)
- [ ] Enable HTTPS/TLS on all endpoints (Railway/Vercel handle this)
- [ ] Set `NODE_ENV=production` on backend
- [ ] Configure Cloudflare R2 for encrypted photo storage
- [ ] Set up Sentry for error tracking (backend + mobile)
- [ ] Run MobSF static analysis on the mobile APK/IPA
- [ ] Run OWASP Top 10 audit on backend API
- [ ] Set up a private bug bounty program (HackerOne)
- [ ] Test certificate pinning on mobile
- [ ] Enable MongoDB Atlas IP allowlist
- [ ] Enable Redis AUTH password
- [ ] Enable RevenueCat for subscription management

---

## Scaling Notes

### For 100K → 1M users

| Bottleneck | Solution |
|------------|---------|
| WebSocket at scale | Replace in-process Map with Redis Pub/Sub across instances |
| MongoDB reads | Add read replicas + cache frequent queries in Redis |
| Push queue | Move BullMQ worker to separate Railway service |
| Image storage | Cloudflare R2 with worker-side encryption |
| API throughput | Add Railway auto-scaling or deploy to multiple regions |
| Rate limiting | Already Redis-backed — scales horizontally |

---

## License

Proprietary — © 2025 BonhomieInc / PhantomShield. All rights reserved.

*Built with precision. Secured by design.*
