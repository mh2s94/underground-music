-- Harden the authenticated VPS AI publisher.
-- Daily limit is enforced atomically in the database (UTC day) to avoid concurrent requests
-- exceeding the configured cap. Failed claims can be retried without weakening uniqueness.

create or replace function public.ug_claim_ai_publish(
  p_title text,
  p_title_key text,
  p_source_url text,
  p_band text,
  p_release text,
  p_genre text,
  p_article_type text,
  p_score numeric,
  p_mode text,
  p_daily_limit integer
)
returns table(ingestion_id uuid, outcome text, daily_count integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_existing public.ai_ingestion%rowtype;
  v_has_existing boolean := false;
  v_ingestion_id uuid;
  v_outcome text;
  v_count integer := 0;
  v_now timestamptz := now();
  v_day_start timestamptz := date_trunc('day', timezone('UTC', v_now)) at time zone 'UTC';
begin
  if p_daily_limit is null or p_daily_limit < 1 or p_daily_limit > 1000 then
    raise exception 'p_daily_limit must be between 1 and 1000';
  end if;

  -- Serialize claims so two simultaneous VPS requests cannot both pass the quota check.
  perform pg_advisory_xact_lock(hashtext('underground:ai-publish:daily-limit'));

  select i.* into v_existing
  from public.ai_ingestion i
  where i.source_url = p_source_url or i.title_key = p_title_key
  order by i.created_at desc
  limit 1
  for update;

  v_has_existing := found;

  if v_has_existing then
    if v_existing.status = 'processed' then
      return query select v_existing.id, 'duplicate'::text, 0;
      return;
    end if;

    if v_existing.article_id is not null then
      update public.ai_ingestion
      set status = 'processed', processed_at = coalesce(processed_at, v_now),
          updated_at = v_now, last_error = null
      where id = v_existing.id;
      return query select v_existing.id, 'already_saved'::text, 0;
      return;
    end if;

    if v_existing.status = 'processing' and v_existing.updated_at > v_now - interval '15 minutes' then
      return query select v_existing.id, 'in_progress'::text, 0;
      return;
    end if;
  end if;

  if lower(coalesce(p_mode, 'draft')) = 'published' then
    select count(distinct i.id)::integer into v_count
    from public.ai_ingestion i
    where exists (
      select 1 from public.articles a
      where a.status = 'published'
        and a.published_at >= v_day_start
        and (a.id = i.article_id or (i.article_id is null and a.title = i.title))
    );
    if v_count >= p_daily_limit then
      return query select coalesce(v_existing.id, null::uuid), 'daily_limit'::text, v_count;
      return;
    end if;
  end if;

  if v_has_existing then
    update public.ai_ingestion
    set title = p_title, title_key = p_title_key, source_url = p_source_url,
        status = 'processing', article_id = null, band = p_band, release = p_release,
        genre = p_genre, article_type = p_article_type, score = p_score,
        last_error = null, updated_at = v_now, processed_at = null
    where id = v_existing.id
    returning id into v_ingestion_id;
    v_outcome := 'retry';
  else
    insert into public.ai_ingestion (
      title, title_key, source_url, status, band, release, genre, article_type, score,
      created_at, updated_at
    ) values (
      p_title, p_title_key, p_source_url, 'processing', p_band, p_release, p_genre, p_article_type, p_score,
      v_now, v_now
    )
    returning id into v_ingestion_id;
    v_outcome := 'claimed';
  end if;

  return query select v_ingestion_id, v_outcome, v_count;
end;
$function$;

revoke all on function public.ug_claim_ai_publish(text,text,text,text,text,text,text,numeric,text,integer) from public, anon, authenticated;
grant execute on function public.ug_claim_ai_publish(text,text,text,text,text,text,text,numeric,text,integer) to service_role;
