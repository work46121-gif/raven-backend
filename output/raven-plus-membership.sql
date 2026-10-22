-- Private RAVEN Plus foundation. NOT a launch or billing activation.
-- Adds no memberships, sponsors, storage policies, quotas or financial changes.
-- The application still allows all existing trip/receipt/album operations.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.raven_plus_memberships (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 provider text not null check(provider in ('apple','complimentary')),
 environment text not null check(environment in ('production','sandbox')),
 subscription_id text not null check(char_length(subscription_id) between 1 and 256),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 revoked_at timestamptz,
 last_event_at timestamptz not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(provider,environment,subscription_id),
 check(isfinite(starts_at) and isfinite(ends_at) and isfinite(last_event_at) and ends_at > starts_at),
 check(revoked_at is null or isfinite(revoked_at))
);
create index if not exists raven_plus_memberships_user on public.raven_plus_memberships(user_id,ends_at desc);
create table if not exists public.raven_plus_membership_events (
 provider text not null,
 environment text not null,
 event_id text not null check(char_length(event_id) between 1 and 256),
 membership_id uuid not null references public.raven_plus_memberships(id) on delete cascade,
 -- Normalized period/revocation facts only: never raw receipts, tokens or card data.
 facts jsonb not null,
 received_at timestamptz not null default now(),
 primary key(provider,environment,event_id)
);
create table if not exists public.raven_plus_trip_sponsors (
 trip_id text not null references public.trips(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(trip_id,user_id)
);
create index if not exists raven_plus_sponsors_user on public.raven_plus_trip_sponsors(user_id);
alter table public.raven_plus_memberships enable row level security;
alter table public.raven_plus_membership_events enable row level security;
alter table public.raven_plus_trip_sponsors enable row level security;
revoke all on public.raven_plus_memberships,public.raven_plus_membership_events,public.raven_plus_trip_sponsors from public,anon,authenticated;
grant all on public.raven_plus_memberships,public.raven_plus_membership_events,public.raven_plus_trip_sponsors to service_role;

-- INTERNAL persistence boundary, not a signature verifier. A future provider
-- adapter MUST verify Apple signatures, bundle/app identity, environment,
-- product allowlist and appAccountToken binding BEFORE calling this function.
-- No HTTP handler invokes it; browser sessions cannot execute it.
create or replace function public.raven_plus_record_verified_membership(
 p_user_id uuid,p_provider text,p_environment text,p_subscription_id text,p_event_id text,
 p_event_at timestamptz,p_starts_at timestamptz,p_ends_at timestamptz,p_revoked_at timestamptz default null
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare
 row public.raven_plus_memberships%rowtype;
 prior public.raven_plus_membership_events%rowtype;
 event_facts jsonb;
 inserted integer;
begin
 if p_user_id is null or p_provider is null or p_provider not in ('apple','complimentary')
   or p_environment is null or p_environment not in ('production','sandbox')
   or p_subscription_id is null or char_length(btrim(p_subscription_id)) not between 1 and 256
   or p_event_id is null or char_length(btrim(p_event_id)) not between 1 and 256
   or p_event_at is null or not isfinite(p_event_at) or p_event_at>now()+interval '5 minutes'
   or p_starts_at is null or p_ends_at is null or not isfinite(p_starts_at) or not isfinite(p_ends_at)
   or p_ends_at<=p_starts_at
   or (p_revoked_at is not null and (not isfinite(p_revoked_at) or p_revoked_at>now()+interval '5 minutes')) then
  raise exception 'Invalid verified membership facts';
 end if;
 event_facts=jsonb_build_object('user_id',p_user_id,'subscription_id',p_subscription_id,
  'event_at',p_event_at,'starts_at',p_starts_at,'ends_at',p_ends_at,'revoked_at',p_revoked_at);
 insert into public.raven_plus_memberships(user_id,provider,environment,subscription_id,starts_at,ends_at,revoked_at,last_event_at)
  values(p_user_id,p_provider,p_environment,p_subscription_id,p_starts_at,p_ends_at,p_revoked_at,p_event_at)
  on conflict(provider,environment,subscription_id) do nothing;
 get diagnostics inserted=row_count;
 select * into strict row from public.raven_plus_memberships
  where provider=p_provider and environment=p_environment and subscription_id=p_subscription_id for update;
 if row.user_id<>p_user_id then raise exception 'Purchase already belongs to a different account'; end if;
 insert into public.raven_plus_membership_events(provider,environment,event_id,membership_id,facts)
  values(p_provider,p_environment,p_event_id,row.id,event_facts) on conflict do nothing;
 if not found then
  select * into strict prior from public.raven_plus_membership_events where provider=p_provider and environment=p_environment and event_id=p_event_id;
  if prior.membership_id<>row.id or prior.facts<>event_facts then raise exception 'Conflicting purchase event'; end if;
  return 'duplicate';
 end if;
 if inserted=0 and p_event_at<row.last_event_at then return 'stale'; end if;
 if inserted=0 and p_event_at=row.last_event_at and
  (row.starts_at<>p_starts_at or row.ends_at<>p_ends_at or row.revoked_at is distinct from p_revoked_at) then
  raise exception 'Conflicting purchase event time';
 end if;
 update public.raven_plus_memberships set starts_at=p_starts_at,ends_at=p_ends_at,revoked_at=p_revoked_at,
  last_event_at=p_event_at,updated_at=now() where id=row.id;
 return 'applied';
end $$;

create or replace function public.raven_plus_is_linked(p_trip jsonb,p_email text) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
declare members jsonb;
begin
 if nullif(btrim(p_email),'') is null then return false; end if;
 if lower(btrim(p_trip->>'creator_email'))=lower(btrim(p_email)) then return true; end if;
 members=p_trip->'member_emails';
 if jsonb_typeof(members)='string' then members=(members#>>'{}')::jsonb; end if;
 if jsonb_typeof(members)<>'array' then return false; end if;
 return exists(select 1 from jsonb_array_elements_text(members) x where lower(btrim(x))=lower(btrim(p_email)));
exception when invalid_text_representation then return false;
end $$;

create or replace function public.raven_plus_account_snapshot(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare email_address text; grants jsonb; hosted jsonb; sponsored jsonb;
begin
 select email into email_address from auth.users where id=p_user_id and email_confirmed_at is not null;
 if nullif(btrim(email_address),'') is null then raise exception 'Confirmed account required'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'provider',m.provider,'environment',m.environment,
  'starts_at',m.starts_at,'ends_at',m.ends_at,'revoked_at',m.revoked_at)),'[]') into grants
  from public.raven_plus_memberships m where m.user_id=p_user_id and m.ends_at>now() and m.revoked_at is null;
 -- Small trip metadata only. Never load receipt images, people, balances or media.
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'status',j->'status','trip_date',j->'trip_date','end_date',j->'end_date',
  'total',j->'total','receipt_count',j->'receipt_count')),'[]') into hosted
  from public.trips t cross join lateral (select jsonb_build_object('status',t.status,'trip_date',t.trip_date,'end_date',t.end_date,'total',t.total,'receipt_count',t.receipt_count) j) meta where lower(btrim(t.creator_email))=lower(btrim(email_address));
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'status',j->'status','trip_date',j->'trip_date','end_date',j->'end_date',
  'total',j->'total','receipt_count',j->'receipt_count')),'[]') into sponsored
  from public.raven_plus_trip_sponsors s join public.trips t on t.id=s.trip_id
  cross join lateral (select jsonb_build_object('creator_email',t.creator_email,'member_emails',t.member_emails,'status',t.status,'trip_date',t.trip_date,'end_date',t.end_date,'total',t.total,'receipt_count',t.receipt_count) j) meta where s.user_id=p_user_id and public.raven_plus_is_linked(j,email_address);
 return jsonb_build_object('grants',grants,'hosted_trips',hosted,'sponsored_trips',sponsored);
