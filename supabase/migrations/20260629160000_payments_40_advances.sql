-- ============================================================================
-- payments_40 — Advances & netting (phase 5, §8, D8/D9).
--
-- A vendor advance is a paid payment with is_advance = true. When the final tax
-- invoice arrives, the accountant nets one-or-more outstanding advances against
-- it (many → one, partials allowed). payment_advance_links records each
-- application; the final payable = amount − Σ amount_applied (the accountant
-- pays the net at mark-paid).
--
-- Distributor share advances (D9) are tagged movie + distributor and auto-net
-- off the console-computed settlement — this migration adds the link table and
-- the *display* surface; the settlement-side auto-net hook reads these links.
--
-- HOW TO RUN: npm run db:push:staging / :prod (Supabase CLI). Idempotent.
-- ============================================================================

begin;

create table if not exists public.payment_advance_links (
  id                 uuid primary key default gen_random_uuid(),
  final_payment_id   uuid not null references public.payment_requests(id) on delete cascade,
  advance_payment_id uuid not null references public.payment_requests(id) on delete cascade,
  amount_applied     numeric(14,2) not null check (amount_applied >= 0),
  confirmed_by       text,
  confirmed_at       timestamptz not null default now(),
  unique (final_payment_id, advance_payment_id)
);
create index if not exists payment_advance_links_final_idx
  on public.payment_advance_links (final_payment_id);
create index if not exists payment_advance_links_advance_idx
  on public.payment_advance_links (advance_payment_id);

alter table public.payment_advance_links enable row level security;

drop policy if exists payment_advance_links_read on public.payment_advance_links;
create policy payment_advance_links_read on public.payment_advance_links
  for select using (
    exists (select 1 from public.payment_requests pr
             where pr.id = payment_advance_links.final_payment_id
               and public.cinema_access_unit(pr.operating_unit_id))
  );
-- Writes go through the SECURITY DEFINER fn below.

-- ----------------------------------------------------------------------------
-- Net advances against a final payment (accountant confirms; re-nettable).
-- Parallel arrays p_advance_ids[i] ↔ p_amounts[i].
-- ----------------------------------------------------------------------------
create or replace function public.fn_net_advances(
  p_final_payment_id uuid, p_advance_ids uuid[], p_amounts numeric[]
) returns void language plpgsql security definer set search_path = public
as $$
declare r public.payment_requests%rowtype; v_sum numeric := 0; i int;
        v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if not public.is_accountant_or_owner() then raise exception 'Only the accountant can net advances'; end if;
  select * into r from public.payment_requests where id = p_final_payment_id;
  if not found then raise exception 'Payment not found'; end if;
  if p_advance_ids is null or array_length(p_advance_ids, 1) is null then
    raise exception 'No advances selected'; end if;
  if array_length(p_advance_ids, 1) <> array_length(p_amounts, 1) then
    raise exception 'Mismatched advance arrays'; end if;

  delete from public.payment_advance_links where final_payment_id = p_final_payment_id;
  for i in 1 .. array_length(p_advance_ids, 1) loop
    v_sum := v_sum + coalesce(p_amounts[i], 0);
    insert into public.payment_advance_links
      (final_payment_id, advance_payment_id, amount_applied, confirmed_by)
    values (p_final_payment_id, p_advance_ids[i], coalesce(p_amounts[i], 0), v_actor);
  end loop;

  if v_sum > r.amount then raise exception 'Applied advances (%) exceed the payment total (%)', v_sum, r.amount; end if;
  perform public.fn_payment_audit(r.id, r.status, r.status, 'netted advances ' || v_sum::text, null);
end;
$$;

-- ----------------------------------------------------------------------------
-- Redefine mark-paid to account for netted advances: the expected paid amount
-- is (amount − applied advances); a reason is only needed if the actual paid
-- amount differs from THAT net (not the gross).
-- ----------------------------------------------------------------------------
create or replace function public.fn_payment_mark_paid(
  p_payment_id uuid, p_bank_account_id uuid, p_reference text,
  p_paid_amount numeric, p_paid_reason text, p_paid_date date
) returns void language plpgsql security definer set search_path = public
as $$
declare r public.payment_requests%rowtype;
        v_applied numeric(14,2); v_net numeric(14,2); v_amt numeric(14,2);
begin
  if not public.is_accountant_or_owner() then raise exception 'Only the accountant can mark paid'; end if;
  if p_bank_account_id is null then raise exception 'Pick a bank account'; end if;
  select * into r from public.payment_requests where id = p_payment_id;
  if not found then raise exception 'Payment not found'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved payment can be marked paid (status %)', r.status; end if;

  select coalesce(sum(amount_applied), 0) into v_applied
    from public.payment_advance_links where final_payment_id = r.id;
  v_net := r.amount - coalesce(v_applied, 0);
  v_amt := coalesce(p_paid_amount, v_net);
  if v_amt <> v_net and coalesce(btrim(p_paid_reason), '') = '' then
    raise exception 'A reason is required when the paid amount differs from the net payable';
  end if;

  update public.payment_requests
     set status = 'paid',
         paid_at = coalesce(p_paid_date::timestamptz, now()),
         paid_via_bank_account_id = p_bank_account_id,
         bank_reference = p_reference,
         paid_amount = v_amt,
         paid_amount_reason = nullif(btrim(p_paid_reason), '')
   where id = r.id;
  perform public.fn_payment_audit(r.id, r.status, 'paid',
    'paid ' || v_amt::text || coalesce(' — ' || p_reference, ''), null);
end;
$$;

commit;

-- ============================================================================
-- VERIFY (after applying):
--   select to_regclass('public.payment_advance_links');
--   select proname from pg_proc where proname = 'fn_net_advances';
-- ============================================================================
