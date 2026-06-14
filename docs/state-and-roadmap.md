# State + Roadmap

> Snapshot as of **2026-06-04**. Supersedes the "Next steps" section of
> [`../HANDOFF.md`](../HANDOFF.md). When this drifts, update or replace —
> don't add a new file.

---

## 1. The system, end-to-end

Abhinaya Cinemas runs on three deployed surfaces, one cloud database,
and a handful of edge functions:

```
┌──────────────────────────────────────────────────────────────┐
│  abhinayacinemas.com                                          │
│  ├─ /                  Landing site (cream-on-cod-gray)       │
│  ├─ /privacy.html      DPDP Act 2023 privacy policy           │
│  ├─ /terms.html        Terms of Use (jurisdiction: Kottayam)  │
│  ├─ /admin/dcr/        React DCR console (Vite + TS + RR6)    │
│  └─ /admin/dcr-legacy/ Vanilla console (fallback, retiring)   │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  Supabase (prod: xkmjygegtpmmwwnyoufn,                        │
│             staging: lctkvmpzijaspaytunkm)                    │
│                                                               │
│  Postgres 15 + RLS                                            │
│   ├─ DCR tables: entries, fb_entries, movies, classes,        │
│   │   screens, price_cards, serial_starts, openings           │
│   ├─ Cash management (phases 1-13): cash_units,               │
│   │   cash_movements, payments, deposits, signoff_parties,    │
│   │   movie-posters bucket                                    │
│   └─ Marketing: job_openings (phase 14)                       │
│                                                               │
│  Storage buckets                                              │
│   ├─ movie-posters     public read                            │
│   └─ receipts          owner/manager scoped (cash)            │
│                                                               │
│  Edge Functions                                               │
│   ├─ daily-digest      pg_cron → Resend → owner inbox         │
│   ├─ weekly-digest     pg_cron → Resend → owner inbox         │
│   ├─ admin-users       privileged user mgmt (service role)    │
│   └─ contact           landing-form → Resend → hello@         │
└──────────────────────────────────────────────────────────────┘
```

## 2. Branch status

| Branch                | Last commit | What's on it | Status |
|-----------------------|-------------|--------------|--------|
| `main`                | `e5555c8`   | Up to "Phase 3 dual-write + Reports section". | **Stable. Deploy target.** |
| `staging-refactor`    | `ddfff75`   | Big in-flight refactor; intermittently merged via PR. | In progress. |
| `cash-management`     | `1474b74` after rewind (currently `0b6258e` until you run the rewind commands) | Phases 1-13 of cash management. Awaits prod migration. | **Ready to merge after migrations run.** |
| `landing-page`        | `0b6258e`  | All landing-page work split off 2026-06-04. | **Ready to merge** (after legal review). |
| `auto-reports`        | `25e317c`  | Activity-log polish; merged from staging-refactor. | Stale-ish. |
| `whatsapp-integration`| `5630873`  | WhatsApp Cloud API after-show messaging + dashboard YoY + KPI redesign + mobile fit. | In progress. |

**Branch policy** (effective 2026-06-04 — see `feedback-branches`
memory): one feature per branch. Always start with
`git checkout main && git pull && git checkout -b feat/<name>`. The
landing page accidentally rode on `cash-management` for a day; we split
it out retroactively. Don't repeat.

## 3. Shipped recently (since 2026-06-01 HANDOFF)

### Cash management (`cash-management` branch)

- **Phase 8 — mandatory receipts** for non-card payments.
- **Phase 9 — owner-only delete on closing day** (safety net for
  end-of-day reversals).
- **Phase 10 — deposits + POS settlements + manual receipts.**
- **Phase 11 — unit renames + per-unit method mapping + cashier
  dropdown RLS.**
- **Phase 11.1** — cashier-on-till is anyone; gating by email.
- **Phase 12 — scope visibility** (owner/manager see all, cashiers see
  their own).
- **Phase 13 — mandatory movie poster upload** + `movie-posters` public
  bucket.
- **Cashier role** added to authorized_users; manager tier gets
  `/settings/users` access; UI polish on sidebar logomark + number
  input focus.

### Landing site (`landing-page` branch — new)

