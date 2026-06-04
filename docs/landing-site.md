# Landing Site — `abhinayacinemas.com`

> Public marketing site at the apex domain. Distinct from the admin console
> at `/admin/dcr/`. Shipped 2026-06-03 → 06-04 on the `landing-page` branch.

---

## 1. What it is

A single-page marketing site for Abhinaya Cinemas, served at the apex of
`abhinayacinemas.com`. It exists to:

1. Show **Now Showing** and **Coming Soon** pulled live from the cinema's
   own Supabase `movies` table — so the marketing site never drifts from
   operational reality.
2. Funnel ticket-purchase intent to **BookMyShow** with today's date
   pre-selected.
3. Tell the heritage story (50 years in Changanacherry) using the
   official brand identity — Pontiac display, Barlow Condensed UI, the
   projector-beam motif, the cream-on-Cod-Gray palette.
4. Capture leads (private screenings, sponsorships, hello) via a
   **Contact form** that emails `hello@abhinayacinemas.com`.
5. List open roles (**Careers**) from a Supabase-backed catalog; fall
   back to a welcoming evergreen message when nothing is open.
6. Carry the required **Privacy** and **Terms** pages — DPDP Act 2023
   aligned; jurisdiction Kottayam, Kerala.

Two supporting standalone pages: `/privacy.html` and `/terms.html`.

## 2. Why in-browser JSX (and not Vite/React build)

The landing site uses **Babel-standalone in the browser** to compile JSX
on the fly. This is unusual but deliberate:

- **Zero build step for marketing content.** Edits to copy, sections, or
  layout are saved-and-shipped — no `npm` install, no Vite, no chance of
  breaking a build that gates the public homepage.
- **The admin app is already the heavyweight build target.** The Vite
  React app at `/admin/dcr/` is what we'd compromise reliability for; the
  marketing site doesn't need to share that toolchain.
- **Trivial to operate.** Anyone can grep the JSX files and ship a
  one-line fix.

Trade-off: each JSX file pays a parse cost on the user's machine. This is
absorbed by Babel-standalone in well under 200 ms on a mid-range phone;
the boot splash hides the brief delay. We will revisit if the bundle
grows past ~50 KB raw JSX (currently ~22 KB).

## 3. File layout

```
abhinaya-cinemas/
├── index.html              # Landing page entry. Loads React + Babel + Supabase
│                             from CDN; <script type="text/babel"> tags load JSX.
├── privacy.html            # Standalone Privacy Policy (DPDP Act 2023)
├── terms.html              # Standalone Terms of Use (jurisdiction: Kottayam)
│
├── site/                   # ALL landing-site assets live under here
│   ├── colors_and_type.css # Brand tokens + Pontiac @font-face + type utilities
│   ├── legal-shell.css     # Shared layout for privacy.html + terms.html
│   ├── site.webmanifest    # PWA manifest (icons, theme colors)
│   │
│   ├── components.jsx      # Primitives: Button, Pill, Badge, Icon, ImgSlot,
│   │                          LensRings, Beam, LogoMark, LogoLockup,
│   │                          SocialLinks, openBms(), bmsUrl()
│   ├── data.jsx            # Creates window.sbClient (Supabase client);
│   │                          exposes loadMovies()
│   │
│   ├── Header.jsx          # Sticky header + mobile drawer; NAV array
│   ├── Hero.jsx            # Hero band, headline, CTAs
│   ├── NowShowing.jsx      # Tabbed grid (Now Showing / Coming Soon)
│   ├── Legacy.jsx          # "Heritage Meets the Future" stats band
│   ├── Gallery.jsx         # Photo grid (placeholders today)
│   ├── Careers.jsx         # Reads job_openings from Supabase
│   ├── Contact.jsx         # Contact form → Supabase Edge Function
│   ├── Modals.jsx          # TrailerModal (BookingModal removed in 1cd975d)
│   ├── Footer.jsx          # Wordmark, nav, address, socials, legal links
│   └── app.jsx             # App shell — wires sections, scroll-spy, smooth-scroll
│
├── site/assets/            # Logos + favicons (generated from Brand-Guide PNG)
│   ├── logo-lockup-cream.png / logo-lockup-dark.png
│   ├── logo-symbol-cream.png / logo-symbol-dark.png
│   ├── logo-mark.svg
│   ├── favicon.ico (multi-size 16/32/48), favicon-16.png, favicon-32.png
│   ├── apple-touch-icon.png (180), icon-192.png, icon-512.png
│   └── favicon-source.png  # 1014×1014 source of truth
│
├── site/fonts/             # Pontiac DEMO (4 weights); licensed build pending
│
├── functions/api/contact.ts        # 410-Gone tombstone (former CF Pages fn)
├── netlify/functions/contact.ts    # 410-Gone tombstone (former Netlify fn)
│
└── supabase/
    ├── functions/contact/index.ts        # Authoritative contact endpoint
    ├── migrations/20260603050000_cash_13_movie_posters.sql
    └── migrations/20260603060000_cash_14_job_openings.sql
```

