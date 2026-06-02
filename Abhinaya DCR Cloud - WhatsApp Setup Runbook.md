# WhatsApp Cloud API — Setup Runbook

End-to-end instructions for connecting Abhinaya Cinemas DCR Console to the
official WhatsApp Cloud API. Allows automated after-show messages with image
attachments. ~1–2 weeks total: most of it Meta-side wait time.

---

## 0. One-time decision: phone number

The Cloud API **needs its own phone number**. It cannot share a number with
a personal WhatsApp account. Two options:

- **Buy a new SIM.** Cheapest path. Any unused number works.
- **Migrate an existing number.** Possible, but the personal WhatsApp account
  for that number gets deleted. Don't do this with Nitin's daily-use line.

The same number CAN later be used to forward into a WhatsApp group from the
recipient device, which is the workaround for "Cloud API doesn't send to
groups" — Nitin's personal phone receives the auto-message, then he forwards
to the group manually.

---

## 1. Meta business setup (~1 week, mostly waiting)

1. Go to <https://business.facebook.com/> and create a Business Manager
   account for Abhinaya Cinemas.
2. **Business Settings → Business Info →** add:
   - Legal name (matches GSTIN registration)
   - Business email, website, address
3. **Business Settings → Security Center →** start business verification.
   Upload GSTIN certificate or a utility bill in the business name. Meta
   reviews in 2–5 business days.

While that's processing, you can still develop with the *test* WhatsApp
Business Account (limited to 5 recipient numbers, no business verification
required). Useful for the Send-test step below.

