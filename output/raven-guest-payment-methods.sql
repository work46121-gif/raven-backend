-- Additive guest contact storage; no changes to bills, balances, or accounts.
begin;
create table if not exists public.bill_guest_payment_methods (
  participant_id bigint primary key references public.participants(id) on delete cascade,
  bill_id text not null references public.bills(id) on delete cascade,
  guest_identity text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  venmo text not null default '',
  cashapp text not null default '',
  applepay text not null default '',
  updated_at timestamptz not null default now(),
  constraint guest_methods_identity check (guest_identity like 'unknown\_%' escape '\' or guest_identity like 'guest:%'),
  constraint guest_methods_venmo check (venmo = '' or venmo ~ '^[A-Za-z0-9_-]{1,30}$'),
  constraint guest_methods_cashapp check (cashapp = '' or (cashapp ~ '^[A-Za-z0-9]{1,20}$' and cashapp ~ '[A-Za-z]')),
  constraint guest_methods_applepay check (applepay = '' or applepay ~ '^\+?[0-9]{7,15}$')
);
create index if not exists bill_guest_methods_bill_idx on public.bill_guest_payment_methods(bill_id);
alter table public.bill_guest_payment_methods enable row level security;
revoke all on public.bill_guest_payment_methods from public, anon, authenticated;
grant select, insert, update, delete on public.bill_guest_payment_methods to service_role;

create or replace function public.raven_save_guest_payment_methods(
  p_bill_id text, p_actor_id uuid, p_creator_email text, p_entries jsonb
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bills%rowtype; p public.participants%rowtype; entry jsonb; seen bigint[] := '{}';
begin
  select * into b from public.bills where id=p_bill_id for update;
  if b.id is null or b.status='deleted' or p_actor_id is null
     or coalesce(lower(b.creator_phone),'')<>coalesce(lower(p_creator_email),'')
     or not exists (select 1 from auth.users where id=p_actor_id and lower(email)=lower(p_creator_email)) then
    raise exception 'Bill owner changed';
  end if;
  if jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 1 and 50 then raise exception 'Invalid guest list'; end if;
  for entry in select value from jsonb_array_elements(p_entries) loop
    select * into p from public.participants where id=(entry->>'participant_id')::bigint and bill_id=p_bill_id for update;
    if p.id is null or p.id=any(seen) or left(trim(p.name),1)='@'
       or p.phone is distinct from entry->>'guest_identity'
       or not (p.phone like 'unknown\_%' escape '\' or p.phone like 'guest:%') then
      raise exception 'Guest assignment changed';
    end if;
    seen:=array_append(seen,p.id);
    insert into public.bill_guest_payment_methods(participant_id,bill_id,guest_identity,created_by,venmo,cashapp,applepay)
    values(p.id,p_bill_id,p.phone,p_actor_id,coalesce(entry->>'venmo',''),coalesce(entry->>'cashapp',''),coalesce(entry->>'applepay',''))
    on conflict(participant_id) do update set bill_id=excluded.bill_id,guest_identity=excluded.guest_identity,
      created_by=excluded.created_by,venmo=excluded.venmo,cashapp=excluded.cashapp,applepay=excluded.applepay,updated_at=now();
  end loop;
  return true;
end; $$;
revoke all on function public.raven_save_guest_payment_methods(text,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.raven_save_guest_payment_methods(text,uuid,text,jsonb) to service_role;
commit;
