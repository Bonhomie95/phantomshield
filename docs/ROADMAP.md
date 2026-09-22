> **Historical document.** Superseded by `docs/STORE_COMPLIANCE.md` (2026-09-21): the backend now runs on MongoDB only (no Redis/BullMQ/R2) and the AdMob SDK was removed.

# PhantomShield — Maturity Assessment & Roadmap to Industry Standard

**Date:** 2026-09-01
**Question asked:** *what are we missing, and how does this become industry standard?*
**Method:** a full read of all ~12,300 lines across the four packages by four
subsystem readers, then eight specialist analyses benchmarking the codebase
against what a category-leading consumer-security product does. Findings below
were spot-verified against the code before any of them were acted on.

> **Confidence note.** The automated verification pass did not complete (the run
> hit a session limit), so the specialists' claims arrived unchecked. Every
> finding acted on in §3 was therefore re-verified by hand against the source —
> and one claim was rejected outright as wrong (see §6). Two dimensions,
> **scale/cost** and **growth/monetization**, were never assessed. Treat the
> unactioned items in §5 as strong leads, not established fact.
>
> **Update (round 3):** the two missing dimensions were subsequently analysed —
> see §9. Their critical findings were each re-verified against the code before
> being acted on, and several turned out to be defects introduced by this very
> migration.

---

## 1. The honest verdict

The product is **well-built but not yet production-operable.** The code itself is
better than its surroundings: the security architecture is thoughtful (BFF with
httpOnly cookies, rotating refresh tokens with reuse detection, per-layer PIN
gates, a genuinely clever duress/decoy design), and after the previous audit
round it is materially hardened.

What is missing is nearly everything *around* the code. There was no CI, no error
tracking on two of three tiers, no metrics, no alerting, no backups, no runbook,
no API contract, no migration strategy, and — the finding that best captures the
gap — **the product's single most important feature was silently dead.** An
intruder alert reached nobody unless a web dashboard happened to be open at that
exact moment, because the push-notification functions were never called from
anywhere. Nothing in the stack would ever have revealed that.

Three themes explain most of the distance to industry standard:

1. **Nothing observes anything.** Failures were invisible by construction — which
   is how a dead alert pipeline, a permanently-bricked Redis client, and a
   data-losing sync outbox all coexisted with "passing" builds.
2. **Claims outran implementation.** The UI sold an AES-256 export that didn't
   exist, an alarm that never sounded, "Safe Zones" that had no geography, and
   consent switches that changed nothing. For a *security* product this is the
   most expensive category of debt: it is simultaneously a trust problem, a
   store-review problem, and a legal problem.
3. **The riskiest data had the weakest guarantees.** The app photographs
   identifiable people and records precise location, while the iOS privacy
   manifest declared it collected *nothing*.

None of this makes the product bad. It makes it **pre-operational**: the kind of
codebase that works on the developer's phone and fails silently in the world.

---

## 2. Scorecard

Scored 1–5, where 3 = merely functional and 5 = industry-leading.
Arrows show movement from the work in §3.

| Dimension | Before | Now | Note |
|---|:--:|:--:|---|
| Reliability & observability | 1 | **3** ↑ | Error tracking, correlation IDs, log redaction, crash safety, real readiness probe. Metrics/alerting still absent. |
| CI/CD & release engineering | 1 | **3** ↑ | Full CI pipeline added; deploy targets and release train still missing. |
| Testing & quality | 1 | **2** ↑ | Coverage now honest (11%, was reported as 55%); security regressions locked. No integration or E2E. |
| Security engineering | 2 | **3** ↑ | Threat model + disclosure policy written; Redis failure no longer logs everyone out. PIN KDF and pinning outstanding. |
| Privacy & compliance | 2 | **3** ↑ | Consent switches now actually gate capture; iOS manifest truthful; unused permissions stripped. DPIA/DSAR outstanding. |
| Data & API architecture | 2 | **2** | Migration made explicit rather than implicit-at-boot. Versioning, OpenAPI, idempotency outstanding. |
| Product/feature completeness | 2 | **2** | Evidence export now real; location tracking and OS-level theft triggers still absent. |
| UX, accessibility & i18n | 2 | **3** ↑ | WCAG failures fixed; honest copy. i18n and mobile a11y still thin. |
| Scale & cost | 2 | **3** ↑ | Assessed in round 3. Indexes, pool, payload caps, photo size and Guard fan-out fixed. Rollups and R2 lifecycle outstanding. |
| Growth & monetization | 1 | **2** ↑ | Assessed in round 3. Tiers restructured, billing revocation bug fixed, export gated. Analytics, trials and contextual paywalls outstanding. |

