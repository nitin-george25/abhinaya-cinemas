# Payments — Claude Design Brief

*Instructions for Claude Design to produce the UI/UX for the unified Payments module.
Hand this whole file over. The workflow truth lives in
[`Payments - Unified Workflow Design.md`](./Payments%20-%20Unified%20Workflow%20Design.md) —
read it first; this brief tells you what to draw, in what style, and what to deliver.*

---

## 0. Read before designing

1. **`docs/Payments - Unified Workflow Design.md`** — the agreed workflow: actors,
   payment-type taxonomy (§5), state machines (§6), Slack approval (§7), advances (§8),
   the inbox spec (§9), data model (§11). Every screen here implements part of that doc.
2. **The existing design system in code** — match it exactly, don't invent a new one:
   - `app/tailwind.config.ts` — design tokens (colours, fonts, radii) listed in §2 below.
   - `app/src/components/ui/` — the component library to reuse: `Button`, `Card`,
     `Badge`, `Input` (+ `Select` and searchable pickers), `Modal`, `Tabs`,
     `ConfirmDialog`.
   - Reference pages for layout/voice: `app/src/pages/cash/Payments.tsx`, `Petty.tsx`,
     `Ledger.tsx`, `Settlements.tsx`, `Closings.tsx`; `app/src/components/projects/FinancesPanel.tsx`.

Design as an extension of this console, not a standalone product. A user should not be
able to tell where the old screens end and the new ones begin.

---

## 1. Product & user context

The Abhinaya Cinemas Console is the operational system of record for a cinema (DCRs,
cash, finance, project management). This module unifies how **payments** are raised,
approved, paid and reconciled.

- **Primary user: the Accountant.** Design for their efficiency above all. They live in
  this module daily; everyone else visits it. Optimise for: one place to see everything,
  minimum clicks to raise and pay, never hunting across screens for status.
- **Owner** approves *every* payment — but does it from **Slack**, not the console
  (interactive buttons). The console shows them status; it does not need a heavy owner
  approval screen.
- **Manager** may raise general payments. **Project members (PM/DM)** raise project
  expenses that surface here. **Cashier/Daily-manager** run the separate petty till flow,
  which appears read-only here.
- This is **financial software handling real money**. Bias toward clarity, confirmation
  on irreversible actions, visible audit trails, and zero ambiguity about amounts and
  status. Calm and precise over flashy.

---

## 2. Design-system constraints (must follow)

**Colours (Tailwind tokens):**
- `paper` `#FAFAF8` (app bg), `paper-card` `#FFFFFF` (cards/surfaces).
- `ink` `#0F1115` (text), `ink-soft` `#1A1D24`, `ink-muted` `#5C6470` (secondary/labels).
- `line` `#E6E4DE` (borders/dividers).
- `amber` `#F7B61F` (brand accent; 50→600 ramp available). Use amber sparingly — primary
  actions, active states, the brand mark. It is an accent, not a fill-everything colour.
- Status colours: derive a small semantic set (success/green, warning/amber, danger/red,
  neutral/ink-muted, info) consistent with the existing `Badge` component — **extend
  `Badge`, don't fork it**.

**Type:**
- `font-sans` = **Barlow Semi Condensed** (body, labels, tables).
- `font-display` = **Pontiac** (page titles, large headings only).
- `font-mono` = **JetBrains Mono** (use for reference numbers / UTR / IDs if helpful).
- Bilingual note: the app supports Malayalam (`font-malayalam`) elsewhere; payments UI is
  English, but don't hard-break if a payee name carries Malayalam glyphs.

**Shape & spacing:** radii `xl` (0.875rem) / `2xl` (1.125rem) for cards and modals;
match existing card padding and density. The console is **information-dense but
breathable** — closer to a well-built admin tool than a marketing page.

**Money & numbers (critical):**
- Currency is **₹ (INR)**; format Indian-grouped (₹1,23,456.00). Right-align amounts in
  tables; use `tabular-nums` so columns line up.
- Dates/times are **IST**; show relative age ("2d") in the inbox, absolute on detail.
- Never truncate an amount. Negative/credit (e.g. an advance applied) shown explicitly.

**Components to reuse (do not reinvent):** `Button` (primary/secondary/ghost/danger),
`Card`, `Badge` (status chips), `Input`/`Select`/searchable picker, `Modal`,
`ConfirmDialog` (for irreversible actions like mark-paid), `Tabs` (the segmented control
already used for the PM Budget/Expenses split). Icons: **Lucide** (the set already in use).

