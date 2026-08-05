# Console → Native App (Capacitor) — Implementation Plan

> today at `admin.abhinayacinemas.com`) into installable **Android + iOS**
> apps distributed through Google Play and the Apple App Store, without
> forking the codebase. Roadmap item #15 (`state-and-roadmap.md`), decided
> in favour of a native shell over PWA on 2026-08-04.
>
> v1 native capabilities: **offline entry + sync**, **push notifications**,
> **camera capture**. Web console at `admin.abhinayacinemas.com` stays live
> and unchanged in behaviour — one codebase, three targets.

---

## 1. The core idea, and why it's not just "wrap it"

Capacitor takes the **same compiled Vite build** (`app/dist`) and runs it
inside a native WebView, then exposes native APIs (push, camera, filesystem,
biometrics) through plugins. The UI code, the DCR engine, the Supabase data
layer — all reused as-is. What changes is the *edges*: the three places where
the console currently assumes it's running on a real web origin. Those must be
fixed before the app can even reach prod data or sign a user in.

Confirmed collisions in the current code:

| Area | Today (web) | Breaks in Capacitor because | Fix |
|---|---|---|---|
| **Env detection** | `env.ts` → `PROD_HOSTS.includes(location.hostname)` | Capacitor serves from `localhost` / `capacitor://localhost`; hostname is never `admin.abhinayacinemas.com`, so **every native build resolves to staging** | Make env a build-time constant on native (`Capacitor.isNativePlatform()` + a compiled flag); keep hostname logic for web |
| **Google OAuth** | `SignInScreen.tsx` redirects to `https://admin.abhinayacinemas.com/`; `supabase.ts` uses `detectSessionInUrl` | A WebView has no such web origin to land back on; the redirect never returns to the app | PKCE flow + custom-scheme **deep link** (`appUrlOpen` → `exchangeCodeForSession`); register scheme in Android/iOS and in Supabase redirect allowlist |
| **Session storage** | `supabase.ts` persists to `localStorage` | Native WebView `localStorage` can be evicted by the OS → users silently logged out | Swap in a Capacitor Preferences storage adapter for the Supabase auth client |
| **File uploads** | `<input type=file>` to Supabase Storage (receipts, EDC slips, posters, SOPs) | Works, but no native camera; no gallery/permission UX | `@capacitor/camera` → blob → existing Storage upload path |
| **PDF / CSV export** | `pdf.ts` (jsPDF) + `xlsx` trigger browser downloads | WebView has no download-to-disk; DCR PDFs, picture-ending, reports would appear to do nothing | `@capacitor/filesystem` write + `@capacitor/share` sheet |
| **Routing** | `BrowserRouter basename="/"` | Generally fine from localhost root, but deep links / cold-start URLs need care | Keep BrowserRouter; add an `appUrlOpen` router bridge (fallback to hash routing only if needed) |

The **DCR engine (`engine.ts`) stays untouched** — it's the locked legal
contract. Offline sync must preserve its outputs byte-for-byte; it only changes
*when* the write reaches Postgres, never the numbers.

---

## 2. Hard prerequisites (before any code)

These gate the whole project and some cost money / need lead time:

- **iOS builds require macOS.** Development machine is Windows
  (`C:\Developer`). iOS cannot be built or signed on Windows. Options:
  (a) a Mac (mini/cloud) for local builds, or (b) a cloud macOS CI —
  **Codemagic**, **GitHub Actions macOS runner + Fastlane**, or **Ionic
  Appflow**. Recommend picking the CI route so both platforms build from the
  same pipeline and no Mac sits idle. **Android builds fine on Windows.**
- **Apple Developer Program** — $99/yr, ~24–48h to activate. Needed for
  signing, TestFlight, and App Store. An **Organization** account (vs
  Individual) needs a D-U-N-S number for "Abhinaya Cinemas" — start this early,
  it's the slowest step.
- **Google Play Developer** — $25 one-time. New personal/org accounts now face
  Google's testing requirements (a closed test with testers before production
  for personal accounts) — plan for a short closed-testing window.
