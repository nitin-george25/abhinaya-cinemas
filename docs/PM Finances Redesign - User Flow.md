# PM Finances Redesign — Expense Approval & Payment Flow

*Pipeline #18 · drafted 2026-06-17 · status: design for review (nothing built yet)*

Redesigns the **Finances** tab of the Project Management module. Today that tab is a flat budget-vs-actuals table where a line's "actual" is just the sum of uploaded invoices. This replaces it with a controlled **expense lifecycle** so every spend goes quotation → owner approval → invoice → payment request → owner OTP → paid, with the budget updating only when money actually goes out.

---

## 1. The core idea

A **budget line item** (e.g. "Acoustic panels") is a planned cost with an *estimate*. Under each line item, the team raises one or more **expenses** — the actual things being bought. Each expense is the unit that moves through the approval flow below. A line item's spend is the roll-up of its expenses.

```
Budget line item  ──<  Expense  ──<  Quotation(s)
                          │
                          ├── 1 approved quotation
                          ├── 1 invoice (vendor bill)
                          └── 1 payment (OTP + paid record)
```

---

## 2. Actors & who can do what

| Actor | In the system | Does |
|---|---|---|
| **PM / DM** | project members (`project_manager` / `member`) | Raise expense, add quotations, upload invoice |
| **Owner** | global `owner` role | Approve a quotation; approve payment by sharing the OTP on Slack |
| **Accountant** | global `accountant` role (already exists) | Request payment (posts to Slack), enter OTP & mark paid |

The accountant is **not** a per-project role — any user with the global accountant role acts on expenses across all projects. Owner can do everything.

---

## 3. The lifecycle (states)

| # | State | Set by | Means |
|---|---|---|---|
| 1 | `quoting` | PM/DM raises expense | Collecting quotations; awaiting owner pick |
| 2 | `quote_approved` | Owner | One quotation chosen → approved vendor + amount locked |
| 3 | `invoiced` | PM/DM | Vendor's bill uploaded against the approved expense |
| 4 | `payment_requested` | Accountant | Slack #payments message sent (invoice + OTP ask); awaiting owner OTP |
| 5 | `paid` | Accountant | OTP entered, payment recorded → budget "Paid" updated |

Branches: `rejected` (owner rejects all quotes → back to `quoting`, or expense cancelled) and `cancelled` (PM/DM or owner drops an expense before it's paid).

---

## 4. Step-by-step

**Stage 1 — Raise expense & add quotations (PM / DM)**
On a budget line, click **+ Expense**: title, description, optional needed-by date. Inside the expense, **+ Quotation** for each quote received: vendor, amount, notes, and a **quote file (required)** — PDF/image. Expense sits at `quoting`. PM/DM can add/edit/remove quotations until one is approved.

**Stage 2 — Approve one quotation (Owner)**
Owner opens the expense, compares quotations side by side, clicks **Approve** on one. That quotation's vendor + amount become the expense's *approved vendor* and *approved amount*; the others are marked rejected. State → `quote_approved`. Owner can also **Reject all** (with a reason) to send it back for fresh quotes.

*Side-step — skip quotations (added 2026-06-17):* for a known vendor, the **PM or owner** can skip the quotation stage entirely. They enter the vendor + approved amount and a **required reason** (e.g. "known vendor"), which moves the expense straight to `quote_approved`. The reason is stored and shown on the expense, and the step is audit-logged like any other transition.

**Stage 3 — Upload vendor invoice (PM / DM)**
Once the vendor sends the bill, PM/DM open the approved expense and **Upload invoice**: invoice number, date, bill file, and the amount broken into **subtotal · GST · freight · total**. The **subtotal must match the approved quotation amount** — GST and freight are the only expected additions on top. If the subtotal deviates from the approved amount, the form flags it and asks for a one-line reason (so it's visible, not silent). The expense's payable amount becomes the invoice **total**. State → `invoiced`.

**Stage 4 — Request payment (Accountant only)**
The accountant sees a queue of `invoiced` expenses ready to pay. Clicks **Request payment** → the console posts to **Slack #payments**: project, line item, vendor, total amount, the invoice file, and "Approve & reply with OTP." State → `payment_requested`. Only the accountant can trigger this.

**Stage 5 — Owner approves on Slack (out-of-band)**
Owner reads the #payments message and replies with an OTP code. This happens entirely on Slack — the console does **not** read the reply or verify the code in v1. (Future: two-way Slack + an in-console chatbox so this happens in-app.)

**Stage 6 — Enter OTP & mark paid (Accountant)**
Accountant makes the actual bank payment, returns to the expense, enters the OTP the owner shared, and clicks **Mark paid** (paid amount + payment date + reference). State → `paid`. The budget line's **Paid / Actual** figure increases by the paid amount.

---

## 5. What the Finances tab shows after the redesign

Summary cards are **Estimate · Paid · Remaining**, where:
- **Paid** = sum of *paid* expense totals (the true actual).
- **Remaining** = Estimate − Paid.

*(No "Committed" / encumbrance column in v1 — kept simple, decided 2026-06-17.)*

Each budget line expands to its expenses, each expense showing a status chip and the current step's action button (visible only to the actor who can act). A small **payment queue** view gives the accountant every expense awaiting request or awaiting mark-paid across the project.

---

## 6. Slack integration (v1)

One-way only — a webhook posting to **#payments** is enough. Payload on **Request payment**: project + line + vendor + amount + invoice link/file + a console deep-link to the expense + the OTP request line. Separate staging vs prod channels (env secret per environment). Reuses the existing Edge Function notification pattern (same approach as the petty-expense Slack idea, pipeline #16). No bot token, no reading replies in v1.

---

## 7. Decisions (confirmed 2026-06-17)

1. **Quote attachment** — **required.** A quotation can't be submitted without a quote file.
2. **Invoice vs approved amount** — invoice **subtotal must match the approved quotation**; **GST and freight** are the only permitted additions on top. The payable amount is the invoice total. A subtotal that deviates is flagged with a required reason.
3. **OTP record** — **yes.** The entered OTP is stored as an audit field on the payment record.
4. **Committed column** — **no.** Summary stays Estimate / Paid / Remaining for v1.
5. **Payment request** — **accountant only.** (Owner still authorizes via the Slack OTP.)

---

## 8. Schema sketch (build-facing, not final)

- **`project_expenses`** — `id, project_id, budget_item_id, title, description, status, requested_by, approved_quotation_id, approved_vendor, approved_amount, paid_amount, paid_at, paid_by, otp_reference, slack_channel, slack_ts, timestamps`.
- **`project_quotations`** — `id, expense_id, vendor, amount, notes, file_url/file_name (required), status (submitted|approved|rejected), submitted_by, submitted_at`.
- **`project_invoices`** (extend existing) — add `expense_id` link plus `subtotal, gst, freight, total` (total = payable); an invoice now belongs to an approved expense rather than floating against a budget line.
- **RLS** — read = `cinema_access`; expense + quotation writes = `is_project_member`; quote approval = global `owner`; payment request + mark-paid = global `accountant` only (owner can still act). State transitions enforced server-side (SECURITY DEFINER fn per transition) so steps can't be skipped; the mark-paid fn records `otp_reference`. Every transition writes a `project_audit` row.

---

*Next step: confirm the section-7 decisions, then I'll turn this into a scoping doc + a feature branch (migrations + DAL + Finances tab rebuild + notify-slack Edge Function).*
