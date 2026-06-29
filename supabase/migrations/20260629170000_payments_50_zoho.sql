-- ============================================================================
-- payments_50 — Zoho F&B push queue (phase 6, §10, D6).
--
-- On mark-paid of an F&B supplier payment (payment_types.zoho_push = true) the
-- payment is enqueued for a one-way, best-effort push to Zoho Books as a paid
-- expense. The push itself runs in the payments-zoho-push Edge Function and is
-- retryable; a failure is logged here and NEVER blocks the payment.
--
-- HOW TO RUN: npm run db:push:staging / :prod (Supabase CLI). Idempotent.
-- After applying: set the per-env Zoho secrets (reused from the existing
-- integration) + ZOHO_FB_EXPENSE_ACCOUNT / ZOHO_FB_PAID_THROUGH account names.
-- ============================================================================

begin;

create table if not exists public.payment_zoho_pushes (
  payment_id      uuid primary key references public.payment_requests(id) on delete cascade,
  status          text not null default 'queued'
                    check (status in ('queued','synced','failed','skipped')),
  zoho_expense_id text,
  error           text,
  attempts        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.payment_zoho_pushes enable row level security;

drop policy if exists payment_zoho_pushes_read on public.payment_zoho_pushes;
create policy payment_zoho_pushes_read on public.payment_zoho_pushes
  for select using (
    exists (select 1 from public.payment_requests pr
             where pr.id = payment_zoho_pushes.payment_id
               and public.cinema_access_unit(pr.operating_unit_id))
  );
-- Writes happen via the trigger + the Edge Function (service role).

-- ----------------------------------------------------------------------------
-- Enqueue on mark-paid for zoho_push types.
-- ----------------------------------------------------------------------------
create or replace function public.fn_payment_enqueue_zoho()
  returns trigger language plpgsql security definer set search_path = public
as $$
declare v_push boolean;
begin
  if new.status = 'paid' and (old.status is distinct from 'paid') then
    select zoho_push into v_push from public.payment_types where id = new.payment_type_id;
    if coalesce(v_push, false) then
      insert into public.payment_zoho_pushes (payment_id, status)
      values (new.id, 'queued')
      on conflict (payment_id) do update set status = 'queued', updated_at = now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists payment_enqueue_zoho on public.payment_requests;
create trigger payment_enqueue_zoho
  after update on public.payment_requests
  for each row execute function public.fn_payment_enqueue_zoho();

commit;

-- ============================================================================
-- VERIFY (after applying):
--   select to_regclass('public.payment_zoho_pushes');
--   select tgname from pg_trigger where tgname = 'payment_enqueue_zoho';
-- ============================================================================
