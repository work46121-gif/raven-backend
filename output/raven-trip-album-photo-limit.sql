-- Raise only private trip-album photos to 50 MiB. Videos stay at 50 MiB.
-- No media rows, bucket visibility, access policies or account data change.
-- Apply after raven-trip-album-video-limit.sql; safe to repeat.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.raven_trip_album drop constraint if exists raven_trip_album_media_size_check;
alter table public.raven_trip_album add constraint raven_trip_album_media_size_check
 check((kind='photo' and mime_type in ('image/jpeg','image/png','image/webp') and byte_size between 1 and 52428800)
    or (kind='video' and mime_type in ('video/mp4','video/quicktime','video/webm') and byte_size between 1 and 52428800));
notify pgrst,'reload schema';
commit;
