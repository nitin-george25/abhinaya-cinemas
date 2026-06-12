-- 20260612010000_payment_methods_settlement_days.sql
--
-- Add a per-method settlement lag (T+N days) to payment_methods, so the
-- Settlements form can autofill the expected payout date and the cashflow
-- report can project when non-cash money actually lands in the bank.
--
-- Settlement timing (Abhinaya):
--   UPI / Paytm / PhonePe  T+0   same-day, direct to bank
--   Pinelabs               T+1
--   BookMyShow             T+1
--   Razorpay QR            T+2
--
-- Also corrects a data bug: Razorpay QR was seeded flow_type
-- 'online_immediate' (same-day bank credit) in cash_05, but it actually
-- settles T+2 — so it should be 'online_settled' (a tracked payout), like
-- Pinelabs and BMS. UPI stays 'online_immediate' (genuinely same-day).
--
-- Idempotent.

alter table public.payment_methods
  add column if not exists settlement_days smallint not null default 0
    check (settlement_days >= 0);

-- Per-method lags, matched by code. Cash and UPI keep the default 0.
update public.payment_methods set settlement_days = 1 where code in ('pinelabs', 'bms');
update public.payment_methods set settlement_days = 2 where code = 'razorpay_qr';
update public.payment_methods set settlement_days = 0 where code in ('cash', 'paytm', 'phonepe');

-- Razorpay QR is T+2, not same-day — treat it as a settled payout.
update public.payment_methods
   set flow_type = 'online_settled'
 where code = 'razorpay_qr' and flow_type = 'online_immediate';
