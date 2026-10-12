-- Add a shared activity category; preserve uploads and access restrictions.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.raven_trip_media drop constraint if exists raven_trip_media_kind_check;
alter table public.raven_trip_media drop constraint if exists raven_trip_media_check;
alter table public.raven_trip_media add constraint raven_trip_media_kind_check
 check (kind in ('stay','flight','vehicle','activity'));
alter table public.raven_trip_media add constraint raven_trip_media_check
 check ((kind in ('stay','vehicle','activity') and person_id is null)
     or (kind='flight' and person_id is not null));
commit;
