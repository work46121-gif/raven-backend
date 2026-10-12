begin;
set local lock_timeout='5s';
create table if not exists public.raven_newsletter_prompts(user_id uuid primary key references auth.users(id) on delete cascade,next_prompt_at timestamptz not null);
alter table public.raven_newsletter_prompts enable row level security;
revoke all on public.raven_newsletter_prompts from anon,authenticated;
grant all on public.raven_newsletter_prompts to service_role;
create or replace function public.raven_claim_newsletter_prompt(p_user uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare claimed uuid;
begin
 if exists(select 1 from public.raven_newsletter_subscribers s join auth.users u on u.id=s.user_id
  where s.user_id=p_user and s.enabled and s.email=lower(u.email)) then return false;end if;
 insert into public.raven_newsletter_prompts(user_id,next_prompt_at) values(p_user,now()+interval '1 month')
 on conflict(user_id) do update set next_prompt_at=now()+interval '1 month'
 where raven_newsletter_prompts.next_prompt_at<=now() returning user_id into claimed;
 return claimed is not null;
end $$;
revoke all on function public.raven_claim_newsletter_prompt(uuid) from public,anon,authenticated;
grant execute on function public.raven_claim_newsletter_prompt(uuid) to service_role;
commit;
