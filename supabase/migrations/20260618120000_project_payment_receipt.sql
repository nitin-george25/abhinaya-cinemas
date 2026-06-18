-- ============================================================================
-- Project expense payment: receipt replaces OTP at mark-paid.
--
-- Previously the accountant typed an OTP (shared by the owner on Slack) to mark
-- an expense paid. We now drop the OTP input and instead require the accountant
-- to attach the payment RECEIPT (bank / UPI proof). The console posts a second
-- message to Slack #payments with that receipt once the expense is marked paid.
--
-- The `otp_reference` column is kept for historical rows (no longer written).
-- ============================================================================

begin;

-- 1) Receipt metadata on the expense (file lives in the project-files bucket).
alter table public.project_expenses
  add column if not exists payment_receipt_url          text,
  add column if not exists payment_receipt_name         text,
  add column if not exists payment_receipt_size         bigint,
  add column if not exists payment_receipt_content_type text;

-- 2) Allow the ACCOUNTANT to upload to project-files (they attach the receipt
--    at mark-paid). Previously only owner / manager / daily_manager could write.
drop policy if exists "project_files_write" on storage.objects;
create policy "project_files_write" on storage.objects
  for insert with check (
    bucket_id = 'project-files'
    and exists (
      select 1 from public.authorized_users
       where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         and role in ('owner','manager','daily_manager','accountant')
    )
  );

-- 3) Mark paid now requires a receipt instead of an OTP. The argument list
--    changes, so drop the old signature (text, text, numeric, text) first.
drop function if exists public.fn_project_expense_mark_paid(text, text, numeric, text);

create or replace function public.fn_project_expense_mark_paid(
  p_expense_id   text,
  p_paid_amount  numeric,
  p_note         text,
  p_receipt_url  text,
  p_receipt_name text,
  p_receipt_size bigint,
  p_content_type text
) returns void language plpgsql security definer set search_path = public
as $$
declare e public.project_expenses%rowtype;
        v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if not public.is_accountant_or_owner() then raise exception 'Only the accountant can mark paid'; end if;
  if coalesce(btrim(p_receipt_url), '') = '' then
    raise exception 'A payment receipt is required to mark paid';
  end if;
  select * into e from public.project_expenses where id = p_expense_id;
  if not found then raise exception 'Expense not found'; end if;
  if e.status <> 'payment_requested' then
    raise exception 'Expense has no payment request (status %)', e.status;
  end if;
  update public.project_expenses
     set status                       = 'paid',
         paid_amount                  = coalesce(p_paid_amount, approved_amount),
         paid_at                      = now(),
         paid_by                      = v_actor,
         payment_note                 = p_note,
         payment_receipt_url          = p_receipt_url,
         payment_receipt_name         = p_receipt_name,
         payment_receipt_size         = p_receipt_size,
         payment_receipt_content_type = p_content_type,
         updated_by                   = v_actor
   where id = e.id;
  perform public.fn_project_expense_audit(
    e.project_id, e.id, 'expense_paid',
    jsonb_build_object('paid_amount', coalesce(p_paid_amount, e.approved_amount),
                       'receipt_url', p_receipt_url));
end;
$$;

commit;

-- ============================================================================
-- VERIFY (after applying):
--   select column_name from information_schema.columns
--     where table_name = 'project_expenses' and column_name like 'payment_receipt%';
--   select pg_get_function_arguments(oid) from pg_proc
--     where proname = 'fn_project_expense_mark_paid';
-- ============================================================================