---

## 3. Fixed in this round

### Critical — the product didn't do what it promised

- **Intruder & anomaly alerts never reached the owner.** `notifyIntruderDetected`,
  `notifyAnomalyDetected` and `notifyDeviceRemoteAction` had **zero call sites**;
  the BullMQ worker drained an empty queue forever. Now wired into
  `POST /sync/intruder`, `POST /sync/events`, and the device lock/wipe routes —
  with the originating device deliberately **excluded**, so the handset in an
  intruder's hand never lights up and tips them off.
- **Sync silently lost data.** The outbox took the newest 50 events with no
  watermark and never checked the response, so a 4xx counted as success and
  anything beyond 50 was never uploaded. Replaced with a persisted, monotonic
  watermark that drains the full backlog oldest-first in 200-event batches,
  distinguishes retryable from permanent failures, and reports errors to Sentry.

### Critical — consent and legal exposure

- **The Location switch was decorative.** `locationEnabled` was read only to
  render the toggle; Guard Mode called `captureLocation()` unconditionally. GPS
  is now gated on the user's actual choice.
- **Guard Mode ignored the snapshot switch**, photographing people even with
  intruder snapshots turned off. Now gated — and the camera isn't even mounted
  when consent is absent.
- **The iOS privacy manifest declared zero collected data types** while the app
  transmits faces, precise location, email and device IDs, and bundles AdMob.
  Ten data types are now declared with purposes, in `app.json` (survives
  `prebuild`) and in the generated manifest.
- **Six unused, library-injected Android permissions** — including `RECORD_AUDIO`
  and `SYSTEM_ALERT_WINDOW` — are now blocked. An unexplained microphone
  permission on an app that silently photographs people is a Play-review red flag.

### High — operability

- **Redis outage no longer bricks the process or logs everyone out.** The retry
  strategy gave up permanently after ~11 seconds, leaving rate limiting,
  presence, command queues and the token blocklist broken until a manual restart
  — and because the blocklist check threw inside `authenticate`, every user got
  a 401. Reconnection is now unbounded, and the revocation check degrades open
  (loudly logged) rather than taking down auth.
- **Boot-time `syncIndexes()` removed from production.** It drops undeclared
  indexes and fails when building a unique index over existing duplicates, with
  every replica racing on every deploy — and its failure was swallowed as a
  warning. Now an explicit `npm run migrate:indexes` step; auto-sync in dev only.
- **Backend and dashboard had no error tracking.** Sentry added with PII
  scrubbing, plus `x-request-id` correlation IDs echoed to clients, pino
  redaction of tokens/credentials, and `unhandledRejection`/`uncaughtException`
  handlers on a service full of deliberate fire-and-forget promises.
- **Container healthcheck probed `/health`**, which cannot fail — a broken
  instance stayed in rotation forever. Now probes `/ready`, tolerant of blips.

### High — engineering foundations

- **CI now exists** (`.github/workflows/ci.yml`): typecheck, lint, test and build
  across all four packages, a shared-`dist` drift check, a dependency audit, and
  a smoke test that boots the compiled backend — the exact failure that shipped
  a non-starting build before.
- **`next lint` would have hung CI forever** (no ESLint config existed, so it
  prompts interactively). Fixed. **The backend was entirely unlinted**; it now
  has one, which immediately found four dead imports.
- **Coverage was lying** — 55% reported, 11.35% real, because Jest only
  instrumented files the tests happened to import. Now measured honestly with
  enforced floors, and **19 security regression tests** lock the previously-fixed
  vulnerabilities (webhook fail-open, IDOR key derivation, presign constraints,
  plan-expiry, referral abuse).

### Medium — honesty and accessibility

- **Evidence export is now real.** The Vault advertised an "AES-256 .pshield"
  export and a "PDF Report" that both dead-ended in *Coming Soon* alerts, while
  `export` is a sold entitlement. Replaced with a working JSON evidence file
  containing every event, times, locations and a **SHA-256 integrity digest** —
  suitable for an insurer or police report — shared via the OS share sheet.
- **The alarm is real, and optional.** The home screen and paywall sold an
  "anti-theft alarm"; Guard Mode was silent and the siren service was dead code.
  Added an explicit *Sound alarm on tamper* toggle (default off, preserving the
  silent-evidence design and the Play stalkerware posture), wired to the siren
  with a 60-second cap. Copy now matches behaviour everywhere.
