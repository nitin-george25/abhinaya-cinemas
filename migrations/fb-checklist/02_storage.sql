-- ============================================================================
-- 02 — Storage bucket for checklist photo evidence
--
-- Public-read so the photos render inline in the console + can be linked in
-- the F&B WhatsApp group. Writes restricted to checklist users. Mirrors the
-- petty-receipts bucket in cash-management/02.
-- ============================================================================

begin;

insert into storage.buckets (id, name, public)
  values ('fb-checklist-photos', 'fb-checklist-photos', true)
  on conflict (id) do update set public = excluded.public;

drop policy if exists "fb_checklist_photos_read"   on storage.objects;
drop policy if exists "fb_checklist_photos_write"  on storage.objects;
drop policy if exists "fb_checklist_photos_update" on storage.objects;
drop policy if exists "fb_checklist_photos_delete" on storage.objects;

create policy "fb_checklist_photos_read" on storage.objects
  for select using (bucket_id = 'fb-checklist-photos');

create policy "fb_checklist_photos_write" on storage.objects
  for insert with check (
    bucket_id = 'fb-checklist-photos' and public.is_entry_writer()
  );

create policy "fb_checklist_photos_update" on storage.objects
  for update using (
    bucket_id = 'fb-checklist-photos' and public.is_entry_writer()
  );

create policy "fb_checklist_photos_delete" on storage.objects
  for delete using (
    bucket_id = 'fb-checklist-photos' and public.is_owner()
  );

commit;