## 4. Data flow

```
                     ┌─────────────────────────┐
   Browser ◄─────────┤  index.html (CDN React) │
                     │  + Babel-standalone     │
                     │  + supabase-js          │
                     └────────┬────────────────┘
                              │
                              ▼
                     ┌────────────────────────┐
                     │  site/data.jsx         │
                     │  window.sbClient       │
                     │  (Supabase JS client)  │
                     └────────┬───────────────┘
                              │
       ┌──────────────────────┼──────────────────────┐
       ▼                      ▼                      ▼
  ┌──────────┐         ┌──────────────┐      ┌─────────────────┐
  │ movies   │         │ job_openings │      │ Edge Function   │
  │ table    │         │ table        │      │ /functions/v1/  │
  │ (RLS)    │         │ (RLS)        │      │     contact     │
  └──────────┘         └──────────────┘      └────────┬────────┘
                                                      │
                                                      ▼
                                              ┌────────────────┐
                                              │  Resend API    │
                                              │  → hello@      │
                                              └────────────────┘
```

### Movies — `public.movies`

Read via the **anon key** (Supabase classifies this as public).
RLS allows anon to read all rows; the catalog write roles (owner +
manager) handle inserts. Server-side filter on `archived_at is null`.

Client-side classification:

- `release_date <= today` → Now Showing
- `release_date > today` → Coming Soon (sorted earliest first)
- Posters: `poster_url` from the `movie-posters` public bucket
  (migration 13). Fallback: striped placeholder.

### Job openings — `public.job_openings`

Migration `cash_14_job_openings`. Schema:

| column       | type        | notes                                          |
|--------------|-------------|------------------------------------------------|
| id           | uuid        | pk                                              |
| title        | text        | not null                                        |
| location     | text        | default 'Changanacherry, Kerala'                |
| employment   | text        | default 'Full-time'                             |
| summary      | text        | one-liner shown on card                         |
| description  | text        | long form (rendered as `whiteSpace: pre-wrap`)  |
| apply_email  | text        | default 'hr@abhinayacinemas.com'                |
| sort_order   | integer     | lower = earlier on the page                     |
| is_published | boolean     | anon-readable gate; default true                |
| created_at   | timestamptz | default now()                                   |
| updated_at   | timestamptz | auto-touched by trigger                         |
| archived_at  | timestamptz | nullable; null = active                         |

**RLS:**
- Anon SELECT: only `is_published = true and archived_at is null`.
- Owner + manager: full CRUD (uses the same `authorized_users` check as
  the rest of the cash schema).

**Apply flow:** Empty state encourages the canonical
"send your resume to hr@" message. Filled state shows each role's title +
location + summary + expandable description, and an Apply CTA that opens
a pre-populated `mailto:` to `apply_email` (or `hr@abhinayacinemas.com`
fallback).

There is currently **no admin UI** for `job_openings` — rows are
inserted directly via Supabase Studio. Adding a section under
`/admin/dcr/settings/` is queued (see [`state-and-roadmap.md`](./state-and-roadmap.md)).

### Contact form — Supabase Edge Function `contact`

Authoritative path: `supabase/functions/contact/index.ts`.
Endpoint: `POST https://<project>.supabase.co/functions/v1/contact`.

**Why Supabase and not Cloudflare Pages Functions:** the existing
daily/weekly digest functions already run on Supabase Edge with
`RESEND_API_KEY` configured as a secret. Reusing that pipeline means
zero new infrastructure and one place for the key.

`supabase/config.toml` sets `verify_jwt = false` on this function so the
public landing page can POST without an authenticated user. The
platform still enforces the `apikey` header (anon key), and the function
validates length + email format before calling Resend.

Front-end uses `window.sbClient.functions.invoke('contact', { body })` —
supabase-js adds `apikey` + `Authorization` headers automatically.

**Tombstones** at `functions/api/contact.ts` (CF Pages) and
`netlify/functions/contact.ts` return `410 Gone` so stale clients fail
loudly. Safe to delete once we're sure nothing references them.

## 5. BookMyShow handoff

All "Book" CTAs (Header, Hero, every time pill, every "+N" pill) call
`openBms()` defined in `components.jsx`. The URL is:

```
https://in.bookmyshow.com/cinemas/CNSY/abhinaya-cinemas-4k-dolby-712-changanassery/buytickets/ABCN/<YYYYMMDD>
```

`<YYYYMMDD>` is generated from `new Date()` at click-time, so the link
is always for today. New tab + `noopener,noreferrer`.

If we ever stop using BMS or get a new cinema URL, change one constant
(`BMS_BASE` in `components.jsx`) and the whole site is updated.

## 6. Showtimes

Hard-coded standard slate in `data.jsx`:

```js
const STANDARD_SHOWTIMES = ['10:15 AM', '01:30 PM', '06:15 PM', '09:30 PM'];
```

There is **no showtimes table yet** — the DCR system tracks `shows[]`
per-entry but not the wall-clock start times of future screenings. When
this is added (likely as a `screenings` table fed from the DCR config),
swap in a per-movie lookup and remove the constant.