- **241bb68** — Live marketing site at `/`. In-browser JSX + Babel,
  Supabase movies, Cloudflare Pages deploy alongside `/admin/dcr/`.
- **1cd975d** — BookMyShow handoff for every Book CTA. Contact form
  with Resend (originally Cloudflare Pages Function, now ported).
  Careers section + `job_openings` migration (phase 14).
- **0b6258e** — Favicon set from brand अ symbol. Real social URLs
  (IG / FB / YouTube). Hero rewritten to "History of Storytelling,
  Reimagined." Scroll-spy active nav via IntersectionObserver.
  Privacy + Terms pages (DPDP Act 2023, Kottayam jurisdiction).
- **Contact endpoint** ported from Netlify → Cloudflare Pages →
  Supabase Edge Function (`supabase/functions/contact/index.ts`),
  matching the digest pipeline. Two tombstones (410 Gone) left in
  `functions/api/contact.ts` and `netlify/functions/contact.ts`.

## 4. What's open, ordered

### Blocking — do these before further feature work

1. **Run cash-management migrations on prod**
   (`cash_00` through `cash_13`). Then merge `cash-management` → `main`.
   See [`../HANDOFF.md`](../HANDOFF.md) §8.
2. **Apply Supabase setup on prod** — username auth migration,
   `admin-users` edge function, redirect URLs. From HANDOFF.md §8 item 1.
3. **Deploy the `contact` edge function** to prod
   (`supabase functions deploy contact --project-ref xkmjygegtpmmwwnyoufn`)
   and confirm `RESEND_API_KEY` is set in Supabase secrets. See
   [`landing-site.md`](./landing-site.md) §10.
4. **Run `cash_14_job_openings` migration** so the careers page works.

### Near-term — next sprint

5. **Mobile layouts for `/admin/dcr/`** — explicitly the next workstream
   in the prior handoff. Responsive audit on 380×800, mobile drawer for
   sidebar, reflow entry form, stack KPI grid 2-up.
6. **Job openings admin UI** under `/admin/dcr/settings/careers` so
   adding/editing roles doesn't require Supabase Studio.
7. **Real photography on the landing site** — wire the 5 photos in
   `photos/` (`Big Screen.jpg`, `Concession-1/2.jpg`, `DSC05554/05552.jpg`)
   into the Hero backdrop + Gallery (currently `ImgSlot` placeholders).
   `Big Screen.jpg` → default Hero backdrop; rest fill the 6-tile gallery
   (one short — reflow or reuse). Move into `site/assets/`, swap
   placeholders for real `<img>`. Coming-Soon posters where missing.
8. **Per-movie trailers + hero film selection** — add `trailer_url` to the
   `movies` table (next to `poster_url`, same dual-write + anon-read path).
   Add a trailer-URL field to the movie row editor in settings → Movies
   (paste a YouTube link). Expose `trailer_url` in the landing page's
   `loadMovies` select so the existing "Watch Trailer" button plays it.
   **Hero selection = hybrid:** add a single "Feature on homepage" toggle
   (one movie at a time — selecting a new one clears the previous); the
   landing Hero uses the featured movie's trailer if set, else falls back
   to the `now_showing` film that has a trailer. Hero *backdrop* stays a
   brand photo (`Big Screen.jpg`) — no landscape art per movie needed v1.
