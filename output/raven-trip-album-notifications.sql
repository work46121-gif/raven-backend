-- Additive: no backfill, changes to existing media, or changes to financial data.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.raven_trip_album add column if not exists upload_batch_id uuid;
alter table public.raven_push_events drop constraint if exists raven_push_events_kind_check;
alter table public.raven_push_events add constraint raven_push_events_kind_check check(kind in ('bill','trip','dm','group','trip_receipt','trip_comment','trip_assignment','trip_message','friend_request','trip_overdue','trip_payment','trip_album'));
create index if not exists raven_album_alerts_user_recent on public.raven_push_events(user_id,created_at desc) where kind='trip_album';

create or replace function public.raven_album_summary_alert() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare batch_key text;
begin
 -- A stable upload batch key survives partial failures/retries. Old clients
 -- without a batch header are coalesced into a short legacy time window.
 batch_key:=coalesce(new.upload_batch_id::text,'legacy-'||floor(extract(epoch from now())/300)::bigint::text);
 insert into public.raven_push_events(user_id,kind,source_id,event_key,available_at)
 select member.user_id,'trip_album',new.trip_id,
  'trip_album:'||new.trip_id||':'||new.uploader_id||':'||batch_key||':'||member.user_id,
  now()+interval '90 seconds'
 from public.raven_push_trip_member_ids(new.trip_id,new.uploader_id) member
 on conflict(event_key) do update set available_at=excluded.available_at
 where not raven_push_events.done and raven_push_events.attempts=0;
 -- Do not reopen delivered/claimed alerts or emit another alert for each file.
 return new;
end $$;
revoke all on function public.raven_album_summary_alert() from public,anon,authenticated;
create or replace trigger raven_trip_album_summary_added after insert on public.raven_trip_album
for each row execute function public.raven_album_summary_alert();
notify pgrst,'reload schema';
commit;
