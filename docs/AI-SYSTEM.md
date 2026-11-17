# AI system

Audited 2026-11-17. API keys are never written here. They live in Cloudflare Pages secrets.

## Providers

All providers are defined in `buildProviders()` in `functions/api/generate.js`. `track-info.js` reuses the same function.

| Key in `AI_PROVIDER_ORDER` | Enabled when | Default model (override variable) | API |
| --- | --- | --- | --- |
| `gemini` | `GEMINI_API_KEY` | `gemini-3.8-flash` (`GEMINI_MODEL`) | Google `generateContent`, `thinkingLevel: low`, max 4096 output tokens |
| `workersai` | binding `AI` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (`WORKERSAI_MODEL`) | `env.AI.run`, 2000 tokens |
| `groq` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` (`GROQ_MODEL`) | OpenAI-compatible |
| `openrouter` | `OPENROUTER_API_KEY` | `meta-llama/llama-3.3-70b-instruct:free` (`OPENROUTER_MODEL`) | OpenAI-compatible |
| `mistral` | `MISTRAL_API_KEY` | `mistral-large-latest` (`MISTRAL_MODEL`) | OpenAI-compatible |
| `deepseek` | `DEEPSEEK_API_KEY` | `deepseek-flash` (`DEEPSEEK_MODEL`) | OpenAI-compatible |
| `openai` | `OPENAI_API_KEY` | `gpt-6-astra` (`OPENAI_MODEL`) | OpenAI chat completions, `max_completion_tokens` 4000 |
| `claude` | `ANTHROPIC_API_KEY` | `claude-sonnet-5-5` (`CLAUDE_MODEL`) | Anthropic Messages, 2000 tokens |

- **Default order:** `gemini,workersai,groq,openrouter,mistral,deepseek,openai,claude`. Change it with the plain-text variable `AI_PROVIDER_ORDER`.
- **Actually in use:** the only verified evidence is the auto-draft run on 2026-11-16, where both drafts came from **`workersai`**. So Gemini is either not configured or failed on that run. Which other keys are set in Cloudflare is **not verifiable from the repo**: check Pages → Settings → Variables and Secrets.
- **Model names:** the defaults above are whatever the code says. Whether each vendor still offers that model name must be checked at the vendor. A wrong name shows up as that provider failing in the `attempts` list.

## Article generator: `POST /api/generate` (admin + 2FA)

```mermaid
flowchart TD
  A["admin.html: Generate / Auto-write / Write as drafts"] -->|"Bearer token, {band, album, genre, category, notes}"| B["/api/generate"]
  B --> C{"session valid?<br/>admin_users?<br/>aal2?"}
  C -- no --> X["401 / 403"]
  C -- yes --> D["writeArticle()"]
  D --> E["start YouTube lookup in background"]
  D --> F["buildPrompt(): genre list, accuracy rules,<br/>tagged output format"]
  F --> G["hedgedRace(configured providers)"]
  G --> H["parseArticle(): tagged text, then JSON repair"]
  H --> I["second YouTube search if AI corrected band/release"]
  I --> J["{title, excerpt, content, tags, genre, kind, score,<br/>band, release, youtube_url, cover_image_url, provider, model, took_ms, attempts}"]
```

- **Timeouts:**
  - whole AI phase `DEADLINE_MS` = 75 s
  - one provider `PROVIDER_TIMEOUT_MS` = 50 s
  - `HEDGE_DELAY_MS` = 15 s
- **Hedged race:**
  - The first provider in the order starts immediately.
  - If it **fails**, the next one starts right away.
  - If it is **slow** (15 s), the next one starts in parallel.
  - The first valid article wins and the others are aborted.
  - All failures come back in `attempts: [{provider, reason}]`, and the admin shows them in a toast.
- **Output format:** labelled lines `BAND:`, `RELEASE:`, `TITLE:`, `EXCERPT:`, `TAGS:`, `GENRE:`, `TYPE:` (Review / News / Feature / Interview), `SCORE:` (reviews only, 0–10), then `CONTENT:` with 350–500 words of Markdown and 2–3 `##` subheadings.
- **Parsing:** `parseArticle()` strips `<think>` blocks and code fences, reads the labels, and falls back to JSON with control-character repair.
- **Genre mapping:** the prompt contains `PROMPT_LIST` (the full taxonomy from `genres-data.js`), and the answer is normalised with `canonicalGenre()`. Unknown → "Underground".
- **YouTube:** with `YOUTUBE_API_KEY`, the Data API v3. Otherwise the public results page is parsed (6 s timeout). The thumbnail becomes `cover_image_url`. If nothing is found, a search link is returned.
- **Errors:**
  - 503 when no provider is configured
  - 502 "All AI providers failed" with `attempts`
  - 401 / 403 for authentication, admin and 2FA

The admin retries the network call once.

## Scene Radar Auto-write (admin)
- **One item:** **Auto-write** fills the generator form from the headline (band guess, `category = News`, notes with source, date, summary and "write in your own words"), sets `pendingSource`, presets the publication time to the source's time, and calls the generator. The editor reviews, then taps **Publish now**. A line `Source: [site](link)` is appended to the content.
- **Batch:** tick up to **5** headlines → **Write as drafts**.
  - Two run at a time.
  - Each result is inserted directly as `status = 'draft'`, with the source line, the source image or YouTube thumbnail, and `published_at` = the source time.
  - Slug conflicts (`23505`) are retried with a random suffix.
  - **Publish all** in the drafts banner publishes every AI draft (rows with a `Source:` line) after a confirmation. It keeps the stored `published_at`, or sets it to now.