- **Bundle identifiers** (decide now, they're permanent): e.g.
  `com.abhinayacinemas.console` for both stores. App display name, e.g.
  "Abhinaya Console".
- **Firebase project** for push (FCM handles Android natively and brokers APNs
  for iOS) — free tier is fine.
- **Brand assets**: app icon + splash from the brand system (the `अ` logomark
  already used for the favicon), adaptive icon layers for Android, and the
  1024px marketing icon for App Store. Uses the Abhinaya Cinemas brand
  guidelines.

---

## 3. Phased plan

Each phase is independently shippable and, per repo convention, is **its own
branch off `main`, staging-first**. Phases 1–3 get you an installable,
useful internal app fast; 4–5 add the harder native value; 6–7 are the store
gauntlet.

### Phase 0 — Decisions, accounts, scaffolding tooling
Kick off the slow external items (Apple org + D-U-N-S, Play account, Firebase),
lock the bundle ID and app name, and choose the iOS build path (Mac vs cloud
CI). No app code yet. **Output:** accounts pending, IDs decided.

### Phase 1 — Capacitor scaffold + Android shell (internal build)
Add Capacitor to `app/` (`@capacitor/core`, `@capacitor/cli`, `/android`,
`/ios`). Config `webDir: dist`, `appId`, `appName`. `npx cap add android`,
build the existing UI, run on a device. No native features yet — this proves
the console runs in the shell and surfaces layout issues (status-bar / notch
insets, keyboard behaviour on the entry form, sidebar hover-rail on touch).
**Output:** installable Android debug APK of the current console.

### Phase 2 — Fix the edges (the collision table §1)
The real "make it a native app" work:
- **Env as build constant** — native always = prod (or a flavored
  staging/prod build); web keeps hostname detection. Guard with
  `Capacitor.isNativePlatform()`.
- **OAuth deep link** — PKCE, custom scheme, `App.addListener('appUrlOpen')`
  → `exchangeCodeForSession`; add scheme to Supabase Auth redirect URLs.
  Username+PIN sign-in (`signInWithUsername`) already works unchanged in the
  WebView — floor staff are unaffected.
- **Preferences storage adapter** for the Supabase auth session.
- **Safe-area insets**, status-bar styling, splash screen, back-button
  handling (Android hardware back → router).
- **Exports** via Filesystem + Share.
**Output:** a native Android app that signs in against **prod**, holds its
session, and can export a DCR PDF. This is the first "real" app.

### Phase 3 — Camera capture
`@capacitor/camera` for receipts, EDC slips, petty-expense receipts, movie
posters, SOP photos — routed into the existing Supabase Storage upload paths.
Permission strings for iOS (`NSCameraUsageDescription`) and Android.
**Output:** snap-and-upload everywhere a file picker exists today.

### Phase 4 — Push notifications
Today notifications go out only via **email digests, Slack, and WhatsApp**
(edge functions). Native push adds the on-device channel:
- `@capacitor/push-notifications` registers FCM (Android) / APNs (iOS) tokens.
- New `device_tokens` table (user_id, token, platform, last_seen) + RLS.
- A `send-push` edge function (mirrors the `notify-slack` / `daily-digest`
  pattern) posting via FCM HTTP v1.
- First triggers to wire: **petty-expense approval** requests, **cash-closing**
  reminders, and the **daily/weekly digest** as a tap-through.
**Output:** approvals and reminders land on the phone even when the app is
closed — the main reason to go native over PWA on iOS.

### Phase 5 — Offline entry + sync (the hard one)
Scope tightly for v1: **offline for Box-Office and F&B entry only** (the
capture the cinema does daily on possibly-flaky wifi). Reads and everything
finance-related stay online-first.
- Local store: `@capacitor-community/sqlite` (or IndexedDB) holding an
  **outbox** of pending entry writes.
- Write path: entry saves to the local outbox first, UI shows "pending sync",
  a queue flushes to Supabase on reconnect (`@capacitor/network`).
- Conflict rules honour existing invariants: the **2-day edit lock** and
  **`audit_log` triggers** stay authoritative server-side; a queued write that
  the server now rejects (locked, or superseded) surfaces as a sync conflict,
  never a silent overwrite. Engine math is computed the same way offline.
- Parity test: an offline-then-synced DCR must equal the online-entered one.
**Output:** staff can enter BO/F&B with no connection and it syncs cleanly.
*(This phase can ship after store launch if timelines are tight — the app is
already valuable without it.)*

### Phase 6 — iOS build + TestFlight
Add the iOS platform, build on the chosen Mac/CI path, resolve iOS-only issues
(APNs auth key in Firebase, universal-link vs custom-scheme nuances, WebView
quirks), and get the app onto **TestFlight** for internal testing.
**Output:** owner/manager testing the iOS build on real iPhones.

### Phase 7 — Store submission + release
- Store listings, screenshots, descriptions (brand-consistent).
- **Privacy**: reuse `privacy.html` (DPDP Act 2023); complete Apple's **App
  Privacy** questionnaire and Google's **Data Safety** form (camera, account,
  approximate data).
