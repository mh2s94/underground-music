# VPS AI publisher

## Endpoint

The VPS auto-publisher sends a completed article to `POST /api/ai-publish`. The endpoint stores the supplied article; it does not generate or rewrite content.

Required header:

```http
Authorization: Bearer <AI_PUBLISH_TOKEN>
Content-Type: application/json
```

The body may be the article object directly or wrapped in an `article` property:

```json
{
  "BAND": "Band name",
  "RELEASE": "Release name",
  "TITLE": "A descriptive headline",
  "EXCERPT": "A concise summary.",
  "TAGS": ["metalcore", "new release"],
  "GENRE": "Metalcore",
  "TYPE": "News",
  "SCORE": null,
  "CONTENT": "350–500 words of Markdown, ending on its own final line with Source: [Official site](https://example.com/story)"
}
```

`BAND` and `RELEASE` may be empty when not applicable. `SCORE` is optional/null or a number from 0 to 10. `TYPE` must be `Review`, `News`, `Feature`, or `Interview`. `TAGS` is an array of up to 12 strings (40 characters each). The title is 12–180 characters; the excerpt is at most 500 characters. The Markdown content must contain 350–500 words and end with the exact standalone attribution form `Source: [site](https://source-link)`; no text may follow it.

## Duplicate prevention

Before inserting, the endpoint checks:

1. The 300 newest rows in `articles` for a normalized title match or a matching canonical URL in the final `Source:` attribution.
2. `news_ingestion` for the source URL or headline.
3. `ai_ingestion` for the source URL or normalized title.

Tracking claims also have unique indexes on `source_url` and `title_key`, which protect against simultaneous duplicate requests. A duplicate returns HTTP 409. Invalid input returns 400; missing/invalid token returns 401; unavailable database/configuration returns 503.

## Storage and publication mode

The endpoint inserts the article into `articles`, maps `BAND` → `band_name`, `RELEASE` → `album_name`, `TYPE` → `kind`, and stores tags, genre, score, excerpt and Markdown content. It records the claim and article id in `ai_ingestion`.

Cloudflare Pages Production variables:

| Variable | Purpose |
| --- | --- |
| `AI_PUBLISH_TOKEN` | Secret bearer token shared with the VPS; generate a unique high-entropy value |
| `AI_PUBLISH_MODE` | Optional: `draft` (default), `review`, or `published` |

The default is `draft`. Only set `published` when unattended public publication is explicitly intended. Never commit the token or paste it into logs/chat. Set the same token as a secret on the VPS. Rotate it in both environments if exposed.

## Telegram

When `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are configured, the endpoint sends a Telegram notification after the article is stored and the ingestion row is marked processed. Telegram failure is reported in the response and does not roll back the article.

## Database

Apply `supabase/20261120103205_create_ai_ingestion.sql` after the base `articles` table exists. The table has RLS enabled, no client policies, privileges revoked from `PUBLIC`, `anon`, and `authenticated`, and CRUD privileges granted only to `service_role`. The endpoint uses the existing server-side Supabase service-key helper. Never expose that key to the browser.

## Smoke test

Use a valid 350–500-word article with a test source URL and `AI_PUBLISH_MODE=draft`. Confirm HTTP 201, a draft in the admin article list, a matching `processed` row in `ai_ingestion`, and the Telegram notification. Submit the exact payload again; it must return HTTP 409 and create no second article.


## Publisher hardening

The endpoint now normalizes `GENRE` through the same official catalogue used by the admin generator (`functions/api/genres-data.js`). Values that cannot be mapped to an official genre are rejected; generic values such as `Metal` must be replaced with a supported specific genre.

Published-mode requests are subject to an atomic UTC-day quota. Configure `AI_PUBLISH_DAILY_LIMIT` in Cloudflare Pages environment variables (integer 1–1000); the default is `10`. The quota counts AI-publisher articles whose linked article row is actually `published`. Draft and review mode do not consume the published-article quota.

Apply `supabase/20261121120000_ai_publish_hardening.sql` after the original `ai_ingestion` migration. It adds the service-role-only `ug_claim_ai_publish` RPC, which serializes claims, enforces the daily quota, rejects completed duplicates, and reopens failed or stale claims for retry. Failed article inserts remain failed in the audit table and may be retried with the same source/title.

Article slugs are now title-derived and human-readable. Existing collisions receive numeric suffixes (`-2`, `-3`, …); source hashes are no longer appended.