end $$;

create or replace function public.raven_plus_trip_snapshot(p_trip_id text,p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare email_address text; trip jsonb; sponsors jsonb;
begin
 select email into email_address from auth.users where id=p_user_id and email_confirmed_at is not null;
 select jsonb_build_object('id',t.id,'creator_email',t.creator_email,'member_emails',t.member_emails,
  'status',t.status,'trip_date',t.trip_date,'end_date',t.end_date,'total',t.total,'receipt_count',t.receipt_count)
  into trip from public.trips t where t.id=p_trip_id;
 if trip is null or not public.raven_plus_is_linked(trip,email_address) then return null; end if;
 select coalesce(jsonb_agg(jsonb_build_object('user_id',s.user_id,'linked',true,'grants',(
  select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'provider',m.provider,'environment',m.environment,
   'starts_at',m.starts_at,'ends_at',m.ends_at,'revoked_at',m.revoked_at)),'[]')
  from public.raven_plus_memberships m where m.user_id=s.user_id and m.ends_at>now() and m.revoked_at is null
 ))),'[]') into sponsors from public.raven_plus_trip_sponsors s join auth.users u on u.id=s.user_id
  where s.trip_id=p_trip_id and u.email_confirmed_at is not null and public.raven_plus_is_linked(trip,u.email);
 return jsonb_build_object('trip',trip-'creator_email'-'member_emails','sponsors',sponsors);
end $$;

revoke all on function public.raven_plus_record_verified_membership(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz),
 public.raven_plus_account_snapshot(uuid),public.raven_plus_trip_snapshot(text,uuid),public.raven_plus_is_linked(jsonb,text) from public,anon,authenticated;
grant execute on function public.raven_plus_record_verified_membership(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz),
 public.raven_plus_account_snapshot(uuid),public.raven_plus_trip_snapshot(text,uuid),public.raven_plus_is_linked(jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