- Google closed test → production; Apple review submission.
- **Update strategy**: routine UI changes can ship over-the-air via **Capgo**
  (open-source live updates) or Appflow, avoiding a store round-trip; native
  or plugin changes require resubmission. Document which is which.
**Output:** downloadable from Play + App Store; a repeatable release process.

---

## 4. Sequencing & effort (rough)

| Phase | Relative effort | Can start |
|---|---|---|
| 0 Accounts/IDs | Low, but **long calendar time** (D-U-N-S) | Immediately |
| 1 Scaffold + Android shell | Low | After 0's IDs |
| 2 Fix edges (env/OAuth/storage) | **Medium–High** | After 1 |
| 3 Camera | Low–Medium | After 2 |
| 4 Push (+ edge fn, token table) | Medium | After 2 |
| 5 Offline sync | **High** | After 2; can trail launch |
| 6 iOS + TestFlight | Medium (gated on Mac/CI) | After 2 |
| 7 Store submission | Medium + **external review lag** | After 6 |

Critical path to "in the stores": 0 → 1 → 2 → 6 → 7. Push, camera, and
offline attach in parallel once Phase 2 lands. Fastest credible route puts an
internal Android build in hand within Phase 1–2 and a store presence gated
mostly by Apple org verification and review, not by our code.

---

## 5. Decisions needed to start Phase 0

1. **iOS build path** — buy a Mac, or set up cloud macOS CI (Codemagic /
   GitHub Actions)? (Recommend cloud CI.)
2. **Apple account type** — Organization (needs D-U-N-S for "Abhinaya
   Cinemas", enables the org name as seller) or Individual (faster, your name
   as seller)?
3. **Bundle ID / app name** — confirm `com.abhinayacinemas.console` /
   "Abhinaya Console".
4. **Offline scope** — agree v1 = BO + F&B entry only, or wider?
5. **Native env** — should native builds always point at **prod**, or do we
   want a separate internal **staging build** (flavor) for testing against
   staging data?

---

## 6. Risks / watch-items

- **iOS on Windows** is the biggest logistical constraint — resolve the Mac/CI
  decision before committing dates.
- **Apple org verification (D-U-N-S)** is the slowest external dependency;
  start day one.
- **Offline + RLS + 2-day lock + audit triggers** is genuinely the hard part;
  keeping its scope to entry-only in v1 contains the risk. Don't let offline
  block the store launch.
- **Google Play testing requirements** can add a closed-testing waiting period
  for newer accounts — factor into launch timing.
- **DCR engine parity** must hold across the offline path — reuse the existing
  vitest parity approach as the guard.

---

## 7. What does *not* change

The web console stays at `admin.abhinayacinemas.com` on Cloudflare Pages,
same deploy, for desktop/back-office use. The Supabase backend, RLS, edge
functions, roles, and the DCR engine are shared and unchanged. Native is an
additional distribution of the same product, not a rewrite.
