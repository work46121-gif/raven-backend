-- New private storage only. Does not change existing trip/receipt permissions.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table if not exists public.raven_trip_album (
 id uuid primary key default gen_random_uuid(),
 trip_id text not null references public.trips(id) on delete cascade,
 uploader_id uuid not null references auth.users(id),
 kind text not null check(kind in ('photo','video')),
 caption text not null default '' check(char_length(caption)<=160),
 object_path text not null unique,
 mime_type text not null,
 byte_size integer not null,
 created_at timestamptz not null default now(),
 check((kind='photo' and mime_type in ('image/jpeg','image/png','image/webp') and byte_size between 1 and 6291456)
    or (kind='video' and mime_type in ('video/mp4','video/quicktime','video/webm') and byte_size between 1 and 12582912))
);
create index if not exists raven_trip_album_page on public.raven_trip_album(trip_id,created_at desc,id desc);
create index if not exists raven_trip_album_uploader on public.raven_trip_album(uploader_id);
alter table public.raven_trip_album enable row level security;
revoke all on public.raven_trip_album from public,anon,authenticated;
grant all on public.raven_trip_album to service_role;
-- Keep a durable object-cleanup queue even when a whole trip is deleted.
create table if not exists public.raven_trip_album_cleanup (
 object_path text primary key,
 created_at timestamptz not null default now()
);
alter table public.raven_trip_album_cleanup enable row level security;
revoke all on public.raven_trip_album_cleanup from public,anon,authenticated;
grant all on public.raven_trip_album_cleanup to service_role;
create or replace function public.raven_queue_album_cleanup() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.raven_trip_album_cleanup(object_path) values(old.object_path) on conflict do nothing;
 return old;
end $$;
revoke all on function public.raven_queue_album_cleanup() from public,anon,authenticated;
create or replace trigger raven_trip_album_cleanup_deleted after delete on public.raven_trip_album
for each row execute function public.raven_queue_album_cleanup();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('raven-trip-album','raven-trip-album',false,12582912,array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- Existing broad Storage policies must not accidentally expose this new bucket.
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='raven_trip_album_service_only') then
  create policy raven_trip_album_service_only on storage.objects as restrictive for all to anon,authenticated
   using(bucket_id<>'raven-trip-album') with check(bucket_id<>'raven-trip-album');
 end if;
end $$;
notify pgrst,'reload schema';
commit;
