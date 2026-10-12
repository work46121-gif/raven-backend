begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.profiles add column if not exists privacy_email_marketing boolean default false;
create table if not exists public.raven_newsletter_subscribers (
 user_id uuid primary key references auth.users(id) on delete cascade,
 email text not null unique check(email=lower(email)),
 enabled boolean not null default false,
 consent_source text not null,
 consent_at timestamptz,
 updated_at timestamptz not null default now()
);
create table if not exists public.raven_newsletter_campaigns (
 id text primary key,
 feature text not null,
 status text not null default 'draft' check(status in ('draft','queued','complete','paused')),
 scheduled_at timestamptz not null,
 created_at timestamptz not null default now()
);
create table if not exists public.raven_newsletter_deliveries (
 campaign_id text references public.raven_newsletter_campaigns(id) on delete cascade,
 user_id uuid references auth.users(id) on delete cascade,
 email text not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','skipped')),
 provider_id text,
 attempted_at timestamptz,
 sent_at timestamptz,
 primary key(campaign_id,user_id),
 unique(campaign_id,email)
);
alter table public.raven_newsletter_subscribers enable row level security;
alter table public.raven_newsletter_campaigns enable row level security;
alter table public.raven_newsletter_deliveries enable row level security;
revoke all on public.raven_newsletter_subscribers,public.raven_newsletter_campaigns,public.raven_newsletter_deliveries from anon,authenticated;
grant all on public.raven_newsletter_subscribers,public.raven_newsletter_campaigns,public.raven_newsletter_deliveries to service_role;
-- Import only a recorded, explicit true preference; never enroll all users.
insert into public.raven_newsletter_subscribers(user_id,email,enabled,consent_source,consent_at)
 select u.id,lower(u.email),true,'existing_email_updates',coalesce(p.updated_at,now())
 from auth.users u join public.profiles p on p.id=u.id
 where p.privacy_email_marketing is true and u.email_confirmed_at is not null and u.email is not null
 on conflict do nothing;
-- Old installed clients must still be able to opt out through their existing switch.
create or replace function public.raven_newsletter_legacy_optout() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.privacy_email_marketing is false then
  update public.raven_newsletter_subscribers set enabled=false,updated_at=now() where user_id=new.id;
 end if;
 return new;
end $$;
drop trigger if exists raven_newsletter_legacy_optout on public.profiles;
create trigger raven_newsletter_legacy_optout after update of privacy_email_marketing on public.profiles
 for each row execute function public.raven_newsletter_legacy_optout();
create or replace function public.raven_newsletter_claim() returns setof public.raven_newsletter_deliveries
language plpgsql security definer set search_path=public,pg_temp as $$
declare campaign public.raven_newsletter_campaigns;
begin
 select * into campaign from public.raven_newsletter_campaigns
 where status='queued' and scheduled_at<=now() order by scheduled_at limit 1 for update skip locked;
 if not found then return; end if;
 insert into public.raven_newsletter_deliveries(campaign_id,user_id,email)
 select campaign.id,s.user_id,s.email from public.raven_newsletter_subscribers s
 join auth.users u on u.id=s.user_id
 where s.enabled and u.email_confirmed_at is not null and lower(u.email)=s.email
 on conflict do nothing;
 return query
 update public.raven_newsletter_deliveries d set status='sending',attempted_at=now()
 where (d.campaign_id,d.user_id) in (
  select x.campaign_id,x.user_id from public.raven_newsletter_deliveries x
  where x.campaign_id=campaign.id and x.status='pending' limit 20 for update skip locked
 ) returning d.*;
 -- A campaign is closed once its initial audience is claimed; later opt-ins get the next issue.
 if not exists(select 1 from public.raven_newsletter_deliveries where campaign_id=campaign.id and status='pending') then
  update public.raven_newsletter_campaigns set status='complete' where id=campaign.id;
 end if;
end $$;
revoke all on function public.raven_newsletter_claim() from public,anon,authenticated;
revoke all on function public.raven_newsletter_legacy_optout() from public,anon,authenticated;
grant execute on function public.raven_newsletter_claim() to service_role;
insert into public.raven_newsletter_campaigns(id,feature,scheduled_at)
 values('2026-10-12-adjustable-shares','adjustable-shares','2026-10-12 10:00 America/New_York') on conflict do nothing;
commit;
