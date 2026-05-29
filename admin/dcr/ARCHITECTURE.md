# Abhinaya DCR — Architecture & Migration Roadmap

This document describes the current code layout and the concrete path from "vanilla JS with `<script src>` tags" to a modern bundled frontend (React or similar). It exists because the codebase grew from a one-file prototype into a real cinema operations tool, and the next person to touch it needs to know what to port and how.

## Phase A — current state (split files, no build step)

```
admin/dcr/
├── index.html              ~411 lines — structure + <script src=""> tags
├── css/style.css           ~174 lines — global styles
└── js/
    ├── 01-box-office.js    Engine math + Box Office UI (entry, history, movies, cards, config, backup, bulk DCR)
    ├── 02-cloud.js         Supabase init, env switch (prod vs staging), auth, pull/push, realtime
    ├── 03-fb.js            F&B module: DSR parser, daily upload, products catalog, pull/push
    ├── 04-fb-subtabs.js    Sidebar wiring + Owner's Dashboard pre-hook + multi-DSR bulk handler
    ├── 05-fb-combined.js   F&B combined CSV upload (single file, many days)
    ├── 06-fb-menu.js       Editable menu items table (overrides renderProducts)
    ├── 07-dashboard.js     Owner's Dashboard — period selector, KPIs, 5 charts (Chart.js)
    ├── 08-movies-csv.js    Movies CSV bulk upload
    └── 09-backup-changes.js Last-exported indicator + Recent changes feed
```

Loaded in numeric order. All globals (S, computeEntry, save, renderXxx, etc.) live on the top-level scope. Cross-file communication goes through `window.__xxx` and shared globals.

## Phase B — what migration needs (no code yet, just clarity)

### B.1 The "engine" vs "view" split

This is the most important distinction for future migration. Anything in this list can move to React verbatim:

**Pure engine (no DOM, no globals, deterministic)** — currently lives in the top half of `01-box-office.js`:
- `defaultState`, `migrate`, `normalize`
- `breakdown`, `computeSerials`, `chronoShows`, `computeEntry`, `computeShallow`
- Helpers: `uid`, `N`, `today`, `esc`, `money`, `int`, `weekday`, `fmtTime`, `fmtPrice`
- F&B parsers: `parseDSR`, `parseCatalog` (currently in `03-fb.js`)
- Combined CSV parser (in `05-fb-combined.js`)
- Movies CSV parser (in `08-movies-csv.js`)

**View** — touches DOM, currently mixed throughout:
- All `render*` functions (renderEntry, renderDCR, renderHistory, etc.)
- All event handlers and tab switching
- All canvas/Chart.js dashboard rendering

### B.2 The `window.__*` globals (10 of them)

These are the cross-module communication points. Each becomes an explicit `import`/`export` in the React migration:

| Global | Set by | Used by | Purpose |
|---|---|---|---|
| `window._sb` | 02-cloud.js | 03-fb.js, 07-dashboard.js, 08-movies-csv.js, 09-backup-changes.js | Supabase client instance |
| `window.__DCR_ENV` | 02-cloud.js | (debug only) | "prod" or "staging" |
| `window.__DCR_ROLE` | 02-cloud.js | 02-cloud.js, 03-fb.js, 06-fb-menu.js | "owner" / "manager" / "accountant" |
| `window.cloudOnSave` | 02-cloud.js, 03-fb.js | 01-box-office.js's `save()` | Triggers Supabase push |
| `window.renderFB` | 03-fb.js | 04-fb-subtabs.js, 05-fb-combined.js | Re-render F&B Sales |
| `window.renderDashboard` | 04-fb-subtabs.js (stub), 07-dashboard.js | 01-box-office.js's refreshActive | Re-render Owner's Dashboard |
| `window.__renderDashboard` | 07-dashboard.js | 04-fb-subtabs.js stub | The actual implementation |
| `window.__renderRecentChanges` | 09-backup-changes.js | 07-dashboard.js | Refresh "Recent changes" feed |
| `window.__renderLastExport` | 09-backup-changes.js | 01-box-office.js export handler | Refresh "Last exported" indicator |
| `window.__parseDSR` | 03-fb.js | 04-fb-subtabs.js bulk handler | Parse a single DSR (POS CSV) |
| `window.__pullProducts` | 03-fb.js | 06-fb-menu.js | Re-pull catalog after edit |
| `window.__replaceFbProducts` | 03-fb.js | (none currently) | Bulk catalog replace |
| `window.renderProducts` | 03-fb.js, 06-fb-menu.js | 01-box-office.js tab switcher | Re-render Menu Items |

