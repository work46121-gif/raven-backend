begin;
set local lock_timeout='5s';set local statement_timeout='30s';
alter table public.trips add column if not exists sweep_payments jsonb not null default '[]'::jsonb;
create or replace function public.raven_save_sweep_payments(p_trip text,p_token text,p_expected jsonb,p_payments jsonb,p_outstanding numeric)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.trips%rowtype; snapshot jsonb; receipts jsonb;
begin
 select * into t from public.trips where id::text=p_trip for update;
 if not found or t.share_token::text is distinct from p_token then raise exception 'Invalid trip token'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id::text,'paid_by',paid_by,'total',total,'splits',splits) order by id::text),'[]'::jsonb)
   into receipts from public.trip_receipts where trip_id::text=p_trip;
 snapshot:=jsonb_build_object('people',t.people,'simple_split',t.simple_split,'settled_people',t.settled_people,'sweep_payments',t.sweep_payments,'receipts',receipts);
 if snapshot is distinct from p_expected then raise exception 'Balances changed. Refresh before recording payment.'; end if;
 if jsonb_typeof(p_payments) is distinct from 'array' or p_outstanding is null or p_outstanding<0 then raise exception 'Invalid payment ledger'; end if;
 update public.trips set sweep_payments=p_payments,total=p_outstanding where id=t.id;
 return jsonb_build_object('success',true);
end $$;
revoke all on function public.raven_save_sweep_payments(text,text,jsonb,jsonb,numeric) from public,anon,authenticated;
grant execute on function public.raven_save_sweep_payments(text,text,jsonb,jsonb,numeric) to service_role;
-- Serialize bill writes with payment recording and preserve payment identities.
create or replace function public.raven_guard_sweep_bill() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.trips%rowtype;
begin
 select * into t from public.trips where id::text=case when tg_op='DELETE' then old.trip_id::text else new.trip_id::text end for update;
 if tg_op='UPDATE' and new.paid_by is distinct from old.paid_by and exists(select 1 from jsonb_array_elements(t.sweep_payments) p where p->>'reversed_at' is null) then
   raise exception 'This trip has recorded Sweep payments. Reconcile those payments before changing the payer.';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create or replace trigger raven_sweep_bill_lock before insert or update or delete on public.trip_receipts for each row execute function public.raven_guard_sweep_bill();
create or replace function public.raven_guard_sweep_members() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare roster jsonb:=to_jsonb(new.people); i integer;
begin
 for i in 1..3 loop
   exit when jsonb_typeof(roster) is distinct from 'string';
   roster:=(roster#>>'{}')::jsonb;
 end loop;
 if exists(select 1 from jsonb_array_elements(new.sweep_payments) p where p->>'reversed_at' is null and
   (not exists(select 1 from jsonb_array_elements_text(roster) n where lower(trim(n))=lower(trim(p->>'from')))
    or not exists(select 1 from jsonb_array_elements_text(roster) n where lower(trim(n))=lower(trim(p->>'to'))))) then
   raise exception 'A member has recorded Sweep payments. Reconcile those payments before removing or renaming the member.';
 end if;
 return new;
end $$;
create or replace trigger raven_sweep_member_guard before update of people,sweep_payments on public.trips for each row execute function public.raven_guard_sweep_members();
revoke all on function public.raven_guard_sweep_bill() from public,anon,authenticated;
revoke all on function public.raven_guard_sweep_members() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
