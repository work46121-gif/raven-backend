-- Atomic new payment alerts. No backfill or modification of payment records.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.raven_push_events drop constraint if exists raven_push_events_kind_check;
alter table public.raven_push_events add constraint raven_push_events_kind_check check(kind in ('bill','trip','dm','group','trip_receipt','trip_comment','trip_assignment','trip_message','friend_request','trip_overdue','trip_payment'));
create or replace function public.raven_payment_alert() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 n jsonb:=to_jsonb(new); o jsonb:='{}'::jsonb; payment jsonb;
 old_payments jsonb; new_payments jsonb; target uuid; matches integer;
 payer_name text; recipient_name text; bill jsonb;
begin
 if tg_op='UPDATE' then o:=to_jsonb(old); end if;
 if tg_table_name='participants' then
  if coalesce(n->>'paid','false')<>'true' or coalesce(o->>'paid','false')='true' then return new; end if;
  select to_jsonb(b) into bill from public.bills b where b.id::text=n->>'bill_id';
  select p.id::uuid into target from public.profiles p
   where lower(p.email)=lower(bill->>'creator_email') and coalesce(to_jsonb(p)->>'privacy_payment_alerts','true')<>'false';
  if target is null or lower(coalesce(n->>'phone',''))=lower(bill->>'creator_email')
    or lower(coalesce(n->>'name',''))=lower(coalesce(bill->>'paid_by','')) then return new; end if;
  insert into public.raven_push_events(user_id,kind,source_id,event_key,actor_name)
   values(target,'bill',n->>'bill_id','bill_payment:'||(n->>'id')||':'||coalesce(n->>'paid_at','first'),left(split_part(trim(n->>'name'),' ',1),60))
   on conflict(event_key) do nothing;
 elsif tg_table_name='trips' then
  new_payments:=n->'sweep_payments';old_payments:=o->'sweep_payments';
  if jsonb_typeof(new_payments)='string' then new_payments:=(new_payments #>> '{}')::jsonb; end if;
  if jsonb_typeof(old_payments)='string' then old_payments:=(old_payments #>> '{}')::jsonb; end if;
  if jsonb_typeof(new_payments) is distinct from 'array' then return new; end if;
  if jsonb_typeof(old_payments) is distinct from 'array' then old_payments:='[]'::jsonb; end if;
  for payment in select value from jsonb_array_elements(new_payments) loop
   if coalesce(payment->>'id','')='' or coalesce(payment->>'reversed_at','')<>'' or
     exists(select 1 from jsonb_array_elements(old_payments) previous where previous->>'id'=payment->>'id') then continue; end if;
   payer_name:=trim(payment->>'from');recipient_name:=trim(payment->>'to');
   if lower(payer_name)=lower(recipient_name) then continue; end if;
   -- Only linked accounts, never unrelated people with the same first name.
   select count(*),(array_agg(p.id::uuid))[1] into matches,target
    from public.raven_push_linked_trip_profiles(n->>'id') p
    where lower(recipient_name)=any(array[lower(p.first_name),lower(trim(concat_ws(' ',p.first_name,p.last_name))),lower(p.raven_id),'@'||lower(p.raven_id)]);
   if matches<>1 then continue; end if;
   if exists(select 1 from public.profiles p where p.id::uuid=target and coalesce(to_jsonb(p)->>'privacy_payment_alerts','true')='false') then continue; end if;
   insert into public.raven_push_events(user_id,kind,source_id,event_key,actor_name,trip_name)
    values(target,'trip_payment',n->>'id','trip_payment:'||(payment->>'id')||':'||target,left(split_part(payer_name,' ',1),60),left(n->>'name',100))
    on conflict(event_key) do nothing;
  end loop;
 end if;
 return new;
end $$;
drop trigger if exists raven_payment_participant on public.participants;
create trigger raven_payment_participant after insert or update of paid on public.participants for each row execute function public.raven_payment_alert();
drop trigger if exists raven_payment_sweep on public.trips;
create trigger raven_payment_sweep after update of sweep_payments on public.trips for each row execute function public.raven_payment_alert();
revoke all on function public.raven_payment_alert() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