In React/Vue, every one of these becomes an `import { fn } from 'module'`, and the values become props or store reads. **Map this table 1:1 when migrating** — that's the contract.

### B.3 Shared state

The `S` object is the single source of truth. It's defined in `01-box-office.js` via `defaultState()` and looks roughly like:

```js
S = {
  cinema: { name, gstin },
  tax: { threshold, above, below, tmc, cess, rep1, rep2, rep5 },
  classes: [{id, name, gstPct}],
  screens: [{id, name, classes:[{classId, seats}], priceCards:[{id, name, prices:{classId: price}}]}],
  movies: [{id, name, distributor, release, share}],
  serialStarts: [{id, screenId, date, starts:{classId: number}}],
  openings: [...],
  entries: [{id, date, movieId, screenId, share, shows:[{showtime, priceCardId, freePass, online, lastShow, rows:{classId:{tickets}}}]}],
  fbProducts: [...],
  fbEntries: [{date, items, summary, notes}],
  draft: ...
}
```

In React: this becomes a Zustand store, or Redux slice, or `useReducer` + Context. The shape stays identical; only the access pattern changes (`S.entries` → `useStore(s => s.entries)`).

## Phase C — concrete migration path

### C.1 Convert script-tags → ES modules (small step)

Each `js/NN-name.js` becomes an ES module:
- Add `import { S, computeEntry, save } from './01-box-office.js'` at top
- Add `export { whatever }` at bottom for things other modules use
- Change `<script src="">` → `<script type="module" src="">` in `index.html`

**Effort**: 1 day. **Risk**: low. **Win**: explicit module boundaries, easier debugging, ready for bundlers.

### C.2 Add a bundler (Vite is the obvious choice)

- `npm init vite@latest` with the "vanilla JS" template
- Move files under `src/`
- `npm run build` produces `dist/` ready to push to Netlify
- Netlify config: build command `npm run build`, publish dir `dist`

**Effort**: 1 day. **Risk**: low (Vite is forgiving). **Win**: tree-shaking, source maps, hot reload during development, ready for TypeScript.

### C.3 Migrate pane-by-pane to React (incremental)

The structure already maps cleanly:
- `pane-entry` → `<DailyEntry />` component
- `pane-history` → `<History />` component
- `pane-fb-sales` → `<FBSales />` component
- `pane-fb-menu` → `<FBMenu />` component
- `pane-dashboard` → `<Dashboard />` component (uses `recharts` instead of `Chart.js`)

The engine functions (computeEntry, etc.) get called from React the same way they're called today — they're pure. **The math files never change**.

Migration order suggestion (lowest risk → highest):
1. `<Dashboard />` first — it's read-only, easy to verify visually
2. `<FBSales />` and `<FBMenu />` — already have clean state ownership
3. `<History />`, `<Movies />`, `<Cards />`, `<Config />` — straightforward forms
4. `<DailyEntry />` last — the most complex pane, hardest to get wrong

After each pane is React, delete the corresponding `js/NN-*.js`. The old code can co-exist with React panes during migration (mount React into a div, leave old panes as plain DOM).

**Effort**: 2–4 weeks part-time. **Risk**: medium (mostly UX regressions). **Mitigation**: do it on a feature branch; flip one pane at a time.

### C.4 What to *not* do

- **Don't rewrite the engine**. The tax/POA math has been verified across 56+ historical days and two screens. Touching it risks regressing numbers that match Tally exactly. Port verbatim.
- **Don't migrate everything in one PR**. Pane-by-pane is the path.
- **Don't introduce TypeScript and React at the same time**. Add TS *after* the React migration is stable.

## Files that should never change (the "lock")

```
Engine functions in 01-box-office.js:
  - breakdown()
  - computeSerials()
  - chronoShows()
  - computeEntry()
  - computeShallow()
  - All POA / tax / TMC / Cess / E-Tax / GST math
```

If a future change to these is proposed: stop, dump 10 days' computed numbers from old vs new, compare to the cent. Any discrepancy is a bug, not an improvement.

## Quick reference for the next session

1. **Want to add a new tab/panel?** Pick the right `js/NN-*.js` and add to it (or create `js/NN-newthing.js` and add a `<script src>` line in `index.html`).
2. **Want to change a SQL view or table?** Add a new step SQL file in the project folder (Step 5, 6, …). Keep them idempotent.
3. **Want to migrate to React?** Start with C.1, then C.2, then C.3 dashboard-first. Read `B.2` for the module-boundary contract.
4. **Want to verify nothing broke?** Compare `v_daily_combined` results before and after, and re-export the Tally CSV for any known DCR — it should be byte-identical.