- **"Safe Zones" renamed "Trusted Hours."** They are time-of-day windows with no
  geographic component; the old name promised geofencing that does not exist.
- **WCAG failures fixed.** The "faint" text token scored **2.1–2.6:1** on both
  clients — far below the 4.5:1 minimum — on the colour used for every section
  header and timestamp. Both clients now use one shared, AA-passing value.
- **Chart dates were off by one** for every user west of UTC (`new Date('2026-01-15')`
  parses as UTC midnight). Verified by reproduction, then fixed.
- **Threat model and disclosure policy written** (`docs/THREAT_MODEL.md`,
  `SECURITY.md`), including an explicit list of what the product does *not* claim.

**Verification:** typecheck clean across all four packages · 41 backend tests
passing (was 22) · backend lint 0 errors · dashboard lint clean · mobile lint 0
errors · backend builds and boots with no unresolved aliases · dashboard builds.

---

## 4. Roadmap

Sequenced by dependency and leverage — not by dimension.

### Phase 1 — Before a public launch *(the genuinely blocking set)*

| Item | Why | Effort |
|---|---|---|
| Deploy targets for backend + dashboard | A Dockerfile that nothing runs is not a deployment. Pick the host, commit the manifest, wire CI to it. | M |
| Staging environment | There is exactly one environment template per app, every value `localhost`. Nothing can be rehearsed. | M |
| Real secrets in EAS build profiles | Cloud builds currently ship with empty env vars — no working sign-in, billing, ads or crash reporting. | S |
| Real AdMob IDs | `app.json` still carries Google's public *test* IDs. Blocks store submission. | S |
| MongoDB backup + a **tested** restore | Users bought this to keep evidence. There is no backup plan at all. | M |
| Uptime monitoring + one alert route | Something must page a human. Today nothing tells anyone anything. | S |
| API integration test harness | 34 routes at 0% coverage; nothing can start the server without live Mongo/Redis. Use testcontainers. | L |

### Phase 2 — Operable and trustworthy

| Item | Why | Effort |
|---|---|---|
| Metrics + dashboards (RED per route, queue depth, WS gauges) | `wsGetConnectionCount()` already computes a perfect gauge exported to nobody. | M |
| SLOs and alerting on alert-delivery rate | The dead-push bug must be *impossible* to repeat silently. | M |
| Runbook + incident process | Failure mode here is a user's physical safety. | M |
| API versioning + minimum-app-version gate | The primary client is a store binary you cannot force-update. | M |
| OpenAPI contract from Fastify schemas | Not one of 34 routes declares a response schema. | M |
| Idempotency keys on mutating routes | A retried wipe re-runs a destructive `deleteMany`. | S |
| DSAR export + verified deletion of R2 objects | Deletion currently leaves photographs of identifiable people behind. | M |
| DPIA + records of processing | Legally expected for systematic monitoring + biometric-adjacent data. | L |
| E2E on both clients (Playwright / Maestro) | No test proves the core loop works end to end. | L |

### Phase 3 — Competitive

| Item | Why | Effort |
|---|---|---|
| **Device location + map + history** | The defining feature of the category is entirely absent. | L |
| OS-level theft triggers (SIM change, failed device unlock, boot) | Today a thief who never opens the app triggers nothing. | XL |
| Real Lost Mode (contact screen, photo-on-demand, true remote wipe) | "Remote wipe" wipes logs only. | L |
| Mobile WebSocket client | The app never opens one; remote commands are poll-only and expire in an hour. | M |
| Background-capable Guard Mode | Works only while foregrounded with the screen on. | L |
| Client-side envelope encryption for evidence | Would let the product honestly claim what its copy once did. | XL |
| i18n infrastructure | Everything is hardcoded English; retrofit cost only grows. | L |
| Feature flags / kill switch | Nothing can be disabled without a store release. | M |

---

## 5. Leads not yet acted on

Strong findings that were **not** re-verified by hand and are not yet fixed:

- 4-digit PINs use a single unsalted-iteration SHA-256 — a keychain read yields
  every PIN quickly. Move to a memory-hard KDF.
- No biometric re-enrollment invalidation; adding a new fingerprint may inherit access.
- On-device evidence vault is plaintext files plus a plaintext AsyncStorage index.
- No security audit log (who locked/wiped/deleted what, and when).
- Three list endpoints use three incompatible pagination models.
- Client-supplied timestamps are unbounded; retention and reads use different time bases.
- Paywall shows hardcoded USD to every user in every country.
- Retention promises in the privacy policy may not match what the code enforces.