---

## 3. Screens to design (deliverables)

For **each** screen deliver: layout (desktop ≥1280 and mobile ≈380), every state
(loading / empty / populated / error / permission-denied), role-aware variations, and the
microcopy. Annotate where each element maps to the workflow doc.

### S1 — Payments inbox (the hub) ★ most important
The accountant's home for this module. A single worklist of everything needing a payment
action, regardless of origin.
- **Header:** title, "Make a Payment" primary button, quick filters/search (by payee,
  type, amount, source).
- **Status lanes** (tabs or segmented filter): *Drafts · Awaiting owner approval ·
  Approved — ready to pay · Paid · Petty (read-only)*. Show counts per lane.
- **Table columns:** payee · type (with a small accounting-head hint) · amount
  (right-aligned, tabular) · source (General / Project «name» / Petty / Advance) ·
  status badge · age · needed-by. Row click → S3 detail drawer.
- **Row affordances** are state-aware: a *Draft* shows "Submit"; *Approved* shows
  "Mark paid"; *Awaiting approval* shows "View Slack card" / "Nudge". Petty rows are
  read-only (no actions, muted).
- **Side panels / quick views** reachable from here: *Outstanding advances* (S7),
  *Paid this week/month* (links to cash-flow reports).
- Design the **empty state** (no payments yet) and a **busy state** (dozens of rows —
  prove the density and sorting hold up).

### S2 — "Make a Payment" (typed creation form)
One entry that adapts to the chosen type. Progressive disclosure — don't show fields a
type doesn't need.
- Flow: **payment type** (grouped picker over the §5 taxonomy) → **payee category**
  (auto-set, read-only chip) → **payee** (searchable, from `distributors` for share types
  / `parties` otherwise; "add new payee" inline) → **amount** → **invoice upload**
  (hidden when the type's `invoice_rule = exempt`) → **paid-from bank account** (dropdown
  of `bank_accounts`) → needed-by date → notes.
- **Variants to show explicitly:**
  - *Advance* — an "This is an advance" affordance with a **link target**: for a
    distributor share advance, pick **movie + distributor** (console fills the rest); for
    a vendor advance, optional **proforma invoice** upload + vendor.
  - *Asset type* (e.g. Equipment) — reveals the **quotation stage first** (see S4) before
    a payment can proceed; surface that this type needs quotes the moment it's chosen.
  - *Settlement-backed* (Distributor share remittance) — replaces "invoice upload" with
    "attach settlement statement"; note the open question that this may instead be
    initiated from the box-office settlement screen.
- Validation states: amount required/positive; invoice required unless exempt; asset
  invoice subtotal must match the approved quote (GST + freight allowed on top) with a
  deviation-reason field when it doesn't.

### S3 — Payment detail (drawer or page)
The full record + the action surface.
- **Header:** payee, amount, type, big status badge, source link (e.g. → the project).
- **Lifecycle stepper** rendering the relevant §6 state machine (routine vs asset vs
  advance) — show where it is and what's next.
- **Files:** invoice / proforma / quote / settlement statement previews.
- **Actions** (state- and role-gated, with `ConfirmDialog` on irreversible ones):
  Submit, Mark paid (→ S5), Net an advance (→ S6), Cancel.
- **Audit trail:** every transition with who/when (incl. "Approved by «owner» in Slack").
- **Advance block** (if `is_advance`): link target, and once netted, what it was applied
  against.

### S4 — Asset quotations: compare & approve
For asset purchases. Shows the quotations gathered under one payment.
- A **comparison view** of quotations (vendor · amount · file · notes), one selectable as
  approved. Owner approves *from Slack*, but design the console-side states: *collecting
  quotes*, *quote approved (vendor/price locked)*, *awaiting invoice*.
- Include the **skip-quotation** affordance (PM or owner, with required reason) for known
  vendors / trivial buys below the configured floor.

### S5 — Mark-paid modal
Triggered on an *Approved* payment. Fields: paid-from bank account (confirm), bank
reference / UTR / cheque no., paid amount (prefilled, editable with reason if differs),
paid date. `ConfirmDialog`-grade confirmation. On success the row moves to *Paid* and (for
F&B) shows a small "queued to Zoho" indicator.

