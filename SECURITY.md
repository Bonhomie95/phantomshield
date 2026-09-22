# Security Policy

PhantomShield handles some of the most sensitive data a phone can produce:
photographs of people, precise location, and a log of how a device is used. We
take reports about that data seriously.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Email **security@phantomshield.app** with:

- what you found and where (file, endpoint, or screen),
- the steps to reproduce it,
- what an attacker could do with it,
- anything you need from us to verify a fix.

If you prefer, encrypt your report — ask for a key at that address first.

### What to expect

| Stage | Target |
|---|---|
| Acknowledgement of your report | 3 business days |
| Initial assessment and severity | 7 business days |
| Fix for a critical issue | 30 days |
| Public disclosure | Coordinated with you, after a fix ships |

We will keep you updated while we work, credit you if you'd like to be credited,
and we will not pursue legal action against good-faith research that follows
this policy.

### Good-faith research

You may test against your **own** account and your **own** devices. Please do
not:

- access, modify, or exfiltrate another person's data,
- run denial-of-service or high-volume automated scans against our servers,
- use social engineering, phishing, or physical attacks against our staff or
  users,
- test third-party services we depend on (Google, Apple, RevenueCat,
  MongoDB Atlas, Expo, Sentry) — report those to their own programmes.

## Supported versions

Only the latest released version of the mobile app and the currently deployed
backend and dashboard receive security fixes.

## Scope

**In scope**

- The API (`backend/`), including auth, sync, device commands, and billing webhooks.
- The web dashboard (`dashboard/`), including its server-side BFF routes.
- The mobile app (`mobile/`), including the PIN, biometric, decoy, and Guard Mode logic.

**Out of scope**

- Findings that require a rooted/jailbroken device *and* physical access, unless
  they defeat a control we explicitly claim (for example, the decoy PIN).
- Missing security headers with no demonstrated impact.
- Vulnerabilities in third-party dependencies with no exploitable path in this
  product — please still tell us, but they are triaged as maintenance.
- Social engineering, spam, or self-XSS.

## Our security posture

For the adversaries this product is actually designed to resist, and the
controls that resist them, see [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).
For the most recent full audit and its remediation, see
[`docs/AUDIT.md`](docs/AUDIT.md).
