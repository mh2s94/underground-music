-- Add optional media metadata for VPS AI-published articles.
-- Apply after the base public.articles table exists; deploy the endpoint after this migration.
alter table public.articles
  add column if not exists youtube_video_id text;

alter table public.articles
  drop constraint if exists articles_youtube_video_id_check;

alter table public.articles
  add constraint articles_youtube_video_id_check
  check (youtube_video_id is null or youtube_video_id ~ '^[A-Za-z0-9_-]{11}$');