- **Already written:** a headline whose link appears in any loaded article's content shows **✓ Written** and cannot be selected.

## Scheduled AI drafts: `POST /api/auto-draft`
- **Caller:** GitHub Actions `.github/workflows/auto-draft.yml` daily at 21:43 UTC = 06:43 WIT, or **Run workflow** for a manual run. The workflow uses `curl` with a 280 s timeout and one retry after 60 s.
- **Auth:** `Authorization: Bearer <AUTODRAFT_TOKEN>`, compared in constant time.
- **Database access:** uses the Supabase **secret/service key**, accepted under any of these names: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_SERVICE_ROLE`, `SERVICE_ROLE_KEY`. Keys starting with `sb_` go only in the `apikey` header. If the key is missing, the 503 response lists the matching variable **names** it can see (never values).
- **Steps:**
  1. Fetch `/api/news?refresh=1`.
  2. Skip headlines whose link is already in the last 300 articles' content.
  3. Skip non-news with the `NOT_NEWS` regex: top-N stories, this week's, round-ups, podcasts, giveaways, "deals on/for", "on sale", Black Friday, polls and similar.
  4. Take `AUTODRAFT_COUNT` items (default 2, max 3).
  5. Call `writeArticle()` for each.
  6. Insert as **draft**, with author = the first admin and `published_at` = the source time.
  7. Optional summary email to `AUTODRAFT_NOTIFY` via Resend.
- **Returns:** `{created:[…], failed:[…]}`, HTTP 200 if at least one draft was created, 502 otherwise.
- **Status:** VERIFIED. Run `43867308189` on 2026-11-16 created 2 drafts via `workersai`. Daily cron runs after that were not checked during the audit.

**Nothing is ever published automatically.**

## Telegram bot: `POST /api/telegram/digest` + `POST /api/telegram/webhook`
- **Digest:** GitHub Actions `.github/workflows/telegram-digest.yml` at 08:07, 14:07 and 20:07 WIT (or **Run workflow**) calls `/api/telegram/digest` with `AUTODRAFT_TOKEN`. It takes up to 25 unseen headlines (not written up, not sent before, table `telegram_radar`), has Workers AI (`WORKERSAI_MODEL`, default Llama 3.3 70B) score each 0–10 for fit with UNDERGROUND, and sends the best ones scoring 6 or more (max 5) with a `🎯 score · reason` line; lower scores are stored as `skipped` so they are not scored again. Without AI it falls back to headlines tagged with our genres. Each is sent as one message with **✍️ Tulis draft** / **✖ Abaikan**. The same call (re)registers the webhook.
- **Tulis draft:** the webhook claims the row (`sent` → `writing`), writes with the same generator as Auto-draft (`writeDraftFromItem` in `functions/api/draft-lib.js`) and sends a "Draft siap" card with **🚀 Publish**, **✏️ Edit di admin** (`admin.html#edit=<id>`, still behind login + 2FA) and **🗑 Buang draft**. A `writing` row older than 3 minutes can be retried.
- **Auto-draft** also sends each of its daily drafts as the same card when the bot is configured.
- The bot can only write drafts, publish drafts and delete drafts. Status: IMPLEMENTED, NOT VERIFIED live (mock-tested 2026-11-18).

## Music metadata: `POST /api/track-info` (admin + 2FA)
- **Input:** tags read in the browser by `assets/audiotags.js` (title, artist, album, year, genre, filename, duration).
- **Steps:**
  1. In parallel: the AI cleans names and picks a genre, and the catalogue lookup (iTunes Search, then Deezer) finds album, year, genre and official artwork.
  2. If the first catalogue lookup missed, it is retried with the AI-cleaned names.
- **AI part:** separate from the article race. At most the first 3 configured providers are tried **one after another**, 12 s each, `temperature 0.2`, 300 tokens. The JSON is extracted from the reply.
- **Genre:** AI genre → tag genre → catalogue genre → "Underground", always through `canonicalGenre()`.
- **Result:** always returns a best guess. Every step may fail without breaking the upload.

## Covers for charts: `GET /api/cover`
No AI. iTunes, then Deezer, cached 7 days. Admin → Music → **Find missing covers** saves the found URLs on tracks.

## Adding a provider
1. In `buildProviders()` add an entry `{ enabled, model, run(signal) }`. For OpenAI-compatible APIs use `openAICompatible(url, key, model, std)`. `run` must return the raw text and throw on HTTP errors (use `safeJson` and `errorText`).
2. Add a model default and a `<NAME>_MODEL` override in the `m` map.
3. Add the key name to `DEFAULT_ORDER` if it should run by default.
4. Add the secret in Cloudflare (Secret type), redeploy, and generate once. The admin toast shows `provider` and any `attempts`.
5. If the provider's API host is called from the **browser** (it should not be; all calls are server-side), the CSP in `_headers` would also need it.
6. Document it in this file and in [DEPLOYMENT.md](DEPLOYMENT.md#environment-variables).

## Cost and quota notes
- Workers AI has a free daily allocation (10,000 neurons per day at the time of writing). One article costs roughly 2,500 input and 900 output tokens.
- Provider keys and quotas are the owner's. The router does not create accounts or quota.
