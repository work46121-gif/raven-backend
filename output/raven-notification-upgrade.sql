-- RAVEN notification upgrade: additive schema, no backfill or account changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.raven_push_events add column if not exists actor_name text;
alter table public.raven_push_events add column if not exists trip_name text;
alter table public.raven_push_events drop constraint if exists raven_push_events_kind_check;
alter table public.raven_push_events add constraint raven_push_events_kind_check check(kind in ('bill','trip','dm','group','trip_receipt','trip_comment','trip_assignment','trip_message','friend_request','trip_overdue'));
create or replace function public.raven_push_trip_member_ids(p_trip text, p_exclude uuid default null)
returns table(user_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
 select distinct p.id::uuid
 from public.trips t
 join public.profiles p on (
   lower(coalesce(p.email,'')) = any(public.raven_push_emails(to_jsonb(t.member_emails)))
   or lower(coalesce(p.email,'')) = lower(coalesce(t.creator_email,''))
 )
 where t.id::text = p_trip and (p_exclude is null or p.id::uuid <> p_exclude);
$$;

-- Service-only helper: never fetch unrelated profiles to guess a debtor by name.
create or replace function public.raven_push_linked_trip_profiles(p_trip text)
returns table(id uuid,email text,first_name text,last_name text,raven_id text)
language sql stable security definer set search_path = public, pg_temp as $$
 select p.id::uuid,p.email::text,p.first_name::text,p.last_name::text,p.raven_id::text
 from public.profiles p join public.raven_push_trip_member_ids(p_trip,null) m on m.user_id=p.id::uuid;
$$;

create or replace function public.raven_enqueue_trip_reminders(p_trip text,p_due text,p_cycle integer,p_users uuid[])
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
 t public.trips%rowtype;
 local_now timestamp := now() at time zone 'America/New_York';
 cycle integer;
 inserted integer;
begin
 -- Serializes check+insert across worker replicas. A date change cannot cause
 -- another reminder less than three local calendar days after the last one.
 select * into t from public.trips where id::text=p_trip for update;
 if not found or t.due_date::text is distinct from p_due then return 0; end if;
 if coalesce(to_jsonb(t)->>'status','') in ('deleted','archived','cancelled','canceled')
    or coalesce(to_jsonb(t)->>'type','')='roommates' then return 0; end if;
 if extract(hour from local_now)<10 or extract(hour from local_now)>=20 then return 0; end if;
 cycle := floor((local_now::date-p_due::date)/3.0);
 if cycle<1 or cycle<>p_cycle then return 0; end if;
 insert into public.raven_push_events(user_id,kind,source_id,event_key,trip_name)
 select m.user_id,'trip_overdue',p_trip,'trip_overdue:'||p_trip||':'||m.user_id||':'||p_due||':'||cycle,left(t.name,100)
 from public.raven_push_trip_member_ids(p_trip,null) m
 where m.user_id=any(p_users)
 and exists(select 1 from public.raven_push_devices d where d.user_id=m.user_id and d.session_id is not null)
 and not exists(select 1 from public.raven_push_events e where e.user_id=m.user_id and e.source_id=p_trip
   and e.kind='trip_overdue' and (e.created_at at time zone 'America/New_York')::date>local_now::date-3)
 on conflict(event_key) do nothing;
 get diagnostics inserted = row_count;
 return inserted;
end $$;

-- Decorate new events only. The actor is resolved from stored account IDs,
-- not a caller-provided notification title. No private message text is copied.
create or replace function public.raven_describe_phone_alert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor_text text; message_id text;
begin
 if new.kind='dm' then actor_text := new.source_id;
 elsif new.kind in ('group','trip_message','trip_comment') then
   message_id := split_part(new.event_key,':',2);
   if new.kind='group' then select sender_id::text into actor_text from public.raven_chat_messages where id::text=message_id;
   elsif new.kind='trip_message' then select user_id::text into actor_text from public.trip_messages where id::text=message_id;
   else select user_id::text into actor_text from public.trip_comments where id::text=message_id;
   end if;
 end if;
 if actor_text is not null then select left(first_name,60) into new.actor_name from public.profiles where id::text=actor_text; end if;
 if new.kind in ('trip_comment','trip_message','trip_overdue') then
   select left(name,100) into new.trip_name from public.trips where id::text=new.source_id;
 end if;
 return new;
end $$;
drop trigger if exists raven_describe_push on public.raven_push_events;
create trigger raven_describe_push before insert on public.raven_push_events for each row execute function public.raven_describe_phone_alert();

create or replace function public.raven_enqueue_phone_alert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
 n jsonb := to_jsonb(new);
 o jsonb := '{}'::jsonb;
 target uuid;
 actor uuid;
 src text;
 new_splits jsonb;
 old_splits jsonb;
 uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
 number_re constant text := '^[[:space:]]*[0-9]+(\.[0-9]+)?[[:space:]]*$';
begin
 if tg_op = 'UPDATE' then o := to_jsonb(old); end if;

 if tg_table_name = 'direct_messages' then
   if coalesce(n->>'receiver_id','') !~* uuid_re then return new; end if;
   target := (n->>'receiver_id')::uuid;
   if coalesce(n->>'sender_id','') ~* uuid_re and target = (n->>'sender_id')::uuid then return new; end if;
   insert into public.raven_push_events(user_id,kind,source_id,event_key)
   values(target,'dm',coalesce(n->>'sender_id',''),'dm:'||coalesce(n->>'id','') ) on conflict do nothing;

 elsif tg_table_name = 'raven_chat_messages' then
   if coalesce(n->>'chat_id','') !~* uuid_re then return new; end if;
   insert into public.raven_push_events(user_id,kind,source_id,event_key)
   select user_id,'group',n->>'chat_id','group:'||coalesce(n->>'id','')||':'||user_id
   from public.raven_chat_members
   where chat_id=(n->>'chat_id')::uuid
     and (coalesce(n->>'sender_id','') !~* uuid_re or user_id<>(n->>'sender_id')::uuid)
   on conflict do nothing;

 elsif tg_table_name = 'participants' then
   if lower(coalesce(n->>'phone','')) = lower(coalesce(o->>'phone','')) then return new; end if;
   -- Only exact, explicitly linked emails; never infer a bill recipient from a name.
   select id::uuid into target from public.profiles where lower(email)=lower(n->>'phone') limit 1;
   if target is null then return new; end if;
   insert into public.raven_push_events(user_id,kind,source_id,event_key)
   values(target,'bill',coalesce(n->>'bill_id',''),'bill:'||coalesce(n->>'id','')||':'||target) on conflict do nothing;

 elsif tg_table_name = 'trips' then
   if coalesce(n->>'id','') = '' then return new; end if;
   insert into public.raven_push_events(user_id,kind,source_id,event_key)
   select p.id::uuid,'trip',n->>'id','trip:'||(n->>'id')||':'||p.id
   from public.profiles p
   where lower(coalesce(p.email,''))=any(public.raven_push_emails(n->'member_emails'))
     and not(lower(coalesce(p.email,''))=any(public.raven_push_emails(o->'member_emails')))
   on conflict do nothing;

 elsif tg_table_name = 'trip_messages' then
   if coalesce(n->>'trip_id','') = '' or coalesce(n->>'user_id','') !~* uuid_re then return new; end if;
   actor := (n->>'user_id')::uuid;
   insert into public.raven_push_events(user_id,kind,source_id,event_key)
   select user_id,'trip_message',n->>'trip_id','trip_message:'||coalesce(n->>'id','')||':'||user_id
   from public.raven_push_trip_member_ids(n->>'trip_id', actor)
   on conflict do nothing;

 elsif tg_table_name = 'trip_comments' then
   if coalesce(n->>'trip_id','') = '' or coalesce(n->>'user_id','') !~* uuid_re then return new; end if;
   actor := (n->>'user_id')::uuid;
   insert into public.raven_push_events(user_id,kind,source_id,event_key)
   select user_id,'trip_comment',n->>'trip_id','trip_comment:'||coalesce(n->>'id','')||':'||user_id
   from public.raven_push_trip_member_ids(n->>'trip_id', actor)
   on conflict do nothing;

 elsif tg_table_name = 'trip_receipts' then
   if coalesce(n->>'trip_id','') = '' then return new; end if;
   src := coalesce(n->>'id','');
   if coalesce(n->>'added_by_user_id','') ~* uuid_re then
     actor := (n->>'added_by_user_id')::uuid;
   elsif coalesce(n->>'added_by','') <> '' then
     -- Legacy receipts only carry a display name. Use it solely to suppress a
     -- possible self-alert when it identifies one linked member exactly.
     select p.id::uuid into actor
     from public.profiles p
     join public.raven_push_trip_member_ids(n->>'trip_id', null) members on members.user_id=p.id::uuid
     where lower(coalesce(p.first_name,''))=lower(trim(n->>'added_by'))
     limit 1;
   end if;
   if tg_op = 'INSERT' then
     insert into public.raven_push_events(user_id,kind,source_id,event_key)
     select user_id,'trip_receipt',n->>'trip_id','trip_receipt:'||src||':'||user_id
     from public.raven_push_trip_member_ids(n->>'trip_id', actor)
     on conflict do nothing;
   end if;
   new_splits := public.raven_push_object(n->'splits');
   old_splits := public.raven_push_object(o->'splits');
   -- An assignment alert is sent only when this person receives a positive
   -- share for the first time, including the first save of a receipt.
   insert into public.raven_push_events(user_id,kind,source_id,event_key)
   select distinct members.user_id,'trip_assignment',src,'trip_assignment:'||src||':'||members.user_id
   from public.raven_push_trip_member_ids(n->>'trip_id', actor) members
   join public.profiles p on p.id::uuid=members.user_id
   join lateral jsonb_each_text(new_splits) share on true
   where share.value ~ number_re
     and trim(share.value)::numeric > 0
     and (
       tg_op = 'INSERT' or not exists (
         select 1 from jsonb_each_text(old_splits) previous
         where previous.key=share.key and previous.value ~ number_re and trim(previous.value)::numeric > 0
       )
     )
     and (
       lower(coalesce(p.first_name,''))=lower(trim(share.key))
       or lower(coalesce(p.raven_id,''))=lower(regexp_replace(trim(share.key),'^@',''))
     )
   on conflict do nothing;

 elsif tg_table_name = 'raven_friends' then
   if lower(coalesce(n->>'status','')) <> 'pending' then return new; end if;
   if tg_op = 'UPDATE' and lower(coalesce(o->>'status','')) = 'pending' then return new; end if;
   if coalesce(n->>'friend_id','') !~* uuid_re or coalesce(n->>'user_id','') !~* uuid_re then return new; end if;
   target := (n->>'friend_id')::uuid;
   if target = (n->>'user_id')::uuid then return new; end if;
   insert into public.raven_push_events(user_id,kind,source_id,event_key)
   values(target,'friend_request',n->>'user_id','friend_request:'||coalesce(n->>'id',(n->>'user_id')||':'||(n->>'friend_id')))
   on conflict do nothing;
 end if;
 return new;
end $$;


revoke all on function public.raven_push_trip_member_ids(text,uuid), public.raven_push_linked_trip_profiles(text), public.raven_enqueue_trip_reminders(text,text,integer,uuid[]), public.raven_describe_phone_alert() from public, anon, authenticated;
grant execute on function public.raven_push_linked_trip_profiles(text), public.raven_enqueue_trip_reminders(text,text,integer,uuid[]) to service_role;
notify pgrst, 'reload schema';
commit;
select 'Notification upgrade applied' as result;
