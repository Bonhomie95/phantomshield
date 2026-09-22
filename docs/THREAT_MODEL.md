# PhantomShield — Threat Model

This document states plainly who PhantomShield is designed to protect its users
*from*, what it actually guarantees, and — just as importantly — what it does
**not**. It exists because a security product that hasn't written this down is
guessing, and because several of the app's own claims have historically
overstated what the code does.

Last reviewed: 2026-09-01.

---

## 1. What we protect

| Asset | Where it lives | Why it matters |
|---|---|---|
| Intruder photographs | App-private storage on device; MongoDB (IntruderPhoto) when backed up | Images of an identifiable person, often captured without their knowledge |
| Location fixes | Attached to intruder/Guard events | Reveals where the owner (and the phone) was |
| Activity & unlock log | Device + MongoDB | A behavioural record of the owner's day |
| PINs (5 layers, incl. decoy) | OS keychain, salted-hashed | Gate the entire product; the decoy PIN is a duress control |
| Auth tokens | OS keychain (mobile), httpOnly cookies (web) | Full account access |
| Account identity | MongoDB | Email/name from OAuth |

---

## 2. Adversaries

The unusual thing about this product is that its primary adversary is a person
who is **physically holding the device**, and is often known to the owner.

### A1 — The snooper (partner, family member, colleague)
*Has:* physical access, sometimes the device passcode, sometimes social leverage.
*Wants:* to read the owner's messages, apps, and whereabouts; and to find out
whether they are being monitored.

**Controls:** per-layer PIN gates; PINs salted-hashed in the keychain; escalating,
persisted brute-force lockout that survives a force-quit; intruder snapshot on
failed entry; screen-capture prevention on the Vault, PIN, and Guard screens.

**Known limits:** a snooper who knows the *real* PIN sees everything. The app
does not resist someone who legitimately knows the owner's credentials.

### A2 — The coercer (duress)
*Has:* everything A1 has, plus the ability to demand a PIN.
*Wants:* to force the owner to unlock in their presence.

**Controls:** the decoy PIN opens a plausible, benign dashboard rather than an
obviously empty one; the decoy locks all real layers and blocks the Android back
button so the real app cannot be reached behind it; stopping Guard Mode with the
decoy PIN shows a fake "All Clear" report and never reveals captured evidence.

**Known limits:** if the coercer knows a decoy exists and demands a *second*
PIN, the design does not help. This is inherent to duress systems.

### A3 — The thief
*Has:* the device, possibly after it was unlocked.
*Wants:* the device's value and/or its data.

**Controls:** app-level lock on cold start (biometric/PIN); Guard Mode records
movement, charger changes, and app switches with photo and location; remote lock
and log-wipe from the dashboard; an optional siren.

**Known limits — be honest about these:**
- Intruder capture fires only inside *PhantomShield's own* PIN pad. A thief who
  unlocks the phone with the device passcode and never opens the app triggers nothing.
- Guard Mode requires the app to be in the foreground; sensors pause otherwise.
- There is **no** device location tracking, no map, and no "find my phone".
- "Remote wipe" wipes *logs*, not the device.
- There is no SIM-change detection, uninstall protection, or boot persistence.

### A4 — The network attacker
*Has:* a position on the network path.

**Controls:** TLS everywhere (the API base URL defaults to HTTPS); short-lived
15-minute access tokens bound to a device id; rotating opaque refresh tokens
with reuse detection that revokes the family (the client refreshes single-flight
so parallel requests can't trip it); photo uploads accept JPEG bytes only.

**Known limits:** no certificate pinning. A user who installs a hostile root CA
(or an attacker who can) can intercept API traffic.

### A5 — The malicious or compromised account holder (abuse)
*Wants:* to use the product against someone else, or to abuse its economics.

**Controls:** the product is scoped to the owner's own device; onboarding and
the armed-state notification disclose monitoring; per-plan quotas on snapshots
and devices; referral redemption is atomic and single-use per account.

**Known limits:** we cannot technically prevent someone installing this on a
phone they control but do not own. This is why the store positioning, the
persistent Guard Mode notification, and the disclosure copy are treated as
security controls, not marketing.

### A6 — The insider / infrastructure compromise
*Wants (or accidentally causes):* bulk access to stored evidence.

**Controls:** every photo read/write is scoped by the authenticated user id
(there is no client-supplied storage key); photos are served only through the
authenticated API; remote-command queues are keyed by user AND device; secrets
are environment-only.

**Known limits:** intruder photos and events in MongoDB are **not
end-to-end encrypted**. An operator with database access can read
them. The product must never claim otherwise in UI copy — and no longer does.

---

## 3. What we explicitly do NOT claim

Stating these prevents the copy from drifting back:

1. **Not end-to-end encrypted.** Data is encrypted in transit and at rest by the
   storage providers, not with a client-held key.
2. **No geofencing.** "Trusted Hours" are time-of-day windows only. There is no
   place-based rule. (Location is now tracked, but no rule fires on *entering or
   leaving a place* — that is a separate feature.)
3. **Location tracking is opt-in and visible.** It is off by default, requires an
   explicit confirmation, keeps the iOS blue indicator and the Android foreground
   notification on, and can never run silently. That visibility is a security
   control, not an oversight.
4. **Guard Mode's sensors are foreground-only.** Background sessions keep the
   location trail alive; motion and charger detection pause.
5. **No protection against a rooted/jailbroken device.** No root detection, no
   attestation, no anti-tamper.
6. **The PIN is 4 digits.** It resists shoulder-surfing and casual guessing with
   lockouts; it is not a cryptographic secret.

---

## 4. Residual risks, ranked

| # | Risk | Current state | Direction |
|---|---|---|---|
| 1 | Thief who never opens the app is undetected | **Partly closed** — SIM change/removal and the location trail now fire without the app being opened | Failed device-unlock detection still needs DeviceAdmin (Android only) |
| 2 | Evidence readable by infrastructure operator | Accepted, documented | Client-side envelope encryption, with the key-recovery trade-off understood |
| 3 | No certificate pinning | Accepted | Pin once the API domain and rotation process are stable |
| 4 | 4-digit PIN hashed with a single SHA-256 pass | Weak against an attacker who extracts the keychain | Move to a memory-hard KDF with a high iteration count |
| 5 | No root/jailbreak detection | Accepted | Add detection + a user-visible warning |
| 6 | No security audit log | Gap | Record who locked/wiped/deleted what, and when |

---

## 5. Review triggers

Revisit this document when: a new data class is collected; a new capture surface
is added; the plan/entitlement model changes; a new third-party SDK receives
user data; or after any security incident.
