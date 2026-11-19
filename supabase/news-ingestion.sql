-- Automatic RSS news publication tracking.
-- Service-role only: RLS is enabled and no client policies or grants are created.
create table if not exists public.news_ingestion (
  source_hash text primary key,
  source_url text not null unique,
  title text not null,
  source text not null,
  source_published_at timestamptz not null,
  status text not null default 'processing'
    check (status in ('processing', 'published', 'failed', 'skipped')),
  article_id uuid references public.articles(id) on delete set null,
  attempts integer not null default 1 check (attempts >= 1),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  telegram_notified_at timestamptz
);

create index if not exists news_ingestion_published_at_idx
  on public.news_ingestion (published_at desc) where status = 'published';

alter table public.news_ingestion enable row level security;
revoke all on public.news_ingestion from anon, authenticated;
