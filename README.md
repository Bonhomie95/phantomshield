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
│  Web Dashboard  │◄──────────────────►│  │ (only store)   │  │
│  (Next.js 14)   │                    │  └────────────────┘  │
└─────────────────┘                    └──────────────────────┘

MongoDB holds everything durable: accounts, events, locations, intruder photos
and the remote-command queue. Redis is optional (`REDIS_URL`): when set it takes
the short-lived state (token blocklist, WebSocket tickets, presence, throttles),
the shared rate-limit counters, and WebSocket fan-out between API instances.
Without it, MongoDB covers that too — one database is enough for one instance.
```

---

## Quick Start — All Three Services

### Prerequisites

| Tool       | Version  |
|------------|----------|
| Node.js    | ≥ 20.x   |
| npm        | ≥ 10.x   |
| MongoDB    | Atlas or local (≥ 6) |
| EAS CLI    | `npm i -g eas-cli` |

---

### 0. Install (monorepo)

This is an npm-workspaces monorepo, but the mobile app is intentionally NOT a
workspace (Expo/Metro need its deps co-located). Use `install:all` to install
the workspaces AND the standalone mobile app in one step:

```bash
npm run install:all        # root workspaces + mobile (standalone)
npm run typecheck          # builds shared + typechecks all workspaces + mobile
npm test                   # backend tests (set MONGODB_TEST_URI / REDIS_TEST_URL to include the integration suites)
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
JWT_SECRET=<random string, min 32 chars>
```
Refresh tokens are opaque random values stored hashed in MongoDB — there is no
separate refresh secret, and the refresh lifetime is fixed at 7 days server-side.

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
- JWT access tokens (15min) + rotating refresh tokens (7 days, single-flight refresh on the client)
- Device binding — tokens are tied to a per-device id, scoped per user
- Batch event sync with an optional checksum corruption guard
- Intruder event upload with monthly plan limits
- Retention enforcement per plan (7/30/90 days)
- All routes rate-limited

### Phase 2 — Real-Time Dashboard (✅ Complete)
- WebSocket server (`/ws`) with JWT auth and heartbeat
- Live event broadcasting: anomaly alerts, intruder alerts
- Device presence tracking via expiring keys (Redis sorted sets, or MongoDB)
- Remote device commands: lock, wipe logs, alert sound
- Command queue for offline devices (MongoDB, scoped per user + device)
- Next.js 14 dashboard with Overview, Live, Map, Vault, Devices, Settings, plus public guardian location links
- Auto-reconnecting WebSocket client with live alert toasts

### Phase 3 — Push Notifications (✅ Complete)
- Expo push notification integration (iOS + Android)
- In-process delivery with retries, email fallback
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
railway up                 # point MONGODB_URI at your Atlas cluster
```

Or use the included `Dockerfile`. It needs the repo root as the build context
(the backend depends on `@phantomshield/shared` and the root lockfile):
```bash
docker build -t phantomshield-backend -f backend/Dockerfile .
docker run -p 3002:3002 --env-file backend/.env phantomshield-backend
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
| `REDIS_URL` | ➖ | Optional Redis; required when running more than one API instance |
| `JWT_SECRET` | ✅ | Secret for access tokens (min 32 chars; server refuses to boot otherwise) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_IOS_CLIENT_ID` / `GOOGLE_ANDROID_CLIENT_ID` | ✅ | Google OAuth client IDs used to verify sign-in ID tokens |
| `EXPO_ACCESS_TOKEN` | No | For Expo push notifications |
| `APPLE_TEAM_ID` / `APPLE_KEY_ID` / `APPLE_PRIVATE_KEY` | ✅ (App Store) | Sign in with Apple key — lets account deletion revoke the Apple token (Guideline 5.1.1(v)) |
| `APPLE_SERVICES_ID` | No | Services ID for Sign in with Apple on the web dashboard |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `EMAIL_FROM` | Recommended | Amazon SES for alert and guardian emails (the only channel for a single-device user) |
| `FRONTEND_URL` / `DASHBOARD_URL` | No | Allowed CORS origins in production |
| `REVENUECAT_WEBHOOK_SECRET` | No* | Shared bearer secret for the RevenueCat webhook (*required if billing webhooks are enabled — the endpoint fails closed without it) |

