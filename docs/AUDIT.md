> **Historical document.** Superseded by `docs/STORE_COMPLIANCE.md` (2026-09-21): the backend now runs on MongoDB only (no Redis/BullMQ/R2) and the AdMob SDK was removed.

# PhantomShield — Codebase Audit & Remediation Report

**Date:** 2026-08-29
**Scope:** Full monorepo — backend API (Fastify/MongoDB/Redis), web dashboard (Next.js), mobile app (Expo/React Native), shared package, and cross-cutting infrastructure.
**Method:** Four parallel deep read-only audits (backend, dashboard, mobile, infra), each finding verified against the code, followed by an implementation pass. Every change was validated with typecheck, the backend test suite, and a production dashboard build.

**Status:** All actionable findings fixed except three that require external credentials or a major framework upgrade (see [§7 Deferred](#7-deferred-items-need-a-decision-or-credentials)).

**Verification at completion:**
- `npm run typecheck` — clean across shared, backend, dashboard, and mobile.
- `npm test` — 22/22 backend tests pass.
- `dashboard` `next build` — compiles successfully with middleware active.
- Backend production build (`tsc && tsc-alias`) boots without module-resolution errors.
- Lockfile is `npm ci`-consistent.

---

## 1. Summary by severity

| Severity | Found | Fixed | Deferred |
|----------|:-----:|:-----:|:--------:|
| Critical | 6 | 6 | 0 |
| High | 14 | 12 | 2 |
| Medium | 20 | 19 | 1 |
| Low | 20+ | 18 | several (cosmetic/noted) |

The single most important finding was that **the backend could not start in production** — the compiled output still contained unresolved `@/*` path aliases (`MODULE_NOT_FOUND` on boot). This is fixed.

---

## 2. Backend

### Critical
- **Production build could not boot** — `tsc` emitted `require("@/models")` verbatim and `node dist/index.js` had no path resolver. **Fix:** added `tsc-alias` to the build (`tsc && tsc-alias`), rewriting aliases to relative paths. Verified the compiled bundle boots.
- **Apple Sign-In account takeover** — after the first sign-in Apple omits the email, and the code trusted the client-supplied `appleUserData.email` for account lookup, letting an attacker with their own valid Apple token log into a victim's account by email. **Fix:** provider tokens now carry an `emailVerified` flag; email-based account linking happens only on a provider-verified email, never on client-supplied data.
- **IDOR on intruder photos** — the client-supplied R2 object key was stored verbatim and later signed for download, so a user could request a signed URL for another user's (deterministically-named) photo. **Fix:** the object key is now derived server-side from the authenticated user + event id, and downloads are additionally prefix-checked (`intruder/<userId>/`).
- **RevenueCat webhook failed open** — when `REVENUECAT_WEBHOOK_SECRET` was unset the auth check was skipped, letting anyone grant/revoke any plan. **Fix:** the endpoint now fails closed (503) when the secret is missing, and uses a constant-time comparison.
- **Docker image was broken for the monorepo** — copied only the backend manifest (no root lockfile, `@phantomshield/shared` unresolvable) and ran as root. **Fix:** rewrote as a 3-stage build from the repo root that installs the workspace, builds shared then backend, runs as `USER node`, and adds a `HEALTHCHECK`.
- **Global-unique `eventId`/device indexes enabled cross-user attacks** — a global-unique `eventId` let one user pre-insert another's predictable id to permanently block their sync; a global-unique `deviceId` let a caller clobber another account's device record. **Fix:** all made compound-unique per `userId`.

### High
- **Access tokens were never revocable** — the jti blocklist was dead code; logout/suspension left tokens usable for up to 15 min. **Fix:** access tokens now carry a `jti`, logout blocks it, and `authenticate` + the WS handshake check the blocklist.
- **Stale plan claim** — a cancellation/upgrade didn't take effect until token expiry. **Fix:** `authenticate` now syncs the effective plan from the DB (accounting for expiry) onto the request; `GET /billing/plan` reports the effective plan.
- **WS token in URL query string** — leaked the JWT into proxy/access logs. **Fix:** single-use, 30-second WS tickets minted by `POST /auth/ws-ticket` and consumed once at handshake (`getdel`); the raw JWT path remains only as a fallback.
- **Rate limiter keyed only by IP** — the limiter ran before `authenticate`, so per-user limiting never worked. **Fix:** keyed on a hash of the bearer token when present, else IP.
- **Race conditions** — refresh-token rotation (double-spend), OAuth find-or-create (duplicate-key 500s), referral redemption (double reward), and `insertMany` dedupe races were all non-atomic. **Fix:** atomic `findOneAndUpdate` claim-and-revoke for refresh rotation; E11000-tolerant upsert/retry for OAuth, referrals, and event inserts.

### Medium
- Missing-body 500s on `logout`/`DELETE /me` (now `?? {}`), unvalidated date/number query params (now bounded parsers, plan-window clamped), per-request retention `deleteMany` (now gated to once/hour/user via Redis), per-request `lastSeen` writes (now throttled to once/60s/device), Mongo reconnect listener leak + `process.exit` on transient drops (listeners bound once, driver auto-reconnects), non-atomic command queue (`LRANGE`+`DEL` → `MULTI`; `LPUSH` → `RPUSH` for FIFO), dead WS connections never reaped (protocol ping/pong + `terminate`), duplicate WS command delivery, graceful shutdown not closing DB/Redis/worker, presigned PUT with no content constraints (**now signs `content-type` so only `image/jpeg` uploads are accepted**), `/dashboard/health` unauthenticated.

### Low / hygiene
- Removed unused dependencies: `argon2` (heavy native module), `otplib`, `qrcode`, `date-fns`, `@fastify/cookie`, `@types/qrcode`, and the dead `@fastify/multipart` registration.
- Pinned the backend toolchain to **TypeScript 5.9.3** (via a root `overrides`, unifying all workspaces) and **`@types/node` 20** to match the Node 20 runtime — it had drifted to TS 6.x / `@types/node` 25.
- Corrected `.env.example` (removed unused `JWT_REFRESH_SECRET`, `MASTER_ENCRYPTION_KEY`, `TOTP_APP_NAME`, `R2_PUBLIC_URL`; added `GOOGLE_CLIENT_SECRET`).

---

## 3. Dashboard

### Security
- **BFF session model** — tokens live in httpOnly cookies (never in browser JS), and all backend traffic is proxied same-origin through `/api/backend/*`. This was the architecture in place; the audit hardened it:
  - **Proxy allowlist + path-traversal guard** — the catch-all proxy now rejects `..`/encoded segments and only forwards a fixed set of route prefixes, so it can't be used to reach backend auth/internal routes with the user's token.
  - **CSRF defense** — same-origin (`Origin`/`Referer`) checks on login, logout, and every mutating proxied request (SameSite=lax alone is insufficient).
  - **WS ticket flow** — the BFF exchanges the session for a single-use backend ticket instead of handing the browser a real access token.
  - **Server-side deviceId binding** — the deviceId is persisted in an httpOnly cookie at login and used for refresh, instead of trusting a client header.
  - **CSP + HSTS** added; `images.domains` migrated to `remotePatterns`; Next bumped to the latest 14.x patch.
- **Server-side auth gate** — `middleware.ts` redirects unauthenticated `/dashboard/*` requests before any dashboard code is served.

### Bugs / UX / accessibility
- WebSocket hook rewritten: no reconnect-after-unmount leak, no setState-after-unmount, single latest-handler ref (no handler accumulation), StrictMode-safe, tri-state status.
- Fixed the broken "View All anomalies" deep link (now reads `?anomalous=true`), the device action loading spinners (case-mismatched keys), swallowed activity errors, and the vault modal never showing the photo.
- Responsive: fixed 256px sidebar replaced with a `lg:`-gated sidebar + mobile hamburger drawer.
- Accessibility: vault tiles are keyboard-operable, the modal has `role="dialog"`/`aria-modal`/Escape-to-close, decorative emoji are `aria-hidden`, spinners expose `role="status"`.
- Removed unused deps (`js-cookie`, `qrcode.react`, `tailwind-merge`, `@types/js-cookie`).

---

## 4. Mobile

The core security primitives were already sound (PINs salted-hashed in SecureStore, tokens in SecureStore, HTTPS default, no hard-coded secrets). Fixes addressed logic and store-compliance gaps:

### High
- **Unconfigured PIN layers opened on any input** — a skipped layer's gate accepted any 4-digit entry and revealed the Vault. **Fix:** the gate now verifies against an *effective* layer (this layer's PIN, or the first configured layer as fallback); it only opens freely when the app has no PIN anywhere.
- **Decoy dashboard was escapable** via the Android hardware back button, revealing the real app underneath. **Fix:** the decoy blocks hardware back and locks all layers on entry (duress dead-end).
- **Guard Mode ran with no visible indicator** (Google Play stalkerware risk). **Fix:** a persistent "armed" notification is presented while watching and dismissed on stop.
- **Advertised anti-theft alarm never sounded** — a complete siren service existed but was never called. **Fix:** wired the siren to the remote "alert" command (find-my-phone), with a 60-second safety cap and manual silence on owner unlock; corrected the iOS background-audio mismatch by not requesting an undeclared capability.

### Medium
- App re-locked on every transient `inactive` transition (Control Center, notification shade, the biometric prompt itself), causing a re-gate loop — now locks only on genuine `background`.
- Brute-force lockout was global across all gates — now namespaced per context, so the Guard-stop pad can't lock the app gate.
- Keyboard covered inputs in the safe-zone and invite modals — wrapped in `KeyboardAvoidingView`.
- Several mutating settings actions bypassed the PIN gate (Activity Tracking toggle, safe-zone enable/delete) — all now routed through `requirePin`.
- Guard Mode battery: the kept-awake armed screen now auto-dims to near-black after idle (OLED-friendly, tap to wake) and sets the "keep app open" expectation.

### Low
- Sentry now sets user context (id only, no PII); invite screen distinguishes a load failure from signed-out and offers retry; PinPad keys/dots have accessibility labels; Restore Purchases gives feedback; the `autoWipeAfterAttempts` feature is now enforced (local log/photo wipe after the configured number of failed attempts); the `decoyPinSet` flag is kept in sync.

---

## 5. Shared package & infra

- `@phantomshield/shared` verified: exports correct, committed `dist/` in sync with `src/`.
- No secrets are tracked by git (`.env`, keystores, `sentry.properties`, `.xcode.env.local` all correctly ignored).
- Root `test` script now fans out across workspaces (`--if-present`).
- README corrected: documents the dashboard BFF/`API_URL` model and removes the non-existent `JWT_REFRESH_SECRET`/`MASTER_ENCRYPTION_KEY` requirements.

---

## 6. What was verified sound (do not "fix")

- PIN hashing, SecureStore token storage, timing-safe comparison, and persisted lockout on mobile.
- Zustand `partialize` correctly excludes `isAppUnlocked`/`unlockedLayers`/`guardArmed` from persistence.
- WebSocket horizontal scaling — the in-memory connection map is correctly complemented by Redis pub/sub.
- Sentry configured with PII off (`sendDefaultPii:false`, no screenshots/view hierarchy); analytics send device-id + non-PII only.

---

## 7. Deferred items (need a decision or credentials)

1. **Real AdMob IDs** — `mobile/app.json` ships Google's public *test* app IDs and the interstitial unit IDs are blank. This is a store-submission blocker that requires your real AdMob account IDs — it cannot be filled in automatically.
2. **Next.js 16 upgrade** — the remaining `npm audit` high-severity advisories (image-optimizer DoS, request smuggling, RSC DoS) are fixed only in Next 16, a major-version migration with breaking changes. The dashboard is on the latest 14.x patch; upgrading warrants its own scoped effort with regression testing.
3. **`gaxios`/`uuid` (moderate, transitive)** — pulled in by `google-auth-library@9`; resolving it needs a major bump of that library, which sits on the critical OAuth-verification path and should be upgraded deliberately, not blindly.

**Also for pre-release (documented in `docs/STORE_COMPLIANCE.md`):** reconcile the Android permission table with the actual `app.json` manifest after `expo prebuild`.

---

## 8. Notes for reviewers

- Changes touch ~55 source files; the large line count in `git diff --stat` is dominated by `package-lock.json` churn from removing the native `argon2` dependency.
- No commits or pushes were made — all changes are in the working tree for review.
