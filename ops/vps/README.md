# VPS auto-publisher — off-VPS copies

Copies of the live files in `/opt/underground-ai/` on the VPS, kept here so a lost VPS disk
does not lose the writer. They are **not** part of the Cloudflare Pages build and nothing here
is served by the site.

| File | What it is |
| --- | --- |
| `worker.py` | The writer: reads `/api/news?full=1`, runs the gate, POSTs `/api/ai-publish`, then posts to Facebook. Cron `15 */3 * * *` runs `worker.py 1`. |
| `guard.py` | The machine gate: `enrich()` (page text for feeds with no `content:encoded`), `fact_problems()` (deterministic: links, years, numbers, quotes, named series), `ai_fact_check()` (one cheap model call). |
| `underground_editorial.py` | Imported by `worker.py` (`safe_genre`, `clean_body`, `clean_title`, `ensure_watch_line`, `build_article_payload`, `ALLOWED_GENRES`). |

Not included: `.env`. It holds secrets (`AI_PUBLISH_TOKEN`, `COPILOTKU_API_KEY`, `META_PAGE_ACCESS_TOKEN`,
`GROQ_API_KEY`, `GEMINI_API_KEY`, …) and must never be committed.

To restore on a fresh VPS: put these files plus `underground_editorial.py` in `/opt/underground-ai/`,
re-create `.env`, and add the cron line above. See `docs/PROJECT-STATUS.md` for the context.
