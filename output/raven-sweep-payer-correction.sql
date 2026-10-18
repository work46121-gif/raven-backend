-- Apply after raven-sweep-ledger.sql. Installs behavior only; edits no receipts/payments.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Keep serialization with payment recording. A payer correction changes the
-- receipt's funding, not the identity of any transfer already recorded.
-- RavenSweep.build applies those transfers to the corrected balances, including
-- any refund now due from the former payer. Legacy recipient-less credits still
-- have the separate safety check in raven_edit_trip_split.
create or replace function public.raven_guard_sweep_bill() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.trips%rowtype;
begin
 select * into t from public.trips
   where id::text=case when tg_op='DELETE' then old.trip_id::text else new.trip_id::text end
   for update;
 -- Payer corrections with existing transfers must go through the service-only,
 -- token/snapshot-checked edit RPC, not a direct client table update.
 if tg_op='UPDATE' and new.paid_by is distinct from old.paid_by
   and exists(select 1 from jsonb_array_elements(t.sweep_payments) p where p->>'reversed_at' is null)
   and current_setting('raven.payer_correction',true) is distinct from jsonb_build_array(t.id::text,old.id::text)::text then
   raise exception 'Refresh the trip and use Edit bill to change who paid. Recorded payments will be preserved.';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function public.raven_guard_sweep_bill() from public,anon,authenticated;
create or replace function public.raven_correct_trip_payer(
 p_trip text,p_receipt text,p_token text,p_expected jsonb,p_updates jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare saved jsonb; previous text:=current_setting('raven.payer_correction',true);
begin
 perform set_config('raven.payer_correction',jsonb_build_array(p_trip,p_receipt)::text,true);
 -- Existing RPC locks the trip/receipt, checks the trip token and expected bill,
 -- and blocks ambiguous legacy credits before changing any rows.
 saved:=public.raven_edit_trip_split(p_trip,p_receipt,p_token,p_expected,p_updates);
 perform set_config('raven.payer_correction',coalesce(previous,''),true);
 return saved;
end $$;
revoke all on function public.raven_correct_trip_payer(text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.raven_correct_trip_payer(text,text,text,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
