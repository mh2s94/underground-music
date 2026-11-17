-- Telegram bot: headlines the bot has sent to the editor (run once in Supabase → SQL Editor).
-- Only the server (service key) uses this table: RLS is on and there are no policies,
-- so visitors and signed-in users cannot read or write it.
create table if not exists public.telegram_radar (
  hash        text primary key,               -- short hash of the source link
  link        text not null,
  title       text not null,
  item        jsonb not null default '{}'::jsonb, -- headline, source, summary, date, image, band, genres
  status      text not null default 'sent' check (status in ('sent', 'writing', 'drafted', 'skipped')),
  article_id  text,                            -- the draft written from it
  sent_at     timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.telegram_radar enable row level security;
revoke all on public.telegram_radar from anon, authenticated;