### S6 — Advance netting
When a final tax invoice arrives for a vendor with outstanding advances.
- Console **auto-suggests** the vendor's outstanding advances (matched on proforma where
  present, vendor otherwise). Accountant **ticks** which to apply; show running math:
  invoice total − advances applied = net payable. Support **many advances → one payment**
  and **partial** application.
- Distributor share advances are **auto-netted** (no confirm) — design only the *display*
  of "advance ₹X applied, balance due ₹Y" on the share remittance.

### S7 — Outstanding advances
A focused view: unrecovered advances **by distributor and by vendor**, with age and link
to net (S6). This is a reconciliation surface the accountant expects.

### S8 — Settings: Payment types editor (owner)
Owner-managed table to add/edit the taxonomy: name, payee category, invoice rule, is-asset
(→ requires quotation), quote-skip floor, accounting head, Zoho-push toggle, active.
Reuse the Settings page patterns already in the console.

### S9 — PM project Finances tab — parity (light touch)
You are **not** redesigning the PM module, but show how a project expense and the inbox are
**two windows on the same object**: a project expense paid from the inbox reflects in the
project instantly, and vice-versa. Indicate the shared status badges and the "open in
Payments" link. Keep the existing `FinancesPanel` structure.

### S10 — Slack approval card (Block Kit)
The owner approves here, so design it well. A **Block Kit message** for #payments:
- Header line (payment type · payee · ₹amount), key fields (project/line if any, needed-by),
  the invoice/quote file, a deep-link button "Open in console", and **Approve / Reject**
  buttons. A second card variant for **asset quotation approval** (Approve quotation /
  Reject). Show the **post-action state** (`chat.update`): "✅ Approved by «owner»" /
  "⛔ Rejected by «owner» — «reason»". Keep it scannable on mobile Slack.

---

## 4. Cross-cutting requirements

- **Responsive:** the console has had mobile passes — design **mobile (≈380px) for S1, S2,
  S3, S5** at minimum (managers/accountants act on phones). Tables become stacked cards on
  mobile (follow the existing cash mobile-card pattern).
- **States matrix:** every screen needs loading (skeleton), empty, error, and
  permission-denied designs — not just the happy path.
- **Role-awareness:** annotate which elements appear for accountant vs owner vs manager vs
  read-only viewers. Hide actions a role can't take (don't show-then-disable, except where
  a tooltip explaining "owner approves in Slack" helps).
- **Confirmation & reversibility:** mark-paid, cancel, reject, and advance-netting use
  `ConfirmDialog`. Make "this moves money / can't be undone" unmistakable.
- **Microcopy:** plain, calm, specific. "Awaiting owner approval", not "Pending". Indian
  English; ₹ everywhere; no emojis in the console UI (Slack card may use ✅/⛔).
- **Accessibility:** WCAG AA contrast on the paper/ink palette; amber text needs care
  (use amber for fills/borders, ink for text on amber). Full keyboard paths; visible focus;
  status conveyed by label + colour, never colour alone.
- **Trust signals:** show the audit trail prominently; always show "paid from «account»"
  and the reference on paid items.

---

## 5. Deliverables

1. **User-flow diagrams** for the three lifecycles (routine, asset, advance) tying screens
   together — mirror §6 of the design doc.
2. **Hi-fi screens** for S1–S8 + the S10 Slack card, desktop, in the console's design
   system; **mobile** for S1/S2/S3/S5.
3. **State variations** for each (loading/empty/error/permission), and the key
   interaction states (validation, confirm dialogs, success toasts).
4. **A component spec** noting which existing `components/ui` parts are reused and any
   *new* shared components proposed (e.g. a `PaymentStatusBadge`, an `AdvanceLinkPicker`,
   a `MoneyInput`) — kept minimal and consistent with the library.
5. **Annotations** mapping each screen/element back to the workflow doc section and the
   data fields in §11, so Claude Code can build directly from it.

---

## 6. Out of scope (v1)

In-console Slack chatbox; AI invoice/quote extraction (pipeline #19 — a fast-follow, but
leave room for an "auto-filled from invoice — review" pattern on S2); a full table merge;
Zoho push beyond F&B; redesigning the petty-expense or PM modules themselves.

---

*Once Claude Design returns screens + flows + component specs, Claude Code builds per
§11–§12 of the workflow design doc (taxonomy + form → inbox + lifecycle → Slack approvals →
asset flow → advances → Zoho), one feature branch each, staging → prod parity.*