4. **App Dashboard** (<https://developers.facebook.com/apps/>): create an app
   of type **Business**. Add the **WhatsApp** product.
5. Inside WhatsApp settings, register the dedicated phone number. Meta
   sends an SMS/voice code for verification.
6. Note these IDs from **WhatsApp → API Setup**:
   - **Phone number ID** (looks like `1234567890123456`)
   - **WhatsApp Business Account ID** (a different number)
   - **Temporary access token** (24h validity) — useful for the test step

---

## 2. Permanent access token

Temporary tokens expire in 24h. For production:

1. **Business Settings → Users → System Users →** create one named
   `dcr-console-bot` with role **Admin**.
2. Assign the WhatsApp Business Account asset to that system user.
3. **Generate token** → choose `whatsapp_business_messaging` +
   `whatsapp_business_management` scopes → set expiry **Never**.
4. Copy the token. It will only show once.

Store this token only in the Supabase Edge Function secrets — never in code.

---

## 3. Template approval

Templates must be pre-registered with Meta before they can be sent.

### Recommended template — `show_collection_v1`

| Field | Value |
|-------|-------|
| Name | `show_collection_v1` |
| Category | **Utility** |
| Language | English (en) |
| Header | **Image** (URL provided at send time) |
| Body | `Collection update from Abhinaya Cinemas:\n\n{{1}}` |
| Footer | `(auto-generated from DCR console)` |
| Buttons | — |

**Body sample** (what Meta needs to see to approve, with placeholders filled):

```
Collection update from Abhinaya Cinemas:

Screen 1 — Manjummel Boys — 9:30 PM
PREMIUM :- 102
GOLD :- 87
Silver :- 56
₹ 64500
online: 1200

Gross : 67200
Net : 51080.40
T net : 213450.20
Ds : 106725.10
Es : 106725.10
```

Submit via **WhatsApp Manager → Message Templates → Create**. Utility
category typically approves within 24h. If rejected, the error message
tells you what to tweak (most common: language tag mismatch).

### Why `{{1}}` for the whole body

The image card already carries every figure visually. The text body is a
fallback for users who don't load images and for chat-history search. Using
one big placeholder keeps the template flexible — no schema changes needed
when adding new fields.

---

## 4. Supabase configuration

### 4a. Apply Step 6 SQL

In Supabase Dashboard → SQL Editor, paste and run:
`Abhinaya DCR Cloud - Step 6 WhatsApp Integration.sql`

Creates the `show-messages` storage bucket, its RLS policies, and the
`whatsapp_log` audit table.

Verify:

```sql
select id, public from storage.buckets where id = 'show-messages';
-- expect: id=show-messages, public=true

select to_regclass('public.whatsapp_log');
-- expect: public.whatsapp_log
```

### 4b. Deploy the Edge Function

From the repo root:

```bash
npx supabase login                          # one-time
npx supabase link --project-ref <project>   # prod or staging
npx supabase functions deploy send-whatsapp-show
```

Or via the dashboard: Edge Functions → Create function →
name `send-whatsapp-show` → paste the contents of
`supabase/functions/send-whatsapp-show/index.ts` → Deploy.

### 4c. Set Edge Function secrets

Dashboard → Edge Functions → `send-whatsapp-show` → **Manage secrets**.
Add both:

| Secret | Value |
|--------|-------|
| `WHATSAPP_ACCESS_TOKEN` | The permanent system-user token from Section 2 |
| `WHATSAPP_PHONE_NUMBER_ID` | The phone number ID from Section 1.6 |

Redeploy is **not** required after adding secrets — they're picked up on the
next invocation.

---

## 5. App configuration (in the console UI)

Sign in as owner, then go to **Settings → WhatsApp**:

1. **Recipient phone** — your dedicated forwarding number (E.164 format,
   e.g. `+919876543210`).
2. **Template name** — `show_collection_v1` (match what Meta approved).
3. **Template language** — `en` (or whatever you submitted).
4. **Auto-send when "Last show of day" is ticked & saved** — check on once
   you've confirmed test sends work.

Click **Send test message** to verify the round-trip. The placeholder image
gets sent to the recipient; the recipient phone should buzz within a few
seconds. If anything fails, the error message + the Recent Sends log below
will show the Meta error.

---

## 6. Going live

Once test sends succeed:

1. Enable **Auto-send on Last show of day** in Settings → WhatsApp.
2. From any BO entry, tick **Last show of day** on the last show and Save.
   The console renders the show card, uploads to Storage, calls Meta, and
   stamps `whatsappSentAt` on the show to prevent resends.
3. Manual sends from the After-show message modal are also live — the
   **Send via WhatsApp** button appears when a recipient is configured.

---

## 7. Operating notes

- **Costs.** Utility-category templates cost ~₹0.40 per send in India. At
  30 shows/day with one recipient that's ~₹12/day or ~₹360/month. Meta
  bills monthly via the Business Manager payment method.
- **Quality rating.** Meta tracks each phone number's quality. If users
  block messages, the rating drops; below "Medium" you get rate-limited.
  Daily messages to a known recipient (you) carry zero spam risk.
- **Template edits** require re-approval. Plan to register additional
  templates (e.g. `show_collection_v2`) if you want to A/B test wording —
  the console reads the template name from Settings, so swapping is a
  one-line config change.
- **Audit log.** Every send is logged to `public.whatsapp_log`. The
  Settings page surfaces the last 30; for deeper history query the table
  directly.
- **Token rotation.** System-user tokens with "never expire" still get
  revoked by Meta on suspicious activity. If sends suddenly start failing
  with `401`, regenerate the token in Business Manager and update the
  Edge Function secret.

---

## 8. Failure modes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `WhatsApp env vars not configured` (500) | Secrets not set on the Edge Function | Section 4c |
| `Template name does not exist` | Template not approved, or wrong language | Section 3 |
| `Parameter X is not valid` | Body variable contains disallowed chars (e.g. `\n\n\n`, certain unicode) | Sanitize text before send (already strips to 1024 chars) |
| `131047 Re-engagement` | Recipient has not messaged the business in 24h AND template is missing | Use Utility category — it's exempt from the 24h window |
| `Recipient number not in allowed list` | Test WABA — only registered test numbers can receive | Add the number under WhatsApp → API Setup → To, OR complete business verification |
| Image not delivered, message text only | Public URL not reachable from Meta's fetcher | Verify the Storage bucket is public; open the URL in a private window |

---

End of runbook. The code-side is fully wired and waiting for Meta credentials
+ template approval. Once Section 4c and Section 5 are done, the integration
goes live without redeploys.
