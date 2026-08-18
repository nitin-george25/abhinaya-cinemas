-- ============================================================================
-- payments_101 — the batch payee check must not reject a payee that matches.
--
-- Symptom on staging: ticking two invoices for the one and only vendor and
-- pressing "Pay together" failed with "A batch pays one payee — Acme does not
-- match Acme". Identical names, one vendor, still refused.
--
-- Cause: fn_payment_batch_payee_matches compared ids whenever EITHER side had
-- one. The inbox built its batch from a payee NAME only (it never passed the
-- party id), so the batch's payee_party_id was null while every line carried a
-- real one. The `or` fired, null was compared against a uuid, and the answer was
-- false for a payee that obviously matched.
--
-- The console side is fixed too — the inbox now carries the party/distributor id
-- into the batch. This migration fixes the rule itself, because a check that
-- turns "one side is missing an id" into "different payee" is wrong regardless
-- of who calls it, and payment_requests rows do legitimately exist without a
-- party id (the legacy free-text rows that predate payments_01).
--
-- New rule, in order:
--   • both sides carry a distributor id  → compare those, and only those
--   • both sides carry a party id        → compare those
--   • otherwise                          → compare normalised names
--
-- Comparing ids only when BOTH sides have one keeps the strong check where the
-- data supports it and degrades to the name where it does not. The narrower
-- risk this accepts — two distinct parties sharing a name, one of them without
-- an id on the row — was already the behaviour whenever neither side had an id,
-- and is a far better failure than refusing every correct batch.
--
-- HOW TO RUN: npm run db:push:staging / :prod (Supabase CLI). Idempotent.
-- ============================================================================

begin;

create or replace function public.fn_payment_batch_payee_matches(
  p_batch public.payment_batches, p_pay public.payment_requests
) returns boolean language sql immutable
as $$
  select case
    when p_batch.payee_distributor_id is not null
     and p_pay.payee_distributor_id   is not null
      then p_batch.payee_distributor_id = p_pay.payee_distributor_id
    when p_batch.payee_party_id is not null
     and p_pay.payee_party_id   is not null
      then p_batch.payee_party_id = p_pay.payee_party_id
    else lower(btrim(coalesce(p_batch.payee_name, '')))
       = lower(btrim(coalesce(p_pay.payee_name, '')))
  end;
$$;

commit;

-- ============================================================================
-- VERIFY (after applying):
--   -- Same vendor, batch built without a party id (the failing case):
--   --   create a batch with payee_name only → fn_payment_batch_add ⇒ succeeds
--   -- Genuinely different payees still refused:
--   --   add an invoice for another vendor    ⇒ 'A batch pays one payee …'
--   -- Same name, two different party ids, both present ⇒ still refused.
-- ============================================================================
