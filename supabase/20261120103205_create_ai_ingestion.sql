-- AI auto-publisher idempotency and audit trail.
-- Service-role only; apply after the base public.articles table exists.
create table if not exists public.ai_ingestion (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  title_key text not null,
  source_url text not null,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed')),
  article_id uuid references public.articles(id) on delete set null,
  band text,
  release text,
  genre text,
  article_type text,
  score numeric(3,1) check (score is null or score between 0 and 10),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);

create unique index if not exists ai_ingestion_source_url_uidx
  on public.ai_ingestion (source_url);
create unique index if not exists ai_ingestion_title_key_uidx
  on public.ai_ingestion (title_key);
create index if not exists ai_ingestion_created_at_idx
  on public.ai_ingestion (created_at desc);

alter table public.ai_ingestion enable row level security;
revoke all on table public.ai_ingestion from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_ingestion to service_role;
