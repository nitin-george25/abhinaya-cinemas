# `/docs/` — project documentation index

Living documentation for the Abhinaya Cinemas codebase. Add new docs
here; keep them short, accurate, and link them from this index.

## Start here

- **[state-and-roadmap.md](./state-and-roadmap.md)** — current snapshot
  of every branch, what's shipped, what's blocking, and what's next.
  Read this first on any fresh session.

## Surface-specific docs

- **[landing-site.md](./landing-site.md)** — the public marketing site
  at `abhinayacinemas.com/`. Architecture, files, data flow, deploy
  steps. Covers the contact form (Supabase Edge → Resend → hello@) and
  the careers section (Supabase `job_openings`).

## Elsewhere in the repo

These predate the `docs/` folder and live where they're consumed:

- **[../HANDOFF.md](../HANDOFF.md)** — fresh-context handoff for the
  DCR console rewrite. Long, but the canonical "assume zero prior
  context" doc. Snapshot from 2026-06-01; current addenda live in
  [state-and-roadmap.md](./state-and-roadmap.md).
- **[../README.md](../README.md)** — minimal repo overview.
- **[../ROLE_ACCESS.md](../ROLE_ACCESS.md)** — owner / manager /
  daily-manager / cashier / accountant access matrix.
- **[../Cash Management Design.md](../Cash%20Management%20Design.md)** —
  cash management phases 1-13 design notes.
- **[../DB Normalization Design.md](../DB%20Normalization%20Design.md)** —
  database normalization design notes.
- **[../admin/dcr/ARCHITECTURE.md](../admin/dcr/ARCHITECTURE.md)** —
  the vanilla legacy console architecture.
- **[../supabase/README.md](../supabase/README.md)** — Supabase setup
  notes.
- **[../migrations/catalog-normalization/README.md](../migrations/catalog-normalization/README.md)**
  and **[../migrations/cash-management/README.md](../migrations/cash-management/README.md)** —
  migration-specific notes.
