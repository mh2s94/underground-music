# Automatic RSS news publisher

## Scope

The publisher stores short English news briefs from the public RSS/Atom data already exposed by Scene Radar. It does not call an AI provider, translate text, fetch or scrape the original article page, or reuse arbitrary RSS images. The source publication remains the authoritative report; each brief links directly to it.

Scene Radar extracts direct YouTube video URLs present inside each RSS item (including `watch`, `youtu.be`, `embed`, `shorts`, and `live` URL forms). It validates the 11-character video ID and passes it to the publisher. The publisher appends a standalone YouTube URL to the article content, which the existing article reader renders as an embedded player, and sets the matching YouTube thumbnail. It does not infer videos from headlines or open source article pages to search for a video. If an RSS item has no direct YouTube URL, the article is published without a video and without a cover image.

Each raw RSS brief uses `kind = 'News'`, `status = 'draft'`, `author_id = null`, and `published_at = null`. Drafts are excluded from public article listings, article routes, and `sitemap.xml` until published separately. The source's publication timestamp is preserved separately in `news_ingestion.source_published_at` and printed in the attribution.

## Editorial eligibility

An RSS item is saved as a draft only when all checks pass:

- Title is 12–180 characters.
- Source name is present.
- Link is HTTPS, has no embedded credentials, and is canonicalized by removing fragments and common tracking parameters.
- Source publication date parses, is not more than five minutes in the future, and is no older than 48 hours.
- RSS summary contains at least 20 words and passes a conservative English-language heuristic. Scene Radar currently truncates summaries to at most 45 words; the publisher does not invent missing context.
- At least one of the current Scene Radar genre tags matches.
- The existing non-news filter excludes podcasts, roundups, giveaways, deals, polls and similar items.

A brief contains the RSS summary, source name/date, and an explicit link to the original report. It is not represented as a full article or independent reporting.

## Limits and schedule

- GitHub Actions runs every 30 minutes.
- Maximum 3 successful draft saves per invocation.
- Maximum 10 publisher-tracked drafts per UTC calendar day.
- GitHub Actions concurrency prevents overlapping scheduled runs.
- A failed item can be retried after 20 minutes; successful and already-claimed items are not duplicated.
- The manual workflow-dispatch trigger uses the same limits and production endpoint.

The 10/day cap is enforced against draft and published records in the publisher tracking table. Do not run multiple independent publisher clients in parallel.

## Database

The production database has `public.news_ingestion`, with a unique source hash and URL, state, attempt count, source metadata, article reference and publication timestamps. RLS is enabled and grants are revoked from `anon` and `authenticated`; only the server-side service key can use it.

Do not use `telegram_radar` for this state. That table tracks which digest headlines have been sent, which is a separate concern.

## Required secrets and activation

The endpoint is disabled unless `NEWS_PUBLISH_TOKEN` is set.

1. Generate a high-entropy random token locally, for example with `openssl rand -hex 32`. Do not paste it into chat or commit it.
2. Add the same value as a **secret** named `NEWS_PUBLISH_TOKEN` in Cloudflare Pages → `underground-music` → Settings → Variables and Secrets → Production.
3. Add the same value as a GitHub Actions repository secret named `NEWS_PUBLISH_TOKEN`.
4. After changes are merged, Cloudflare Pages redeploys the Pages Function.
5. Inspect the next scheduled run or run **RSS news publisher** from GitHub Actions and inspect its JSON summary and Telegram notification.

If the GitHub secret is absent, the scheduled workflow exits without calling the endpoint. If the Cloudflare secret is absent or mismatched, the endpoint returns 401. If the table is missing, it returns 503 and publishes nothing.

The existing Telegram digest remains separate and information-only. After a new draft is saved, the publisher sends the editor a Telegram notification when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are configured. A Telegram notification failure does not unpublish the article.

## Rollback

Disable the GitHub Actions workflow or remove its `NEWS_PUBLISH_TOKEN` secret to stop scheduled publishing. Do not delete `news_ingestion`; it is the idempotency record and audit trail. Existing articles already published by the previous behavior remain published and must be unpublished manually by an editor if necessary. New RSS briefs are drafts.

## Verification

The PR includes static safety tests for the token gate, volume and age limits, RSS YouTube URL extraction, video ID validation, no-AI constraint, no arbitrary RSS image reuse, and database RLS. The standard Preview check must pass. A real production run should be inspected after merge.
