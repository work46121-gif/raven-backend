-- Approved scope: raise only private album videos to 50 MiB. No media row changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.raven_trip_album drop constraint if exists raven_trip_album_check;
alter table public.raven_trip_album drop constraint if exists raven_trip_album_media_size_check;
alter table public.raven_trip_album add constraint raven_trip_album_media_size_check
 check((kind='photo' and mime_type in ('image/jpeg','image/png','image/webp') and byte_size between 1 and 6291456)
    or (kind='video' and mime_type in ('video/mp4','video/quicktime','video/webm') and byte_size between 1 and 52428800));
update storage.buckets set file_size_limit=52428800 where id='raven-trip-album';
notify pgrst,'reload schema';
commit;
