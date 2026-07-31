-- ============================================================================
-- 02 — Storage bucket for SOP documents
--
-- Holds the branded bilingual SOP PDFs. Public-read, like the other document
-- buckets in this app (project-files, petty-receipts, fb-checklist-photos), so
-- the PDF renders straight into the console viewer and a manager can be sent a
-- direct link on WhatsApp without signed-URL plumbing. Paths are uuid-prefixed,
-- so they are not guessable.
--
-- Writes are owner/manager only — same rule as the sops table itself: the
-- library is centrally owned.
-- ============================================================================

begin;

insert into storage.buckets (id, name, public)
  values ('sop-documents', 'sop-documents', true)
  on conflict (id) do update set public = excluded.public;

drop policy if exists "sop_documents_read"   on storage.objects;
drop policy if exists "sop_documents_write"  on storage.objects;
drop policy if exists "sop_documents_update" on storage.objects;
drop policy if exists "sop_documents_delete" on storage.objects;

create policy "sop_documents_read" on storage.objects
  for select using (bucket_id = 'sop-documents');

create policy "sop_documents_write" on storage.objects
  for insert with check (
    bucket_id = 'sop-documents' and public.is_owner_or_manager()
  );

create policy "sop_documents_update" on storage.objects
  for update using (
    bucket_id = 'sop-documents' and public.is_owner_or_manager()
  );

create policy "sop_documents_delete" on storage.objects
  for delete using (
    bucket_id = 'sop-documents' and public.is_owner_or_manager()
  );

commit;