## 7. Scroll-spy active nav

`app.jsx` runs an `IntersectionObserver` over the section anchors:
`#programme`, `#legacy`, `#gallery`, `#careers`, `#contact`. Whichever
has the highest intersection ratio sets the active nav label.

- `rootMargin: '-80px 0px -45% 0px'` accounts for the 70-pixel sticky
  header so the active label flips as a section actually crosses the
  header band, not before.
- The `#programme` section shares two nav labels (Now Showing / Coming
  Soon) — those follow the current `tab` state instead of scroll
  position.
- At the very top of the page (`scrollY < 100`) the active label snaps
  back to whichever programme tab is currently selected.

## 8. Brand assets

Pulled from `/Users/ng/Documents/Claude/Projects/Abhinaya Cinemas - Operations/Brand Assets/`:

- Favicon set generated from `AbhinayaCinemas_Brand-Guide 05 Artboard 2
  Copy 3.png` (1014×1014, transparent BG, the अ symbol on its own).
  Cropped to bbox, square-padded, downscaled with Lanczos to 16, 32,
  180, 192, 512; multi-size .ico for legacy browsers.
- Lockup PNGs copied straight from the original Brand Identity zip
  (cream-on-dark and dark-on-cream variants).
- Pontiac is still the **DEMO build** (4 weights, scoped via
  `unicode-range` to skip the watermarked numerals — they fall through
  to Fredoka). Licensed files pending. When they arrive, drop them in
  `site/fonts/` and delete the four `unicode-range:` lines in
  `colors_and_type.css`.

## 9. Deploy

`build.sh` produces a single `dist/` for Cloudflare Pages that contains:

```
dist/
├── index.html              # → /  (landing)
├── privacy.html            # → /privacy.html
├── terms.html              # → /terms.html
├── site/                   # → /site/* (CSS, JS, fonts, assets)
├── admin/
│   ├── dcr/                # → /admin/dcr/  (React app)
│   └── dcr-legacy/         # → /admin/dcr-legacy/  (vanilla console)
└── _redirects              # SPA fallback for /admin/dcr/*
```

The build script copies `index.html`, `privacy.html`, `terms.html` and
the whole `site/` tree into `dist/`. The pre-existing React/legacy app
staging is unchanged.

**Headers** (`_headers`) — `/site/assets/*` and `/site/fonts/*` are
`max-age=31536000 immutable`; CSS is one-week revalidate; JSX revalidates
every request so edits ship instantly.

**Cloudflare env vars** — none required for the landing page. Resend is
in Supabase.

## 10. Supabase Edge Function deploy commands

```bash
# Confirm RESEND_API_KEY is already set (it is — same one digests use).
supabase secrets list --project-ref xkmjygegtpmmwwnyoufn

# Optional overrides:
supabase secrets set \
  CONTACT_TO=hello@abhinayacinemas.com \
  CONTACT_FROM='Abhinaya Cinemas <noreply@mail.abhinayacinemas.com>' \
  --project-ref xkmjygegtpmmwwnyoufn

# Deploy the function (reads verify_jwt = false from config.toml).
supabase functions deploy contact --project-ref xkmjygegtpmmwwnyoufn

# Smoke-test:
ANON="<prod anon key>"
curl -i -X POST 'https://xkmjygegtpmmwwnyoufn.supabase.co/functions/v1/contact' \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke","email":"nitin.george@abhinayacinemas.com","message":"hi"}'
```

For staging first, swap the project ref to `lctkvmpzijaspaytunkm`.

## 11. Local preview

The landing site is plain HTML + Babel — no build step needed:

```bash
cd "/Users/ng/Documents/Claude/Projects/Abhinaya Cinemas - Operations/abhinaya-cinemas"
python3 -m http.server 8000
# Open http://localhost:8000/
```

Movies will pull from **prod** Supabase. Contact form will hit the prod
Edge Function (once deployed) — so any test submission lands in your
real inbox. Use the dry-run smoke-test above to test without spamming
yourself.

## 12. Open follow-ups

1. **Job openings admin UI** — currently rows are inserted via Supabase
   Studio. Add a Settings → Careers panel to `/admin/dcr/`.
2. **Real hero film still, gallery photos, lobby/ticket-counter shots.**
3. **Licensed Pontiac files** to replace the DEMO build.
4. **Showtimes table** — replace the hard-coded slate.
5. **Custom icon set** — the Brand Identity ships a custom set; we
   substitute with Lucide today.
6. **Legal review** of `privacy.html` and `terms.html` before any
   meaningful traffic.
7. **Delete the tombstones** at `functions/api/contact.ts` and
   `netlify/functions/contact.ts` after a confidence period.

## 13. Related docs

- [`state-and-roadmap.md`](./state-and-roadmap.md) — current state of
  every branch, what's next.
- [`../HANDOFF.md`](../HANDOFF.md) — fresh-context handoff for the DCR
  console (the bigger system this lives alongside).
- [`../README.md`](../README.md) — repo overview.