> Refresh tokens are opaque random values hashed in MongoDB; there is **no**
> `JWT_REFRESH_SECRET`. The backend also does not use a `MASTER_ENCRYPTION_KEY`
> or `TOTP_APP_NAME` — remove any of these from local `.env` files.

### Dashboard (`dashboard/.env.local`)

The dashboard runs a server-side BFF layer (Next route handlers under
`src/app/api/**` plus `src/middleware.ts`): the browser holds **no** tokens —
sign-in stores the access/refresh tokens in httpOnly cookies, and every backend
call is proxied server-side through `/api/backend/*`, which attaches the token,
refreshes transparently, and enforces an Origin (CSRF) check.

| Variable | Required | Description |
|----------|----------|-------------|
| `API_URL` | ✅ (server) | Backend API base URL used by the server-side BFF (include `/api`). Falls back to `NEXT_PUBLIC_API_URL`; the app throws at startup in production if neither is set. |
| `NEXT_PUBLIC_API_URL` | ✅ | Backend API base URL (include `/api`) — public fallback for `API_URL` |
| `NEXT_PUBLIC_WS_URL` | ✅ | WebSocket URL (`wss://...`) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | ✅ | Google OAuth Web client ID (sign-in) |
| `NEXT_PUBLIC_APPLE_SERVICES_ID` | Recommended | Sign in with Apple on the web (iOS users who signed up with Apple need it) |

### Mobile (`mobile/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `EXPO_PUBLIC_API_URL` | ✅ | Backend API base URL (include `/api`, port 3002) |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | ✅ | Google OAuth Web client ID |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | ✅ | Google OAuth iOS client ID |
| `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` | ✅ | Google OAuth Android client ID |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `_ANDROID_KEY` | ✅ | RevenueCat public SDK keys (subscriptions) |
| `EXPO_PUBLIC_TERMS_URL` / `_PRIVACY_URL` / `_SUPPORT_URL` / `_DASHBOARD_URL` | ✅ | Public pages (defaults: app.phantomshield.app/…) |

> For EAS builds set these as **EAS environment variables** — `mobile/.env` is
> git-ignored and is not uploaded to EAS Build.

---

## Security Checklist (Before Launch)

- [ ] Generate strong JWT secrets (use `openssl rand -hex 64`)
- [ ] Enable HTTPS/TLS on all endpoints (Railway/Vercel handle this)
- [ ] Set `NODE_ENV=production` on backend
- [ ] Set up Sentry for error tracking (backend + mobile)
- [ ] Run MobSF static analysis on the mobile APK/IPA
- [ ] Run OWASP Top 10 audit on backend API
- [ ] Set up a private bug bounty program (HackerOne)
- [ ] Test certificate pinning on mobile
- [ ] Enable MongoDB Atlas IP allowlist and backups
- [ ] Enable RevenueCat for subscription management

---

## Scaling Notes

### For 100K → 1M users

| Bottleneck | Solution |
|------------|---------|
| More than one API instance | Set `REDIS_URL`: rate-limit counters, presence and WebSocket fan-out are then shared across instances |
| MongoDB reads | Add read replicas; widen the short overview cache in `config/kv.ts` |
| Alert delivery | In-process with retry; move to a Mongo-backed job collection for delivery across restarts |
| Photo storage | Photos go to Cloudflare R2 when `R2_*` is set, and stay inline in MongoDB (≤3MB each) otherwise. Give the bucket a 365-day lifecycle rule to match the row TTL |
| API throughput | Add Railway auto-scaling or deploy to multiple regions |

---

## License

Proprietary — © 2025 BonhomieInc / PhantomShield. All rights reserved.

*Built with precision. Secured by design.*