9. **Calculated movie status (coming_soon / now_showing / past)** — turn the
   one-time `cash_15` backfill math into an ongoing rule so the owner stops
   hand-setting `status`. Rules (single screen, DCR entered daily):
   - `coming_soon`: `release_date > current_date`.
   - `now_showing`: latest `entries.entry_date` for the movie is
     `>= current_date - 1` (entry today or yesterday). **Grace:** also
     now_showing if `release_date >= current_date - 1` so opening day reads
     correctly before its first DCR is entered.
   - `past`: everything else (one full day with no entry → retire).
   **Hybrid w/ pin:** add a `status_pinned boolean` (or `status_override`)
   on `movies`; when set, the calc skips that row so the owner can lock a
   status manually. Surface a pin toggle in settings → Movies next to the
   status pill.
   **Computation:** keep `status` a stored column (RLS/index/landing page
   untouched). Recompute via (a) a trigger on `entries` insert/update that
   promotes the movie to now_showing, plus (b) a daily `pg_cron` job that
   demotes now_showing rows whose last entry < `current_date - 1` to past
   (the "nothing happened" retire transition can't fire from a trigger).
   Run the cron late in the IST day, after that day's DCR is in, so a tight
   1-day window doesn't false-retire a film. Skip any pinned row.
   Staging + prod parity; one feature, own branch.
10. **Legal review** of `privacy.html` and `terms.html` before any real
   marketing push.

### Mid-term

11. **Phase C1.1 — parity harness** for the DCR engine. Load legacy
   `01-box-office.js` in `vm.runInNewContext`, diff `computeEntry`
   against the TS engine on fixture inputs. Lands before deleting
   `/admin/dcr-legacy/`.
12. **Phase C6.3 / C6.4** — F&B multi-day PDF bulk upload + BO bulk CSV
    upload; then retire `/admin/dcr-legacy/`.
13. **WhatsApp integration** (`whatsapp-integration` branch) — finish
    after-show messaging + YoY dashboard work; ship behind a flag.
14. **Showtimes table** — replace the hard-coded 10:15 / 1:30 / 6:15 /
    9:30 slate in the landing site with per-movie data fed from the DCR
    config or a new `screenings` table.

### Backlog (from `project_console_pipeline` memory)

15. Mobile app (PWA install path or native shell).
16. Zoho integration (CRM / books).
17. Tally integration (accounts handoff).
18. Ops management — checklists + owner audit (open/close routines,
    food-safety, projector booth).
18a. **Slack notifications for petty expenses** — post to a Slack
    channel on each lifecycle event of `petty_expenses`:
    - **Created** (`createPettyExpense`, status `pending`): amount,
      category, requester, description, expense date, operating unit,
      POS counter, and an approval deep-link into the console.
    - **Approved** (`approvePettyExpense`): update/append
      "Approved by [daily manager name]".
    - **Rejected** (`rejectPettyExpense`): "Rejected by [name]" +
      `rejected_reason`.
    Build approach: reuse the Edge Function notification pattern
    (cf. `send-whatsapp-show` / `daily-digest`) — a `notify-slack`
    Edge Function posting to a Slack Incoming Webhook (env secret
    `SLACK_WEBHOOK_URL`), called after the insert/update in `cash.ts`,
    or a DB trigger via `pg_net`. Name → email lookup for the approver.
    Approval link = console URL to the pending-expenses view filtered
    to the expense id. Open Qs below.

21. **Project Management module — Renovations tracker.** IMPLEMENTED
    2026-06-13 on branch `feat/project-management-renovations` (off main);
    awaiting build + commit + push + db:push (staging & prod). Migration
    `20260613100000_projects_module.sql`; app files lib/projects.ts,
    pages/projects/*, components/projects/*, nav/icon/route wiring. Owner
    assigns a project manager; PM/owner assign members; only owner +
    assigned members tick (RLS) with an audit trail; per-task attachments
    required to complete a task; PM-created subtasks drive % completion.
    Audi 1 Dolby Atmos project seeded. Detail view is a vertical-tab layout
    (Timeline / Checklist / Finances / Team). Finances (migration
    `20260613110000_project_finances.sql`: project_budget_items +
    project_invoices) = itemwise budget-vs-actual + invoice uploads, with
    estimate/actual/variance summary. ClickUp API was considered and declined
    in favour of staying native (one backend, cf. #15). Original spec below.
    Captured 2026-06-13. New top-level nav group **"Project Management"** with a
    **"Renovations"** sub-item. Renovations shows a grid of project
    **cards** (e.g. "Location: HQ · Audi 1 · Type: Technical Upgrade")
    that open into a detail view = the **Gantt timeline + phased progress
    checklist** (seed = the Audi 1 Dolby Atmos / acoustic renovation HTML
    Nitin uploaded: 7 phases, 19 tasks, 21-day schedule from 11 Jun 2026).
    Goal: store this checklist data for THIS and future projects instead
    of the upload's browser-localStorage (`abhi_audi1_renovation_v1`),
    which is per-device and lost on cache clear.
    - Nav: add group `project-management` in `app/src/lib/nav.ts`
      (new `IconProjects` in `icons.tsx`); child leaf `/projects/renovations`.
      Roles likely `OWNER_MANAGER` (decide if daily_manager can tick items).
    - Storage (recommended shape): `projects` (id, name, location/unit,
      type, status, start_date, target_finish, created_by) + `project_phases`
      (project_id, seq, name, color) + `project_tasks` (phase_id, code,
      name, note, start_day/end_day OR start_date/end_date, is_milestone,
      done_at, done_by). Progress = done tasks / total. RLS mirrors other
      console tables; staging+prod parity (cf. feedback_staging_parity).
    - Build the Gantt + checklist as React components rendering from those
      rows (the uploaded HTML's render logic ports directly). One-time
      importer to seed the Audi 1 project from the upload.
    - Open Qs: who can check off items vs only owner; do tasks store fixed
      calendar dates or day-offsets from start; per-project file/photo
      attachments; project types as a fixed enum or free text; archive vs
      delete completed projects.

### Cleanup / debt

19. Delete `netlify.toml`, `netlify/functions/`, and the 410-Gone
    tombstone at `functions/api/contact.ts` after a confidence period.
20. Licensed Pontiac font files when they arrive — drop in
    `site/fonts/` and remove `unicode-range:` lines from
    `colors_and_type.css`.
21. WOFF2-compress the brand fonts.
22. Replace Lucide icons with the brand's custom icon set when it lands.

## 5. Where each domain lives

| Domain                  | Code                                          | Docs |
|-------------------------|-----------------------------------------------|------|
| Landing site            | `index.html`, `site/`, `privacy.html`, `terms.html` | [landing-site.md](./landing-site.md) |
| DCR React app           | `app/`                                        | [../HANDOFF.md](../HANDOFF.md), `app/src/.../*` inline |
| DCR legacy app          | `admin/dcr/`                                  | `admin/dcr/ARCHITECTURE.md` |
| Cash management         | `app/src/pages/cash/`, `supabase/migrations/cash_*` | `../Cash Management Design.md` |
| Database normalization  | `supabase/migrations/`                        | `../DB Normalization Design.md` |
| Roles + access          | n/a                                           | `../ROLE_ACCESS.md` |
| Catalog (movies, prices, screens) | `app/src/pages/settings/`, `supabase/migrations-archive/catalog-normalization/` | `supabase/migrations-archive/catalog-normalization/README.md` |
| Edge functions          | `supabase/functions/`                         | This file §1 |
| Build + deploy          | `build.sh`, `netlify.toml` (defunct)          | `../HANDOFF.md` §5 |

## 6. Open questions worth asking before next session

- **Online ticket sales** — keep funnelling to BMS forever, or build
  direct booking? Direct would mean payment integration + seat
  management + real showtimes table — substantial. Probably stays on
  BMS for FY26.
- **Photography** — who shoots? Worth scheduling a half-day pro shoot
  of the auditorium, projector, lobby, ticket counter before the
  landing site goes from "live but placeholdered" to "fully styled."
- **Marketing site → CMS?** Right now copy edits are JSX-file edits.
  Once we hire someone non-technical to handle marketing, this becomes
  a friction point. Options: Sanity/Contentful, or a tiny
  Supabase-backed CMS table that the landing page reads from the same
  way it reads `movies`.
- **Domain-level robots / sitemap.** Worth adding `robots.txt` and a
  generated `sitemap.xml` before pushing for SEO.
- **Newsletter signups** — the footer has an input that doesn't do
  anything yet. Either wire it to a Supabase table + a confirmation
  flow, or remove it for now.

## 7. Memory + handoff hygiene

- `/Users/ng/Library/.../memory/MEMORY.md` is auto-loaded into every
  session. Keep it as a one-line-per-entry index.
- `feedback_*.md` memories encode "how to work with Nitin" — concise
  prose, no emojis, ready-to-paste commit messages, pipeline-capture by
  default, engine math locked, one feature per branch.
- `project_*.md` memories track in-flight work. Update when status
  changes.
- This doc is the canonical roadmap. The HANDOFF.md is the
  "fresh-context starting point" — if I re-read it in 6 months, will
  I know what's going on? If not, update.
