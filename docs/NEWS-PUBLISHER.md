# Automatic RSS news publisher

## Scope

The publisher creates short English news briefs from the public RSS/Atom data already exposed by Scene Radar. It does not call an AI provider, translate text, fetch or scrape the original article page, or republish feed images. The source publication remains the authoritative report; each brief links directly to it.

Each article uses `kind = 'News'`, `status = 'published'`, `author_id = null`, and the actual site publication time in `published_at`. The source's publication timestamp is preserved separately in `news_ingestion.source_published_at` and printed in the attribution. No cover image is assigned until image rights are verified.

## Editorial eligibility

An RSS item is published only when all checks pass:

- Title is 12–180 characters.
- Source name is present.
- Link is HTTPS, has no embedded credentials, and is canonicalized by removing fragments and common tracking parameters.
- Source publication date parses, is not more than five minutes in the future, and is no older than 48 hours.
- RSS summary contains at least 20 words. Scene Radar currently truncates summaries to at most 45 words; the publisher does not invent missing context.
- At least one of the current Scene Radar genre tags matches.
- The existing non-news filter excludes podcasts, roundups, giveaways, deals, polls and similar items.

A brief contains the RSS summary, source name/date, and an explicit link to the original report. It is not represented as a full article or independent reporting.

## Limits and schedule

- GitHub Actions runs every 30 minutes.
- Maximum 3 successful publications per invocation.
- Maximum 10 publisher-tracked publications per UTC calendar day.
- GitHub Actions concurrency prevents overlapping scheduled runs.
- A failed item can be retried after 20 minutes; successful and already-claimed items are not duplicated.
- The manual workflow-dispatch trigger uses the same limits and production endpoint.

The 10/day cap is enforced against the publisher tracking table. Do not run multiple independent publisher clients in parallel.

## Database

Apply `supabase/news-ingestion.sql` to the production Supabase project only after the PR is reviewed and approved for release. It creates `public.news_ingestion`, with a unique source hash and URL, state, attempt count, source metadata, article reference and publication timestamps. RLS is enabled and grants are revoked from `anon` and `authenticated`; only the server-side service key can use it.

Do not use `telegram_radar` for this state. That table tracks which digest headlines have been sent, which is a separate concern.

## Required secrets and activation

The endpoint is disabled unless `NEWS_PUBLISH_TOKEN` is set.

1. Generate a high-entropy random token locally, for example with `openssl rand -hex 32`. Do not paste it into chat or commit it.
2. Add the same value as a **secret** named `NEWS_PUBLISH_TOKEN` in Cloudflare Pages → `underground-music` → Settings → Variables and Secrets → Production.
3. Add the same value as a GitHub Actions repository secret named `NEWS_PUBLISH_TOKEN`.
4. After the SQL migration is applied and the PR is merged, redeploy Cloudflare Pages so the Pages Function receives the secret.
5. Run **RSS news publisher** once with GitHub Actions → Run workflow and inspect its JSON summary and Telegram notification.

If the GitHub secret is absent, the scheduled workflow exits without calling the endpoint. If the Cloudflare secret is absent or mismatched, the endpoint returns 401. If the table is missing, it returns 503 and publishes nothing.

The existing Telegram digest remains separate and information-only. After a new article is published, the publisher sends the editor a Telegram notification when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are configured. A Telegram notification failure does not unpublish the article.

## Rollback

Disable the GitHub Actions workflow or remove its `NEWS_PUBLISH_TOKEN` secret to stop scheduled publishing. Do not delete `news_ingestion`; it is the idempotency record and audit trail. Existing articles remain published and must be unpublished manually by an editor if necessary.

## Verification

The PR adds static safety tests for the token gate, volume and age limits, summary/genre filters, no-AI constraint, no RSS image reuse, and database RLS. The standard Preview check must pass. A real production run is intentionally deferred until the owner applies the SQL migration and configures both secrets after approving the PR.
