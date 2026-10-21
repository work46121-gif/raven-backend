-- Private weekly scheduler. Installs PAUSED; activation is a separate approved step.
-- No changes to subscriptions, past campaigns, receipts, payments or existing sends.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table if not exists public.raven_newsletter_schedule (
 id text primary key check(id='weekly'), enabled boolean not null default false, rotation_enabled boolean not null default false,
 next_run_at timestamptz not null, next_claim_at timestamptz,
 last_checked_at timestamptz, last_error text
);
create table if not exists public.raven_newsletter_weekly_runs (
 id date primary key, scheduled_at timestamptz not null, content jsonb not null,
 status text not null check(status in ('queued','complete','needs_attention')),
 note text, created_at timestamptz not null default now()
);
create table if not exists public.raven_newsletter_weekly_deliveries (
 run_id date references public.raven_newsletter_weekly_runs(id) on delete cascade,
 user_id uuid references auth.users(id) on delete cascade, email text not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','skipped')),
 attempts integer not null default 0, lease uuid, lease_until timestamptz,
 first_attempt_at timestamptz, next_attempt_at timestamptz not null default now(),
 request_payload jsonb, provider_id text, sent_at timestamptz, last_error text,
 primary key(run_id,user_id), unique(run_id,email)
);
create index if not exists raven_newsletter_weekly_pending on public.raven_newsletter_weekly_deliveries(next_attempt_at) where status in ('pending','sending');
alter table public.raven_newsletter_schedule enable row level security;
alter table public.raven_newsletter_weekly_runs enable row level security;
alter table public.raven_newsletter_weekly_deliveries enable row level security;
revoke all on public.raven_newsletter_schedule,public.raven_newsletter_weekly_runs,public.raven_newsletter_weekly_deliveries from public,anon,authenticated;
grant all on public.raven_newsletter_schedule,public.raven_newsletter_weekly_runs,public.raven_newsletter_weekly_deliveries to service_role;

-- Strictly the next Monday at 10:00 in New York; calendar arithmetic handles DST.
create or replace function public.raven_newsletter_next_monday(p_after timestamptz) returns timestamptz
language sql stable set search_path=public,pg_temp as $$
 select case when due>p_after then due else ((due at time zone 'America/New_York')+interval '7 days') at time zone 'America/New_York' end
 from (select (date_trunc('week',p_after at time zone 'America/New_York')+interval '10 hours') at time zone 'America/New_York' due) s;
$$;
insert into public.raven_newsletter_schedule(id,next_run_at) values('weekly',public.raven_newsletter_next_monday(now())) on conflict do nothing;