---

## 6. Rejected

One specialist claimed the shipped Android manifest requests microphone,
overlay, storage and boot permissions **because `app.json` declares them**. It
does not — `app.json` declares six, all legitimate. The permissions are injected
by libraries into the *generated* manifest. The finding was right about the
symptom and wrong about the cause; the fix (`blockedPermissions`) reflects the
real mechanism.

The Expo template leftovers (`explore.tsx`, `modal.tsx`, `(auth)/login.tsx`,
`register.tsx`) were also reported as a concern; on inspection they are 1–2 line
`return null` stubs already hidden from routing. Cosmetic, deliberately left.

---

## 7. Decisions taken without asking

Recorded so they can be reversed knowingly:

1. **Token revocation degrades open on Redis failure.** Availability beats
   enforcing a bounded (15-minute) revocation window; failing closed would 401
   every user during a Redis blip. Logged loudly for alerting.
2. **Alarm defaults to OFF.** Preserves the silent-evidence design and the Play
   stalkerware posture; the alarm is now an explicit, honest opt-in.
3. **Evidence export is JSON, not encrypted or PDF.** Ships a real, useful
   artifact today with an integrity digest, instead of continuing to advertise
   an encrypted export that does not exist.
4. **Index sync is a migration, not a boot step.** Safer at the cost of one
   explicit deploy step.
5. **Intruder pushes exclude the originating device.** Alerting the phone in the
   intruder's hand is worse than useless.


---

## 9. Round 3 — the product concept, made real

The owner restated the product in one sentence: *"protect my phone and let me know
who does what on it while it's not with me — with logging and camera capture —
and a web version in case the phone is stolen."* That reframing exposed defects
no audit dimension had prioritised, because they were product-shaped, not
code-shaped.

### The concept was structurally broken on the free tier

A stolen free-tier phone uploaded **nothing** (`intruderSnapshots: 0`) and its
owner could not open the dashboard (`remoteDashboard: false`). The product was
useless at the exact moment it exists for. Fixed at the contract level:

- **Every tier can see its own evidence on the web.** `remoteDashboard: true` on
  free, starter and pro, locked by a test so a future pricing experiment cannot
  quietly remove it.
- **The event is always recorded; only the photo is metered.** `POST /sync/intruder`
  no longer 403s a whole request — what happened, when, where and on which layer
  is never withheld. The photo is the metered resource because it is the one
  that costs money.
- **Reads are ungated.** `/sync/events`, `/sync/intruder`, `/dashboard/overview`
  and `/dashboard/activity` are available on every tier; the plan clamps how far
  back you can look, not whether you can look.

### Live, not eventually

- **The mobile app now holds a WebSocket** (`services/realtime.ts`). It had none —
  remote commands were picked up only by a foreground poll, and queued commands
  expire after an hour, so "lock my stolen phone" usually did nothing.
- **A new `/dashboard/live` page** streams events as they arrive and carries the
  remote controls, with honest online/offline state per device.
- **A `locate` command** was added end to end: the device answers with its
  position, which appears in the timeline like any other evidence.

### Billing: free / starter / pro

| | Free | Starter | Pro |
|---|---|---|---|
| History | 7 days | 30 days | 365 days |
| Cloud photos / month | 5 | 50 | Unlimited |
| Devices | 1 | 3 | 10 |
| Web dashboard | ✅ | ✅ | ✅ |
| Remote lock / wipe / alarm / locate | — | ✅ | ✅ |
| Evidence export | — | ✅ | ✅ |
| Ads | Yes | None | None |

Legacy `guard`/`elite` values are mapped by `normalizePlan()` on every read path
and rewritten in place by `npm run migrate:indexes`, so existing subscribers keep
exactly what they paid for.

### Critical defects found by the two late analyses, and fixed

