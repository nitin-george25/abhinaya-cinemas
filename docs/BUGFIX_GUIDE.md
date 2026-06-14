# Abhinaya DCR — Bugfix FAQ & Troubleshooting Guide

A running record of every bug we've hit and how we resolved it, written so the next
person (or future-you) can diagnose faster. Newest patterns are the most likely to
recur — read the **Top recurring traps** section first.

_Last updated: 2026-06-14. Source: repo git history + project notes._

---

## How to use this guide

1. Find your symptom in the **Symptom index** below and jump to the entry.
2. Each entry follows the same shape: **Symptom → Root cause → Fix → Prevention**.
3. If it's new, fix it, then add an entry here. The 10 minutes you spend writing it
   down saves an hour next time.

Two rules that override everything else:

- **The DCR engine math is a legal contract. Never modify it to fix a display bug.**
  Every serial/share/batta bug we've had was a *display* or *data* problem, not a math
  problem. Fix the layer above the engine.
- **Every DB-bound fix must work on staging AND prod**, detected by hostname — never
  hard-code an environment.

---

## Symptom index

| If you see this… | Jump to |
|---|---|
| Dates off by one day (Apr 1 shows as Mar 31) | [Dates & timezones](#1-dates-show-one-day-off) |
| DCR serial numbers wrong, gaps, or too low | [Serial numbers](#2-dcr-serial-numbers-wrong-or-have-gaps) |
| Some entries missing / totals too low | [Entry sync truncation](#3-entries-missing-or-totals-too-low) |
| Tickets/amounts showing 0 after a data import | [Backfill overwrote live data](#4-live-entries-show-0-after-an-import) |
| A user sees blank catalogs / empty dropdowns | [Empty cinema_ids](#5-a-user-sees-empty-dropdowns-or-blank-catalogs) |
| Wrong catalog classes / FK errors after import | [Stale catalog IDs](#6-stale-catalog-ids-fk-failures) |
| Past movies showing as "Now Showing" | [Status engine](#7-finished-movies-still-show-as-now-showing) |
| Landing page broken on mobile / photos 404 | [Landing mobile & photos](#8-landing-page-broken-on-mobile-or-photos-404) |
| Site serving stale content after a fix deployed | [Cache poisoning](#9-old-content-still-served-after-a-fix) |
| Deploy redirect loops / 3xx / blank admin | [Cloudflare routing](#10-deploy-routing--redirect-loops) |
| Build fails on TypeScript errors | [TS strict mode](#11-typescript-build-failures) |
| Edited a migration but changes didn't apply | [Migration re-run](#12-edited-migration-didnt-apply) |
| Garbled letters in headings (DEMO watermark) | [Font watermarks](#13-garbled-glyphs-in-headings) |
| Sandbox git crashes / leftover lock files | [Sandbox git](#14-sandbox-git-crashes--stale-lock-files) |

---

## Top recurring traps (read these first)

These three have bitten us more than once and are the first things to check on any new bug.

1. **UTC vs IST dates.** Anything using `toISOString().slice(0,10)` is wrong after 18:30 IST.
2. **Catalog IDs in local exports are stale.** Always check IDs against the live `classes` table before trusting a JSON/CSV.
3. **Editing an already-applied migration does nothing.** Bump the timestamp into a new file.

---

## 1. Dates show one day off

**Symptom.** A show entered for Apr 1 displays as Mar 31; "Apr 1 → Apr 30" range renders
as "Mar 31 → Apr 29". Happens only later in the day.

**Root cause.** `new Date().toISOString().slice(0,10)` returns the **UTC** date. After
18:30 IST the UTC date is still the previous day, so it drifts back one day. We operate
entirely in IST (single-screen cinema in Kerala).

**Fix.** Use `localIso(d)` from `app/src/lib/dates.ts`, which formats from local date
components. Fixed across all date formatting in commits `e2cae5e` and `200df0f`
(2026-05-31).

**Prevention.** Never call `toISOString()` for a calendar date anywhere in this codebase.
Grep for it before shipping. IST is the only timezone that exists for us.

---

## 2. DCR serial numbers wrong or have gaps

This one had two independent causes that looked identical. Check both.

**Symptom.** Ticket serial numbers on the DCR are wrong, have gaps, or read too low —
most visible on multi-show days. Critically: the **money was always correct** (gross/tax/
share use a different code path), so this is a display/data bug, not an engine bug.

**Root cause A — duplicate-by-id (display).** `rowToEntry` in `app/src/lib/mappers.ts`
assigned a fresh random `id: uid()` on every DB read, so the same row had different ids in
different fetches. `engine.ts mergedEntries` matched entries by `id`, failed to find the
viewed entry, and pushed it as a phantom duplicate → that day's shows counted twice → the
running serial counter double-counted.

**Root cause B — silent truncation (data).** `useSupabaseSync.ts pullAll` did
`entries.select('*')` with no `.range()` or ORDER BY, so PostgREST silently capped the
result at ~1000 of 5093 entries — an arbitrary, shifting subset. Serials computed over a
partial, non-deterministic set read low. **This was the bigger cause.** See entry #3.

**Fix.** (A) Change `mergedEntries` to match by **slot** `(date, movieId, screenId)` — the
same identity used everywhere else and enforced by the DB unique constraint. (B) Page
through all entries in `pullAll`. Both shipped together and deployed to prod 2026-06-11
(`240a6b7`). Data was reconciled separately to the physical book via migration
`20260611000000` (`eb83a42`).

**Prevention.** Serials are **computed, not stored** — the engine runs a per-class running
counter over every show on a screen chronologically. That means *any* missing or duplicated
entry corrupts them. Two rules: never key entries by a random id (use the slot), and never
fetch a table without pagination. A regression test exists in `engine.test.ts`
("viewed entry with a mismatched id is not duplicated") — keep it green.

---

## 3. Entries missing or totals too low

**Symptom.** Reports under-count; some days' entries silently absent; numbers shift between
loads.

**Root cause.** PostgREST returns a maximum of ~1000 rows per request by default.
`pullAll` selected entries with no `.range()` loop, so above 1000 rows it returned an
arbitrary truncated page. We had 5093 entries.

**Fix.** Page through with `.range()` until exhausted (`240a6b7`, 2026-06-12).

**Prevention.** Any `select('*')` on a growing table (entries, fb_entries, deletion_log)
**must** paginate. Assume every table will cross 1000 rows eventually.

---

## 4. Live entries show 0 after an import

**Symptom (2026-06-08 prod incident).** After running the historical backfill, live Audi 1
Prime/Lounge tickets and Audi 2 entries showed 0 across a range of May dates. Money silently
wrong on some days even where no zeros were visible.

**Root cause.** The backfill upserted on `(entry_date, movie_id, screen_id)`. Where the
generator carried a movie id that also existed live, it **collided and overwrote 31 live
rows** — substituting era-era class keys (`a1_rc_lng`) for live keys (`cls_lounge`), which
froze those class counters to zero. A second defect: where the backfill used its own
`mh########` ids it **inserted duplicates** alongside live rows, double-counting. The
damage reached back to ~Mar 18, not just the seed's Apr 30 floor.

**Fix.** Repair migration `20260608100000` (final v3, `1f02a58`): restored collided rows
from the pre-backfill prod export, deleted every `mh*` backfill row dated ≥ go-live, and
rebased serials to a single Apr-30 = 1 start per screen. Guarded with a DO block that raises
if any corruption survives. A few May 30 online amounts were unrecoverable and re-entered
from the physical book.

**Prevention.** **Backfills that overlap live console data must exclude live dates entirely**
— put a hard date floor at go-live (Apr 30 for entries), don't merely guard on collision.
An exists-guard is insufficient: a backfill can place a movie on a screen it had since moved
away from. Always take a fresh prod export immediately before any bulk write.

---

## 5. A user sees empty dropdowns or blank catalogs

**Symptom (2026-06-06).** A cashier's Unit dropdown was blank; user sees empty catalogs and
units despite correct role.

**Root cause.** Every RLS policy routes through `cinema_access()` which checks
`cid = any(cinema_ids)`. A user created with `cinema_ids = '{}'` (empty) silently fails
**every** policy and sees nothing.

**Fix.** `admin-users createUser` now inherits the caller's `cinema_ids` (commit `383f2bb`).
Existing empty rows repaired via SQL on both envs; migration `20260606120000` covers it.
Requires the Edge Function to be redeployed on **both** Supabase projects.

**Prevention.** When debugging "user sees nothing," check `cinema_ids` **first** — before
roles, before policies. An empty array is the usual culprit.

---

## 6. Stale catalog IDs / FK failures

**Symptom.** Backfill or flag scripts cause FK failures and deactivate the *real* live
classes; wrong classes appear.

**Root cause.** Local catalog exports go stale fast. `Abhinaya DCR Data.json` (May 27) had
Audi 2 classes as `xxa50jt/1hliv5d/tlju8sn`, but both live DBs use
`1u1lpa4`=Platinum / `lp9hi7s`=Gold / `bsl9hd8`=Silver. Building a keep-list from the JSON
hit non-existent IDs.

**Fix.** Remap to live IDs and repair flags/config (`91f1bcf`, `41d324f`; migration
`20260606105000`). An `active` flag now separates the current layout from historical-era
classes (`831295b`).

**Prevention.** Any artifact that hardcodes catalog IDs (movies, classes, screens, price
cards) **must be checked against the live tables first**. Never trust a dated export.

---

## 7. Finished movies still show as "Now Showing"

**Symptom.** The public landing page lists movies that have already finished their run.

**Root cause.** The status engine counted **any** `entries` row as "played." Staff
occasionally save empty zero-ticket drafts, which re-promoted finished films back to
now-showing. Separately on prod, the cash_16 status engine had never been activated (trigger
+ pg_cron not installed), so `status_override='past'` was ignored.

**Fix.** Deleted the junk draft rows. Designed cash_20: a new `entries.cancelled_shows`
column stored **outside** the `shows` jsonb (so the locked engine math never sees it), and
`entry_counts_as_played` = ≥1 sold ticket OR ≥1 cancelled show. Real cancelled shows (strike,
power cut) are legitimate and must differ from mistakes. On prod, run the full cash_16 SQL in
the Supabase SQL editor (idempotent: installs trigger + 13:30 UTC cron + immediate refresh).

**Prevention.** Don't let presence-of-a-row mean "happened." Distinguish empty drafts from
real activity. Anything the engine must ignore goes *outside* the `shows` jsonb so the locked
math can't accidentally pick it up.

---

## 8. Landing page broken on mobile, or photos 404

**Symptom (2026-06-07).** Hero headline "STORYTELLING," clipped on phones ≤430px; gallery
overflowed on narrow screens; all photography 404'd on prod.

**Root cause.** (a) `h1 clamp(3rem, 9vw, 7rem)` — the 48px floor clipped the word.
(b) Gallery's 2×2 anchor tile forced ~414px of tracks into a 326px column.
(c) `.gitignore` had `photos/` which *also* matched `site/assets/photos/`, so the 5 web
JPGs were **never committed** — prod referenced files that didn't exist.

**Fix.** Hero clamp floor → `2rem`; gallery moved to `.gallery-grid` single-column under
520px; grids changed to `minmax(min(Xpx,100%),1fr)` to stop overflow ≤320px; `.gitignore`
pattern anchored to `/photos/` so the site assets could be committed and the JPGs added
(`186d28d`).

**Prevention.** `.gitignore` patterns without a leading `/` match at every depth — anchor
them. After any landing change, verify on a real ≤430px viewport, and confirm referenced
assets are actually committed (`git ls-files | grep photos`).

---

## 9. Old content still served after a fix

**Symptom.** Photos still 404 (or stale HTML served) even after the fix deployed and the
files exist at the edge.

**Root cause.** During the 404 window, Cloudflare cached the HTML fallback **for the photo
URLs** with `max-age=31536000, immutable`. Edge POPs and visitor browsers then served that
poisoned cache for up to a year.

**Fix.** Cloudflare "Purge Everything," plus cache-bust the asset URLs with `?v=2`
(`eaf29fe` / `c39838d`, 2026-06-07).

**Prevention.** Never serve an HTML fallback for asset paths with a long immutable cache —
a transient 404 becomes a year-long one. When a fix "isn't taking," suspect cache before
code: purge and bump a version query param.

---

## 10. Deploy routing / redirect loops

**Symptom.** Admin console blank, redirect loops, or 3xx exposed to the browser after a
deploy; landing not publishing as static.

**Root cause.** A long fight with Cloudflare's `.html`-stripping redirects and Pages SPA
fallback during the subdomain split (landing on apex, admin on `admin.`). Several layered
fixes were needed.

**Fix (the combination that worked, 2026-06-04→05).** Serve admin via the Worker's
`env.ASSETS.fetch()` and **drain the response into a fresh 200** so a 3xx never reaches the
browser (`99bac79`, `188e8de`); use Workers SPA mode instead of a `_redirects` rule
(`b5c6f7a`); scope Pages Functions to `/api/*` via `_routes.json` (`304a812`); and drop the
dead `functions/` dir so landing publishes as pure static (`7fe3919`).

**Prevention.** Keep routing config aligned across all three places: `vite.config.ts base`,
`main.tsx BrowserRouter basename`, and image `src` paths — they must all match `/admin/dcr/`
or assets 404. Treat any Cloudflare 3xx as something to absorb server-side, not pass through.
Note: prod hosting is Supabase Edge Functions + pg_cron; the `netlify/` dir is **dead code**
— don't edit it.

---

## 11. TypeScript build failures

**Symptom.** Cloudflare/Vite build fails on TS errors (the build runs on Nitin's machine —
npm is 403-blocked in the sandbox, so these can't be caught there).

**Root cause & fixes.** Recurring patterns under strict mode (`noUncheckedIndexedAccess`):

- `arr[i]` is `T | undefined` — hoist into a local before use.
- Interfaces don't auto-assign to `Record<string, unknown>` — cast through `unknown`
  (`4fa00ee`, `4db20e7`-area work).
- Aliasing a parameter loses narrowing — destructure *after* guards, not before
  (`c8397e5`).
- Unused imports fail the build — remove them (`464f67f`, `78b1811`, `0a73f29`).
- The Vite entry `<script src>` must be repo-relative (`/src/main.tsx`), not base-prefixed
  (`/v2/...`) — Vite applies `base` itself (`29fc0d2`, `e09f248`).

**Prevention.** Run `tsc` locally before committing. Remember the sandbox cannot build
(no npm) — TS correctness has to be reasoned through or checked on a real machine.

---

## 12. Edited a migration but the change didn't apply

**Symptom (cost us 2026-06-09).** Revised a migration's SQL in place across v1/v2/v3, pushed,
and the new logic never ran — staging still had the old corruption.

**Root cause.** The Supabase CLI tracks migrations by the **version-number prefix** in
`supabase_migrations.schema_migrations`. `db push` skips any version already recorded,
**regardless of file content**. Only v1 had been pushed, so v2/v3 edits were ignored.

**Fix.** Create a **new** migration with a new timestamp (e.g. `20260609000000`) for any
changed logic.

**Prevention.** Migrations are immutable once pushed. Never edit an applied migration to
"fix it" — always add a new one. Also note: the GitHub→Supabase integration does **not**
auto-apply migrations on `staging` branch pushes; run `npm run db:push:staging` manually.

---

## 13. Garbled glyphs in headings

**Symptom.** Certain characters in headings render as "FREE DEMO" or wrong glyphs —
apostrophe, `4`, `!`, `#`, `/`, lowercase `m`, brackets, and ~23 others.

**Root cause.** The Fontspring **DEMO** Pontiac webfont has 29 glyphs replaced with watermark
artwork. Our `@font-face` `unicode-range` declares Pontiac for only the 66 safe codepoints;
anything else falls through to Barlow Semi Condensed per-glyph — but the demo glyphs that
*are* in range still show the watermark.

**Fix / status.** Avoid the affected glyphs in Pontiac headings for now. Fully removable once
the licensed Brother 1816 webfont arrives.

**Prevention.** This is a licensing limitation, not a code bug. Don't chase it in CSS — it
goes away with the real font.

---

## 14. Sandbox git crashes / stale lock files

**Symptom.** `git checkout`, `git archive`, or `git worktree add` die mid-run (SIGBUS /
EDEADLK) and leave `index.lock` / `HEAD.lock` behind, blocking the next git command.

**Root cause.** The repo lives on an iCloud mount. A few loose git objects are iCloud
0-byte placeholders; the sandbox can't mmap them (SIGBUS), and cross-branch working-tree
checkouts can't unlink files on this mount. Every failed op orphans its lock file.

**Fix / workaround.** For commits from the sandbox, use git plumbing with a temp
`GIT_INDEX_FILE` rather than a working-tree checkout. For worktrees, mirror `.git/objects`
to `/tmp` (skipping the bad placeholders, regenerating the empty blob via `hash-object -w`),
`git archive` from the mirror, and extract. Single-file git ops on the mount work fine. After
any crash, **Nitin clears the locks from his terminal**: `rm -f .git/index.lock
.git/HEAD.lock`. Do **not** delete the placeholder objects from the real `.git` — they're
healthy on the host.

**Prevention.** Don't attempt cross-branch checkouts in the sandbox. Build commits with
plumbing, and expect to hand lock-cleanup + `git push` to Nitin's machine. npm is also
403-blocked in the sandbox, so builds always run on the host.

---

## Adding to this guide

When you fix something new, append an entry in the same **Symptom → Root cause → Fix →
Prevention** shape, add a row to the symptom index, and cite the commit hash. If it's
happened twice, promote it to **Top recurring traps**.
