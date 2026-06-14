-- ============================================================================
-- 99 — Rollback for the F&B checklist feature. Destroys all checklist data.
-- ============================================================================

begin;

drop policy if exists "fb_checklist_photos_read"   on storage.objects;
drop policy if exists "fb_checklist_photos_write"  on storage.objects;
drop policy if exists "fb_checklist_photos_update" on storage.objects;
drop policy if exists "fb_checklist_photos_delete" on storage.objects;
delete from storage.objects where bucket_id = 'fb-checklist-photos';
delete from storage.buckets where id = 'fb-checklist-photos';

drop table if exists public.fb_checklist_items cascade;
drop table if exists public.fb_checklist_runs  cascade;

commit;