- **A single-device user received no alert at all.** Intruder pushes exclude the
  originating device (correctly — never light up the phone in a thief's hand),
  which on a one-device account meant the push reached nobody. Added an **email
  channel** with automatic fallback whenever a push reaches zero devices.
- **Cancelling a subscription revoked access immediately.** In RevenueCat
  `CANCELLATION` means auto-renew was turned off, not that access ended — a user
  who cancelled on day 2 lost 28 days they had paid for. Only `EXPIRATION` now
  ends access; `TRANSFER` is honoured.
- **Legacy plan rows crashed sign-in.** `PLAN_LIMITS[user.plan]` on a raw DB
  document was `undefined` for a pre-rename tier — a 500 on OAuth for exactly the
  longest-standing subscribers.
- **The push worker ran at concurrency 1** (~2–3 alerts/second), so the alert
  pipeline had a throughput ceiling instead of a missing call site.
- **Pro was sold 365 days of history against a 90-day TTL** — three quarters of
  what a subscriber paid for was being deleted.
- **An ad sat between "Start Guard Mode" and the sensors arming**, leaving the
  phone unwatched for up to six seconds. Ads are now off the security path
  entirely — including the stop screen, where one fired two lines after a
  five-star review prompt while the user was asking "was my phone touched?".
- **Evidence export was free for everyone** despite being a sold entitlement.
- **Photos were stored at full sensor resolution** (~1MB each); now downscaled in
  one place, roughly 8–10× smaller.
- **Guard Mode was an uncapped fan-out** — a hair-trigger at a 4s cooldown could
  emit ~15 events/minute, each a photo, an object, a row, a broadcast and a push
  job. Cooldowns raised and a server-side ceiling added.
- **Anomaly queries had no covering index** and the photo-quota count had none
  either; both scanned a user's whole history on hot paths.
- **The intruder photo list was the only uncapped persisted list**, growing until
  AsyncStorage silently failed.
- Plus: unbounded `encryptedPayload`, a 5MB body limit on an API that never
  receives files, a 10-connection pool that one dashboard load could exhaust, and
  the client ignoring the server's `photoQuotaReached` signal.

---

## 10. Round 4 — the things that cost money while you sleep

### Referral fraud is closed
The old flow paid both sides 30 days of Starter the moment a code was typed, with
no device check, no account-age check and no cap — so a second throwaway account
on the **same handset** minted free months, repeatable forever. Now:

- a **`Referral` ledger** records who referred whom, from which device and IP
  hash, and in what state — abuse you can't see is abuse you can't stop;
- redemption is **screened** for self-referral, shared-handset reuse, and a
  12/year cap per referrer;
- the reward is **held until the referred account activates** (PIN configured +
  a real Guard session + 24h old), so the payout follows a user rather than a
  signup;
- stacked grants are **clamped to 365 days**;
- twelve unit tests lock every rule.

### Revenue is measurable
A **`SubscriptionEvent` ledger** now appends every RevenueCat event with the plan
before and after, product, store, period, price and expiry. `User.plan` was
mutated in place with no history, which made MRR, churn, trial→paid, refund rate
and LTV literally uncomputable and left support unable to reconstruct a
customer's billing. An **hourly reconciliation job** shouts when the ledger goes
quiet while paid users exist — the webhook fails *closed* on a missing secret,
which is the default, so a misconfiguration would otherwise silently discard
every purchase.

### The storage bill stops compounding
Nothing ever deleted an object from R2: the row's TTL expired and orphaned the
image. Added `deleteObject`/`deleteUserPhotos`, a **daily photo reaper** that
removes images 15 days before their row expires (while the key is still known),
and deletion of the user's photos on **account deletion** — which was also a real
right-to-erasure gap, since photographs of identifiable people outlived the
account after the user was told everything was erased. Retention also moved off
the ingest path onto the same scheduler.

### The funnel is measurable
- **Identity resolution**: `$identify` binds the anonymous device to the account,
  so one person on two devices is one person and a server-side purchase joins to
  a client-side funnel. Person properties (plan, platform, version) make the
  funnel segmentable.
- **A durable queue** buffers events that fail to send — the ones fired during a
  theft, on poor connectivity, are exactly the ones that used to be dropped.
- **The missing events**: `app_opened` (retention was uncomputable without it),
  the whole permissions and PIN-setup funnel, `paywall_viewed` **with a `source`**
  so you can tell which entry point converts, dismissal, and the distinction
  between a cancelled and a failed purchase.
- **The dashboard had zero analytics** and is now the primary conversion surface;
  it reports sessions, sign-ins, live-page views, and `remote_command_blocked` —
  the clearest upgrade signal the product has.
- **`photoQuotaReached`** was computed server-side and thrown away; it now
  surfaces as an honest in-Vault notice ("the photo stayed on this device only")
  and the best-timed upgrade prompt in the app.

### Store compliance
Terms and Privacy links now appear **on the paywall itself** — App Store
Guideline 3.1.2 requires them there, and their absence is a known rejection
reason.

### Still open
Genuinely blocked on external decisions or larger projects: **deploy targets**
(needs your hosting choice), **real AdMob/RevenueCat credentials**, **annual SKUs
and trials** (store configuration, then a paywall variant), **device location
tracking and a map**, **OS-level theft triggers**, **background Guard Mode**,
**daily rollups** for dashboard aggregates, and **i18n**.


---

## 11. Round 5 — the three competitive gaps

The three items previously named as "the real competitive gaps". All three are
built; where a platform genuinely forbids something, the limit is stated in the
UI rather than papered over.

### Find My Phone — location tracking + map

**Mobile** (`services/locationTracking.ts`): a real background location task via
`expo-location` + `expo-task-manager`. `Balanced` accuracy with a 75m distance
filter and 5-minute deferred batching, so the OS wakes the app on movement
rather than on a timer and a stationary phone costs almost nothing. Fixes are
queued **to disk** and flushed in batches — a phone with no signal still reports
its whole trail once it reconnects, which is precisely the scenario that matters.

**Backend**: a `LocationPing` collection with a compound index on the only read
shape that exists (one device's trail, newest first), unique on
`(deviceId, recordedAt)` so a retried batch can't double-write. Ingest validates
every fix through tested rules (`lib/geo.ts`) — a trail claiming the phone was
at an impossible place or in the future would discredit the whole record.
`POST /devices/:id/location` accepts batches; `GET /devices/:id/locations`
returns a plan-clamped window.

**Dashboard** (`/dashboard/map`): Leaflet with CARTO dark tiles over
OpenStreetMap — no API key, no bill, and no extra data processor in the privacy
policy. Shows the trail as a polyline, the newest fix with its **accuracy
radius** (never implying a pin is exact), battery level, and live updates pushed
over the WebSocket. Loaded via `next/dynamic` so ~40KB of mapping code stays off
every other route.

**Available on every tier.** A phone you cannot find is the exact failure this
product exists to prevent; plans differ on how much *history* you keep. Locked
by a test, like the dashboard guarantee.

### OS-level theft triggers

`services/theftSignals.ts` closes the gap where a thief who unlocks the phone
normally and never opens the app triggered *nothing*:

- **SIM changed / removed** — the classic theft tell, detected by comparing
  carrier identity (MCC/MNC first, since carrier *names* change for benign
  reasons like roaming) against a baseline held in the keychain, so clearing app
  data doesn't reset it. Uses only network-operator fields, which need no extra
  Android permission — the SIM serial would require `READ_PHONE_STATE`, is
  restricted on Android 10+ anyway, and isn't worth the review scrutiny.
- A first run only **records** a baseline: a fresh install must never fire a
  theft alert at its own owner.
- Signals raise the highest-urgency alert in the product and **always email** as
  well as push, because the person who needs to read it has just lost the device
  a push would go to.

**What was attempted and removed:** a JS-only reboot detector inferred from
process uptime. It was wrong often enough to be worse than nothing — a detector
that cries wolf trains the owner to ignore the one that matters. Reboot,
power-off and failed-device-passcode detection all need native receivers
(Android) or are impossible (iOS); they are documented as absent rather than
faked.

### Background Guard Mode

Guard Mode used to stop dead the moment the app was backgrounded — exactly when
a phone is being taken. It now offers an explicit **"keep tracking in the
background"** option that holds the background location task open for the
session.

The honest part: neither platform permits continuous background accelerometer
access, so motion and charger sensing still pause. The UI says exactly that
("Location keeps reporting… motion and charger sensing still pause — the OS does
not allow them in the background"), and the armed screen shows whether
background tracking actually started rather than assuming permission was granted.

### Consent, deliberately visible
Background location is the most invasive thing this app can do, so: off by
default, an explicit confirmation dialog explaining what will happen, the iOS
blue location indicator left **on**, and Android's foreground-service
notification kept visible. A security app that can follow someone invisibly is a
stalkerware app. `docs/STORE_COMPLIANCE.md` now carries the Play
background-location declaration checklist, which reviewers reject vague
justifications for.

### Verification
Typecheck clean across all four packages · **76 tests** · 0 lint errors ·
backend and dashboard both build.

**Needs a device to verify:** the background location task, the foreground-service
notification and SIM-change detection cannot be exercised in a simulator or from
this environment. They are written against the SDK 54 API and typecheck, but the
smoke tests in `docs/STORE_COMPLIANCE.md §10a` must be run on real hardware
before release.