create or replace function public.raven_newsletter_weekly_sync(p_content jsonb,p_now timestamptz default now()) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.raven_newsletter_schedule; due timestamptz; latest_due timestamptz; issue jsonb; n integer; run_day date;
begin
 select * into s from public.raven_newsletter_schedule where id='weekly' for update;
 update public.raven_newsletter_schedule set last_checked_at=p_now where id='weekly';
 if not s.enabled or s.next_run_at>p_now then return; end if;
 due:=s.next_run_at;
 latest_due:=(date_trunc('week',p_now at time zone 'America/New_York')+interval '10 hours') at time zone 'America/New_York';
 if latest_due>p_now then latest_due:=((latest_due at time zone 'America/New_York')-interval '7 days') at time zone 'America/New_York'; end if;
 if due<latest_due then
  insert into public.raven_newsletter_weekly_runs(id,scheduled_at,content,status,note)
  values((due at time zone 'America/New_York')::date,due,'{}','needs_attention','Missed send window during downtime; no backlog emailed.') on conflict do nothing;
  due:=latest_due;
 end if;
 if p_now>=due+interval '14 hours' then
  insert into public.raven_newsletter_weekly_runs(id,scheduled_at,content,status,note)
  values((due at time zone 'America/New_York')::date,due,'{}','needs_attention','Missed Monday send window; no late bulk mailing.') on conflict do nothing;
  update public.raven_newsletter_schedule set next_run_at=public.raven_newsletter_next_monday(p_now),last_error='missed_send_window' where id='weekly';return;
 end if;
 if jsonb_typeof(p_content)<>'array' or coalesce(jsonb_array_length(p_content),0)=0 then
  update public.raven_newsletter_schedule set last_error='no_approved_content' where id='weekly';return;
 end if;
 run_day:=(due at time zone 'America/New_York')::date;
 if s.rotation_enabled then
  n:=mod(greatest(0,(run_day-date '2026-10-26')/7),jsonb_array_length(p_content));issue:=p_content->n;
 else
  select candidate into issue from jsonb_array_elements(p_content) candidate
  where not exists(select 1 from public.raven_newsletter_weekly_runs r where r.content->>'id'=candidate->>'id') limit 1;
  if issue is null then update public.raven_newsletter_schedule set last_error='no_approved_content' where id='weekly';return; end if;
 end if;
 if coalesce(issue->>'id','')='' or coalesce(issue->>'subject','')='' or coalesce(issue->>'html','')='' or coalesce(issue->>'text','')='' then
  update public.raven_newsletter_schedule set last_error='invalid_content' where id='weekly';return;
 end if;
 insert into public.raven_newsletter_weekly_runs(id,scheduled_at,content,status) values(run_day,due,issue,'queued') on conflict do nothing;
 if found then
  -- Freeze the eligible audience once, not anew on each worker tick/restart.
  insert into public.raven_newsletter_weekly_deliveries(run_id,user_id,email,next_attempt_at)
  select run_day,sub.user_id,sub.email,p_now from public.raven_newsletter_subscribers sub
  join auth.users u on u.id=sub.user_id
  where sub.enabled and u.email_confirmed_at is not null and lower(u.email)=sub.email on conflict do nothing;
  if not exists(select 1 from public.raven_newsletter_weekly_deliveries where run_id=run_day) then
   update public.raven_newsletter_weekly_runs set status='complete',note='No eligible opted-in subscribers at send time.' where id=run_day;
  end if;
 end if;
 update public.raven_newsletter_schedule set next_run_at=public.raven_newsletter_next_monday(due),last_error=null where id='weekly';
end $$;

