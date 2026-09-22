# Testing on real phones (not localhost)

Everything talks to Render, so any phone on any network can test.

| Piece | URL |
|---|---|
| API | https://phantomshield-api.onrender.com (`/ready` shows DB + Redis status) |
| Web dashboard + guardian links | https://phantomshield-web.onrender.com |

The free Render plan sleeps after ~15 minutes idle; the first request then takes
~30–60 seconds. Upgrade the API service to Starter before real users.

## 1. One-time Render setup (dashboard → phantomshield-api → Environment)

Already set: `NODE_ENV`, `JWT_SECRET`, `REDIS_URL` (the Frankfurt "fault" Key
Value, internal URL, keys prefixed `phantomshield:`), Google client IDs,
`APPLE_BUNDLE_ID`, `DASHBOARD_URL`, `FRONTEND_URL`, `AWS_REGION`, `EMAIL_FROM`.

Add yourself (secrets are never copied by tooling):

| Variable | Value |
|---|---|
| `MONGODB_URI` | Your Atlas connection string. In Atlas → Network Access, allow `0.0.0.0/0` (Render has no fixed IP on free plans). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | SES/Mail Manager SMTP credentials — the simplest route, and what the local `.env` uses. Set these **or** the `AWS_*` pair below, not both. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Alternative to SMTP: an IAM user with only `ses:SendEmail`. |
| `AWS_REGION` | The region your SES identity lives in (currently `eu-central-1` — change if yours differs). |
| `EMAIL_FROM` | An address on your **verified** SES domain, e.g. `PhantomShield <alerts@yourdomain.com>`. |
| `EXPO_ACCESS_TOKEN` | expo.dev → Account settings → Access tokens (push notifications). |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Cloudflare R2 bucket for intruder photos. Leave blank to keep photos inside MongoDB (fine for testing, but the Atlas free tier is only 512MB). Give the bucket a 365-day lifecycle rule. |
| `REVENUECAT_WEBHOOK_SECRET` | Only once subscriptions are live. |

Check email works: Render → phantomshield-api → Shell →
`node dist/scripts/testEmail.js you@example.com`

## 2. Install the app on phones

```bash
cd mobile
npx eas-cli login
npx eas-cli build --profile preview --platform android   # APK link, ~40 MB
npx eas-cli build --profile preview --platform ios       # needs your Apple Developer account
```

- **Android:** open the link on the phone, download the APK, allow "install
  unknown apps". Anyone with the link can install it.
- **iPhone:** the first iOS build asks to register test devices
  (`npx eas-cli device:create` gives each tester a link to add their iPhone).
  Or use `--profile production` and TestFlight.

The `preview` profile already points at the Render API (see `eas.json`).

## 3. What to test

- Continue without an account → PIN → Protect tab → arm "On a table" → move the
  phone → Stop with PIN → report.
- Charger alarm (plug in first) and, on Android, Pocket alarm.
- Long-press the app icon → Arm Guard Mode. iPhone: "Hey Siri, arm PhantomShield".
- Sign in with Google → Settings → Guardians → add someone → they get an email.
- Web dashboard → Devices → Lost mode → the phone shows the message on its lock
  screen; "I'm the owner" + PIN clears it.
- Settings → Private photo backup → save the recovery key → web Vault asks for it.
- Wrong PIN with Intruder photos on → photo in Evidence and on the web Vault.
