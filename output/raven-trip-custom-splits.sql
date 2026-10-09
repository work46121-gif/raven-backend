-- Additive migration. No bills or payments are modified by installing it.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.trip_receipts add column if not exists split_settings jsonb;

create or replace function public.raven_trip_split_json(value jsonb)
returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare v jsonb:=value; i integer;
begin
  for i in 1..3 loop
    exit when jsonb_typeof(v) is distinct from 'string';
    v:=(v#>>'{}')::jsonb;
  end loop;
  return coalesce(v,'{}'::jsonb);
exception when others then return '{}'::jsonb;
end $$;

create or replace function public.raven_edit_trip_split(
 p_trip text,p_receipt text,p_token text,p_expected jsonb,p_updates jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 t public.trips%rowtype; r public.trip_receipts%rowtype; n public.trip_receipts%rowtype;
 entry record; other public.trip_receipts%rowtype; share record;
 credits jsonb; splits jsonb; person text; receipt_key text; owed numeric; fields text;
begin
 select * into t from public.trips where id::text=p_trip for update;
 if not found or t.share_token::text is distinct from p_token then raise exception 'Invalid trip token'; end if;
 select * into r from public.trip_receipts where id::text=p_receipt and trip_id::text=p_trip for update;
 if not found then raise exception 'Receipt not found'; end if;
 foreach fields in array array['name','paid_by','total','splits','items','tax','tip','service_fee','discount','split_settings'] loop
   if fields=any(array['total','tax','tip','service_fee','discount']) then
     if (to_jsonb(r)->>fields)::numeric is not distinct from (p_expected->>fields)::numeric then continue; end if;
     raise exception 'This bill changed in another session. Refresh before editing again.';
   end if;
   if coalesce(to_jsonb(r)->fields,'null'::jsonb) is distinct from coalesce(p_expected->fields,'null'::jsonb) then
     raise exception 'This bill changed in another session. Refresh before editing again.';
   end if;
 end loop;
 n:=jsonb_populate_record(r,p_updates);
 if n.total<=0 then raise exception 'Enter a positive bill total'; end if;
 credits:=public.raven_trip_split_json(to_jsonb(t.settled_people));
 if jsonb_typeof(credits)='array' then
   select coalesce(jsonb_object_agg(lower(value#>>'{}'),999999),'{}'::jsonb) into credits from jsonb_array_elements(credits);
 end if;
 if jsonb_typeof(credits)<>'object' then credits:='{}'::jsonb; end if;
 if n.paid_by is distinct from r.paid_by and credits<>'{}'::jsonb then
   raise exception 'This trip has recorded payments. Keep the payer unchanged, or reconcile those payments before changing the payer.';
 end if;
 -- Convert old paid-in-full sentinels to their actual pre-edit dollar credit.
 -- Real dollar credits are preserved, so an increased share can become due.
 for entry in select * from jsonb_each(credits) loop
   if jsonb_typeof(entry.value)='number' and (entry.value#>>'{}')::numeric>=999999 then
     person:=split_part(lower(entry.key),'::receipt::',1);
     receipt_key:=case when strpos(entry.key,'::receipt::')>0 then split_part(entry.key,'::receipt::',2) else null end;
     owed:=0;
     for other in select * from public.trip_receipts where trip_id::text=p_trip loop
       if receipt_key is not null and other.id::text<>receipt_key then continue; end if;
       if lower(coalesce(other.paid_by,''))=person then continue; end if;
       splits:=public.raven_trip_split_json(to_jsonb(other.splits));
       if jsonb_typeof(splits)<>'object' then continue; end if;
       for share in select * from jsonb_each(splits) loop
         if lower(share.key)=person then owed:=owed+greatest(0,(share.value#>>'{}')::numeric); end if;
       end loop;
     end loop;
     credits:=jsonb_set(credits,array[entry.key],to_jsonb(round(owed,2)));
   end if;
 end loop;
 update public.trip_receipts set name=n.name,paid_by=n.paid_by,total=n.total,splits=n.splits,
   items=n.items,tax=n.tax,tip=n.tip,service_fee=n.service_fee,discount=n.discount,split_settings=n.split_settings
   where id=r.id;
 -- Populate the existing column type (json/jsonb/text) without changing its schema.
 t:=jsonb_populate_record(t,jsonb_build_object('settled_people',credits));
 update public.trips set settled_people=t.settled_people where id=t.id;
 return jsonb_build_object('success',true);
end $$;
revoke all on function public.raven_trip_split_json(jsonb) from public,anon,authenticated;
revoke all on function public.raven_edit_trip_split(text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.raven_trip_split_json(jsonb) to service_role;
grant execute on function public.raven_edit_trip_split(text,text,text,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