create or replace function public.raven_newsletter_weekly_claim(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.raven_newsletter_schedule; d public.raven_newsletter_weekly_deliveries; issue jsonb;
begin
 select * into s from public.raven_newsletter_schedule where id='weekly' for update;
 if not s.enabled then return null; end if;
 -- Expired/ambiguous attempts are never retried after the provider's 24h dedupe window.
 update public.raven_newsletter_weekly_deliveries x set status='failed',last_error='send_window_expired',lease=null,lease_until=null
 from public.raven_newsletter_weekly_runs r where r.id=x.run_id and x.status in ('pending','sending')
 and (p_now>=r.scheduled_at+interval '14 hours' or x.first_attempt_at<=p_now-interval '23 hours' or (x.attempts>=6 and x.status='sending' and x.lease_until<=p_now));
 update public.raven_newsletter_weekly_runs r set status=case when exists(select 1 from public.raven_newsletter_weekly_deliveries pending_row where pending_row.run_id=r.id and pending_row.status='failed') then 'needs_attention' else 'complete' end
 where r.status='queued' and not exists(select 1 from public.raven_newsletter_weekly_deliveries pending_row where pending_row.run_id=r.id and pending_row.status in ('pending','sending'));
 if s.next_claim_at>p_now then return null; end if;
 select x.* into d from public.raven_newsletter_weekly_deliveries x join public.raven_newsletter_weekly_runs r on r.id=x.run_id
 where r.status='queued' and r.scheduled_at<=p_now and x.attempts<6
 and ((x.status='pending' and x.next_attempt_at<=p_now) or (x.status='sending' and x.lease_until<=p_now))
 order by x.run_id,x.user_id limit 1 for update of x skip locked;
 if not found then return null; end if;
 update public.raven_newsletter_weekly_deliveries set status='sending',attempts=attempts+1,lease=gen_random_uuid(),lease_until=p_now+interval '5 minutes',first_attempt_at=coalesce(first_attempt_at,p_now)
 where run_id=d.run_id and user_id=d.user_id returning * into d;
 update public.raven_newsletter_schedule set next_claim_at=p_now+interval '1 second' where id='weekly';
 select content into issue from public.raven_newsletter_weekly_runs where id=d.run_id;
 return to_jsonb(d)||jsonb_build_object('content',issue);
end $$;

create or replace function public.raven_newsletter_weekly_allowed(p_run date,p_user uuid,p_lease uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.raven_newsletter_weekly_deliveries d
 join public.raven_newsletter_weekly_runs r on r.id=d.run_id
 join public.raven_newsletter_subscribers s on s.user_id=d.user_id
 join auth.users u on u.id=d.user_id
 where d.run_id=p_run and d.user_id=p_user and d.lease=p_lease and d.status='sending' and d.lease_until>now()
 and s.enabled and s.email=d.email and lower(u.email)=d.email and u.email_confirmed_at is not null
 and now()>=r.scheduled_at and now()<r.scheduled_at+interval '14 hours' and exists(select 1 from public.raven_newsletter_schedule where enabled));
$$;

create or replace function public.raven_newsletter_weekly_finish(p_run date,p_user uuid,p_lease uuid,p_outcome text,p_provider text default null,p_error text default null,p_retry_seconds integer default 60) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.raven_newsletter_weekly_deliveries;
begin
 if p_outcome not in ('sent','retry','failed','skipped') then raise exception 'Invalid delivery outcome'; end if;
 select * into d from public.raven_newsletter_weekly_deliveries where run_id=p_run and user_id=p_user and lease=p_lease and status='sending' for update;
 if not found then return false; end if;
 update public.raven_newsletter_weekly_deliveries set
 status=case when p_outcome='retry' and attempts<6 then 'pending' when p_outcome='retry' then 'failed' else p_outcome end,
 provider_id=case when p_outcome='sent' then left(p_provider,200) else provider_id end,
 sent_at=case when p_outcome='sent' then now() else sent_at end,
 last_error=left(p_error,80),lease=null,lease_until=null,
 next_attempt_at=now()+make_interval(secs=>greatest(60,least(3600,p_retry_seconds)))
 where run_id=p_run and user_id=p_user;
 return true;
end $$;

create or replace function public.raven_newsletter_weekly_status() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('schedule',(select to_jsonb(s)-'next_claim_at' from public.raven_newsletter_schedule s where id='weekly'),
 'eligible_subscribers',(select count(*) from public.raven_newsletter_subscribers s join auth.users u on u.id=s.user_id where s.enabled and u.email_confirmed_at is not null and lower(u.email)=s.email),
 'runs',coalesce((select jsonb_agg(to_jsonb(r)) from (
 select w.id,w.scheduled_at,w.status,w.note,w.content->>'subject' subject,
 count(d.user_id)::int audience,count(*) filter(where d.status='sent')::int accepted,
 count(*) filter(where d.status in ('pending','sending'))::int pending,
 count(*) filter(where d.status='failed')::int failed,count(*) filter(where d.status='skipped')::int skipped,
 array_remove(array_agg(distinct d.last_error),null) errors
 from public.raven_newsletter_weekly_runs w left join public.raven_newsletter_weekly_deliveries d on d.run_id=w.id
 group by w.id order by w.id desc limit 8) r),'[]'::jsonb));
$$;
revoke all on function public.raven_newsletter_next_monday(timestamptz),public.raven_newsletter_weekly_sync(jsonb,timestamptz),public.raven_newsletter_weekly_claim(timestamptz),public.raven_newsletter_weekly_allowed(date,uuid,uuid),public.raven_newsletter_weekly_finish(date,uuid,uuid,text,text,text,integer),public.raven_newsletter_weekly_status() from public,anon,authenticated;
grant execute on function public.raven_newsletter_next_monday(timestamptz),public.raven_newsletter_weekly_sync(jsonb,timestamptz),public.raven_newsletter_weekly_claim(timestamptz),public.raven_newsletter_weekly_allowed(date,uuid,uuid),public.raven_newsletter_weekly_finish(date,uuid,uuid,text,text,text,integer),public.raven_newsletter_weekly_status() to service_role;
notify pgrst,'reload schema';
commit;
