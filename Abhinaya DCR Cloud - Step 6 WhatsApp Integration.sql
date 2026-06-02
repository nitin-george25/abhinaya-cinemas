-- ============================================================================
-- Abhinaya Cinemas — DCR Cloud
-- STEP 6: WhatsApp Cloud API integration — Supabase Storage bucket for show
-- images + a small audit log table for sends.
--
-- HOW TO RUN:
--   1. Run Steps 1–5 first.
--   2. Supabase Dashboard → SQL Editor → New query → paste this file → Run.
--   3. Then: Storage → Buckets → confirm `show-messages` exists and is PUBLIC.
--   4. (Operator) Deploy the `send-whatsapp-show` Edge Function and set:
--        WHATSAPP_ACCESS_TOKEN       — Meta permanent token
--        WHATSAPP_PHONE_NUMBER_ID    — from Meta WhatsApp Business Account
--      via Supabase Dashboard → Edge Functions → send-whatsapp-show → Secrets.
--
-- Idempotent — safe to re-run.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Storage bucket: show-messages
--
-- Public-read so Meta's Cloud API can fetch the image URL when sending. Write
-- is gated to authenticated users (entry-writer roles only — owner, manager,
-- daily_manager). RLS on storage.objects enforces both.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('show-messages', 'show-messages', true)
  on conflict (id) do update set public = excluded.public;


-- Storage RLS — only authenticated entry-writers may upload; anyone may read.
-- Run with caution: storage.objects has its own RLS; we add policies scoped
-- to this bucket only.

drop policy if exists "show_messages_read"  on storage.objects;
drop policy if exists "show_messages_write" on storage.objects;
drop policy if exists "show_messages_update" on storage.objects;
drop policy if exists "show_messages_delete" on storage.objects;

create policy "show_messages_read"
  on storage.objects for select
  using ( bucket_id = 'show-messages' );

create policy "show_messages_write"
  on storage.objects for insert
  with check (
    bucket_id = 'show-messages'
    and public.is_entry_writer()
  );

create policy "show_messages_update"
  on storage.objects for update
  using (
    bucket_id = 'show-messages'
    and public.is_entry_writer()
  );

-- Owner-only delete keeps the audit trail intact in normal operation.
create policy "show_messages_delete"
  on storage.objects for delete
  using (
    bucket_id = 'show-messages'
    and exists (
      select 1 from public.authorized_users
      where email = lower(auth.jwt() ->> 'email') and role = 'owner'
    )
  );


-- ---------------------------------------------------------------------------
-- 2) Audit log table: whatsapp_log
--
-- One row per send attempt (success or failure). Useful for "did the
-- distributor receive it?" sanity checks and for debugging template issues.
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_log (
  id            uuid primary key default gen_random_uuid(),
  sent_at       timestamptz not null default now(),
  recipient     text not null,
  entry_date    date,
  movie_id      uuid,
  screen_id     uuid,
  show_idx      int,
  media_url     text,
  status        text not null,                 -- 'sent' | 'failed'
  meta_message_id text,                        -- whatsapp message id when sent
  error         text,
  caller_email  text
);

create index if not exists whatsapp_log_sent_at_idx
  on public.whatsapp_log (sent_at desc);

alter table public.whatsapp_log enable row level security;

-- Read = any authorized user (so Settings can show recent sends).
-- Write = service role only (Edge Function); RLS denies the browser by default.
drop policy if exists wl_read on public.whatsapp_log;
create policy wl_read on public.whatsapp_log
  for select using ( public.is_authorized() );


-- ---------------------------------------------------------------------------
-- 3) Verification queries (uncomment to confirm setup)
-- ---------------------------------------------------------------------------
-- select id, name, public from storage.buckets where id = 'show-messages';
-- select polname from pg_policy where polrelid = 'storage.objects'::regclass and polname like 'show_messages_%';
-- select to_regclass('public.whatsapp_log');


-- Done. Now (operator):
--   • Set Edge Function secrets in Supabase Dashboard
--   • Deploy `send-whatsapp-show` Edge Function from the repo
--   • Configure recipient + auto-send in Settings → WhatsApp
