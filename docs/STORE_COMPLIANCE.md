# PhantomShield — App Store & Google Play Submission Guide

Last verified: **2026-09-21** against the code in this repo.

Part A is what the code now guarantees. Part B is what only you can do (accounts,
keys, console forms) — every item is required unless marked optional. Part C
gives the exact answers for the privacy forms, matched to what the app really
collects. Part D is the review notes to paste in.

---

## A. Already handled in the code (verified)

| Area | State |
|---|---|
| Toolchain | Expo SDK 54 / RN 0.81: Android `targetSdk 36` (Play requirement since 2026-08-31), iOS built with Xcode 26 on EAS. `expo-doctor` 18/18. Release APK and iOS Release build compile locally. `SENTRY_DISABLE_AUTO_UPLOAD` is set in `eas.json` — without it every release build failed at the Sentry source-map upload (no Sentry org configured). |
| App icon / splash | Real PhantomShield icon (was the Expo template icon — an automatic rejection). iOS icon has no alpha; Android adaptive + monochrome icons; white notification icon. |
| Placeholder content | Removed the "Device manager coming in next update" alert, the empty `login`/`register`/`explore`/`modal` routes and all Expo template components. Settings → Manage devices is a real screen. |
| Purchases | `react-native-purchases` is installed and actually bundled (it was missing, and the old variable `import()` would have been stripped by Metro). Paywall shows only live store prices, title + period, auto-renew terms, Terms (EULA) + Privacy links, Restore, and Manage subscription. No "Coming soon" dead button. |
| Ads | AdMob SDK **removed** — ads were never shown anywhere, but the SDK shipped with Google's test app IDs and an advertising-ID declaration. The app now has no ad or tracking SDK; `AD_ID` permission is stripped. |
| Sign in with Apple | Offered on iOS (above Google). The authorization code is exchanged and the Apple token is **revoked on account deletion** (Guideline 5.1.1(v)) once `APPLE_TEAM_ID/KEY_ID/PRIVATE_KEY` are set. Re-signing up after deletion works even though Apple doesn't resend the email. |
| Account deletion | In-app (Settings → Delete Account), on the web dashboard, and a public page `/delete-account` (Play's web-deletion requirement). Deletes every collection incl. photos; warns that subscriptions must be cancelled in the store. |
| Permissions | Every permission is requested in context, after an explainer, only when the feature is switched on. Intruder photos are **opt-in** (default off). No permission prompt is ever shown to someone who entered a wrong PIN. iOS purpose strings are specific (the generic "Allow $(PRODUCT_NAME)…" microphone/motion strings are gone). |
| Android manifest | Declared: camera, biometrics, fine/coarse/background location, foreground service (location), notifications, vibrate. Blocked: usage stats, microphone, storage/media, phone state, boot receiver, overlay, AD_ID, media-playback foreground service, activity recognition. `allowBackup=false`. Verified in the compiled release APK (`targetSdk 36`). |
| iOS Info.plist | `UIBackgroundModes`: location (+ `processing`/`fetch` added by expo-background-task). `ITSAppUsesNonExemptEncryption=false`. Privacy manifest declares collected data + required-reason APIs. |
| Security fixes | Tab screens can't be reached by deep link without the biometric/PIN gate; PIN setup can't be opened by deep link; Android Back can't disarm Guard Mode; remote commands are scoped per user **and** device; removed devices lose their sessions; single-flight token refresh (parallel refreshes used to log users out); weak PINs and decoy==real PIN rejected. |
| Product focus (v1.0) | Activity logging, app-usage logging (`PACKAGE_USAGE_STATS`) and trusted hours were **removed** — the app is anti-theft only, which keeps it clear of both stores' stalkerware/monitoring policies. One app PIN (+ optional decoy) replaced five section PINs; old PINs still unlock once and are migrated. An account is optional. |
| Backend | Runs on **MongoDB**, with **optional Redis** (`REDIS_URL`) for short-lived state, shared rate limits and multi-instance WebSocket fan-out (no BullMQ/R2). Photos stored in MongoDB, JPEG-only, owner-scoped. Also fixed: the Mongo client required the missing `zstd` module, which would have failed every query against Atlas. |

---

## B. What you must set up (in this order)

### 1. Backend (deploy first — the app is useless without it)
- [ ] MongoDB Atlas cluster, IP allowlist, backups on. Put its URI in `MONGODB_URI`.
- [ ] Deploy `backend/` (Dockerfile, build context = repo root). `NODE_ENV=production`, `JWT_SECRET` (`openssl rand -hex 48`).
- [ ] Run once: `npm run migrate:indexes --workspace phantomshield-backend` (builds all indexes incl. TTLs).
- [ ] `GOOGLE_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID` (must match the app).
- [ ] Sign in with Apple key: App Store Connect → Users and Access → Keys → "Sign in with Apple" → download `.p8`. Set `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_BUNDLE_ID=dev.bonhomie95.phantomshield`.
- [ ] `EXPO_ACCESS_TOKEN`, `REVENUECAT_WEBHOOK_SECRET`, and Amazon SES (`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) + `EMAIL_FROM` on a verified SES identity.
- [ ] `FRONTEND_URL` / `DASHBOARD_URL` = your dashboard origin (CORS + email links).
- [ ] Your `backend/.env` still lists removed variables (`REDIS_URL`, `R2_*`, `MASTER_ENCRYPTION_KEY`, `JWT_REFRESH_SECRET`, `TOTP_APP_NAME`); they're ignored — delete them.
- [ ] Run **one** API instance for now (rate-limit counters and live sockets are per-instance; see README → Scaling).

### 2. Dashboard (hosts the privacy/terms/support/deletion pages the stores link to)
- [ ] Deploy `dashboard/` at `https://app.phantomshield.app` (or change the `EXPO_PUBLIC_*_URL` values). Set `API_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
- [ ] Recommended: Apple Services ID for web sign-in → `NEXT_PUBLIC_APPLE_SERVICES_ID` (dashboard) and `APPLE_SERVICES_ID` (backend); return URL `https://<domain>/auth/login`.
- [ ] Confirm these open without signing in: `/privacy`, `/terms`, `/support`, `/delete-account`.
- [ ] Make sure `privacy@phantomshield.app` and `support@phantomshield.app` mailboxes exist.

### 3. Store products & RevenueCat
- [ ] App Store Connect: create the app (bundle id `dev.bonhomie95.phantomshield`), a subscription group with two auto-renewable monthly products whose ids contain `starter` and `pro` (e.g. `phantomshield_starter_monthly`, `phantomshield_pro_monthly`). Add localized display names, a review screenshot of the paywall, and submit them **with** the app version.
- [ ] Play Console: the same two subscriptions (base plans monthly), activated.
- [ ] RevenueCat: add both apps, entitlements `starter` and `pro` attached to the matching products, a **current** offering containing both packages, webhook → `https://<api>/api/webhooks/revenuecat` with `Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>`, app user id = our user id (the app does this).

### 4. EAS
- [ ] Set EAS environment variables for `production` (the local `.env` is **not** uploaded): `EXPO_PUBLIC_API_URL` (**https**), the three `EXPO_PUBLIC_GOOGLE_*` ids, `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`, optional `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_POSTHOG_KEY`.
- [ ] Google OAuth Android client: add the SHA-1 of the **Play App Signing** key (Play Console → Setup → App signing) *and* the EAS upload key (`eas credentials`). Without the Play one, Google sign-in fails only in the store build.
- [ ] `eas build -p ios --profile production` and `eas build -p android --profile production`, then `eas submit`. Android submit needs a Play service-account JSON (`eas credentials` → Google Service Account).
- [ ] The iOS Google URL scheme in `app.json` (`com.googleusercontent.apps.119391523094-…`) must be the reversed **iOS** client id of the client you use.

---

## C. Privacy form answers

### App Store Connect → App Privacy
Tracking: **No** (no data is used for tracking; no ATT prompt needed).

| Data type | Collected | Linked to user | Purpose |
|---|---|---|---|
| Contact Info → Email Address | Yes | Yes | App Functionality |
| Contact Info → Name | Yes | Yes | App Functionality |
| Contact Info → Other User Contact Info (guardian name + email the owner enters) | Yes | Yes | App Functionality |
| User Content → Photos or Videos | Yes | Yes | App Functionality |
| Location → Precise Location | Yes | Yes | App Functionality |
| Identifiers → User ID | Yes | Yes | App Functionality |
| Identifiers → Device ID | Yes | Yes | App Functionality |
| Usage Data → Product Interaction | Yes | Yes | App Functionality, Analytics |
| Purchases → Purchase History | Yes | Yes | App Functionality |
| Diagnostics → Crash Data, Performance Data, Other Diagnostic Data | Yes | No | App Functionality |

This matches `ios.privacyManifests` in `mobile/app.json` — keep them in sync.

### Google Play → Data safety
- Collects/shares data: **Yes, collected; not shared** (processors are not "sharing"). Encrypted in transit: **Yes**. Users can request deletion: **Yes** (link `/delete-account`).
- Personal info: Email address, Name, User IDs — *App functionality, Account management*. Also guardian names and emails the owner enters (optional) — *App functionality*.
- Location: Precise and Approximate — *App functionality* (optional, user-enabled).
- Photos and videos: Photos — *App functionality* (optional).
- App activity: App interactions — *App functionality, Analytics*. (No installed-apps or other-app activity: usage access was removed.)
- Device or other IDs — *App functionality*.
- Financial info: Purchase history — *App functionality*.
- App info and performance: Crash logs, Diagnostics — *Analytics / App functionality*.
- Ads: **No**. Advertising ID: **No**.

### Play Console declarations
- [ ] **Location permissions (background)**: declare "Find My Phone — lets the owner locate their lost or stolen phone"; upload a ≤30s video: Settings → Find My Phone → confirmation dialog → OS "Allow all the time" → web map showing the trail.
- [ ] **Foreground service type `location`**: same justification and video.
- [ ] Target audience: 18+ (security tool). Content rating questionnaire: no objectionable content. Not a Families app.
- [ ] App access: "No login needed: tap Continue without an account. Cloud features (backup, Find My Phone, guardians) need any Google account."
- [ ] Privacy policy URL: `https://app.phantomshield.app/privacy`. Account deletion URL: `https://app.phantomshield.app/delete-account`.

### Store listing wording (stalkerware policies on both stores)
Always describe it as protecting **your own** phone. Never use "spy", "track someone", "monitor your partner/child/employee", or "hidden". Good: "Know if someone picks up your phone", "Find your lost phone", "Photo of whoever tries your PIN". Screenshots should show the Settings switches and the Guard Mode armed notification.

---

## D. App Review notes (paste into both consoles)

```
PhantomShield is an anti-theft app for the owner's own phone.

• No account needed: tap "Continue without an account", set a 4-digit PIN,
  then Guard Mode → Start. Move the phone; tap Stop and enter the PIN to see
  what was recorded. A notification shows while Guard Mode is on.
• Signing in (Apple or Google) adds cloud backup, the web dashboard, Find My
  Phone, lost mode and guardians. Account deletion: Settings → Delete Account.
• Camera is used only if the user turns on "Intruder photos" (onboarding or
  Settings); it photographs whoever enters a wrong PIN in PhantomShield or
  sets off Guard Mode. It never runs in the background.
• Guardians: people the owner adds by name and email. They receive one email
  saying they were added (with an unsubscribe link) and, only if the phone looks
  stolen, an email with a 24-hour link to its location. No other data is shared.
• Lost mode: from the web dashboard the owner can show a "this phone is lost,
  please call…" message on the phone's lock screen and in the app.
• Siri / Shortcuts: "Arm PhantomShield" opens the app and arms Guard Mode.
• Background location is used only by "Find My Phone" (Settings), which the
  user turns on after an explanatory dialog, so they can locate a lost or stolen
  phone from our web dashboard (https://app.phantomshield.app). The system
  location indicator stays visible while it runs; switching it off stops it.
• Subscriptions (Starter, Pro) are in Settings → Upgrade Plan.
```

---

## E. Pre-submission smoke test (on a real device, production build)
- [ ] Fresh install → Continue without an account → Choose your protection → set PIN → Protect tab. Then Settings → Sign in → back in the app, signed in.
- [ ] Upgrade from a build with section PINs: the old Settings/Dashboard PIN opens the app once and becomes the app PIN.
- [ ] Wrong PIN on the app gate with Intruder photos on → photo in Evidence and on the web Vault.
- [ ] Guardians: add one (welcome email arrives); simulate a SIM change or trip Guard Mode → guardian email → link shows the map; Unsubscribe works.
- [ ] Lost mode from the web → lock-screen notification + lost screen on the phone; "I'm the owner" + PIN clears it (also on the web).
- [ ] Private photo backup on → recovery key shown; web Vault opens photos only after entering it; a second phone asks for the key.
- [ ] Evidence → Create PDF report → PDF opens with photos, map links and digest (paid plan).
- [ ] Long-press app icon → Arm Guard Mode / Charger alarm; iOS: "Hey Siri, arm PhantomShield"; Android: pocket alarm fires when taken out of a pocket.
- [ ] Guard Mode: arm, Android Back does not leave, stop with PIN → report.
- [ ] Find My Phone on → trail on the web Map; off → indicator/notification disappears.
- [ ] Sandbox purchase upgrades the plan; Restore works; Manage subscription opens the store.
- [ ] Remote Locate / Alarm / Lock from the web on a Starter account.
- [ ] Settings → Manage devices lists this phone; removing another phone signs it out.
- [ ] Delete account → back to welcome; signing in with Apple again creates a fresh account.
