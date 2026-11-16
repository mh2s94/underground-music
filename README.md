# UNDERGROUND — Extreme Music Magazine

Static Cloudflare Pages site with a Supabase-backed editorial workflow and multi-provider AI article generation.

## Deploy
- Cloudflare Pages project: underground-music
- Production branch: main
- Framework preset: None
- Build command: empty
- Build output directory: .

## Public site
`index.html` + `assets/bento.css` + `assets/bento.js`: a bento-grid dashboard with three views (Dashboard, Articles, About), splash screen, animated counters and charts, and an article reader at `#/a/<slug>`. All numbers and charts are computed from published articles. To enable the "Submit your demo" and "Contact" buttons, set `SUBMIT_EMAIL` at the top of `assets/bento.js`.

## Supabase
Project ref: lhhmzfwjznlwkentbakv
Region: Singapore
Tables: articles, categories, admin_users
RLS is enabled. Published articles are public; article writes require membership in admin_users.

## Admin setup
1. In Supabase Dashboard → Authentication → Users, create an admin user with your email and a strong password.
2. Copy that user's UUID.
3. Open SQL Editor and run:
   `insert into public.admin_users (user_id) values ('YOUR-AUTH-USER-UUID') on conflict do nothing;`
4. In Cloudflare Pages → Settings → Variables and Secrets, add these as **Secrets**:
   - `SUPABASE_URL` = `https://lhhmzfwjznlwkentbakv.supabase.co`
   - `SUPABASE_ANON_KEY` = your Supabase publishable key (or legacy anon key)
5. AI providers. The generator works with any of these; configure at least one:
   - **Cloudflare Workers AI (free, no key)**: Pages → Settings → Bindings → add a Workers AI binding named `AI`.
   - Secrets: `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`.
   The generator uses hedged requests: it starts the first provider, starts the next one immediately if it fails or after 15 s if it is slow, and returns the first valid article (all within ~75 s). Replies are requested in a simple tagged text format and parsed tolerantly, so a malformed reply from one model does not fail the request.
6. Optional plain-text configuration variables:
   - `AI_PROVIDER_ORDER` (default `gemini,workersai,groq,openrouter,mistral,deepseek,openai,claude`)
   - Model overrides: `GEMINI_MODEL`, `WORKERSAI_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL`, `MISTRAL_MODEL`, `DEEPSEEK_MODEL`, `OPENAI_MODEL`, `CLAUDE_MODEL`
   - `YOUTUBE_API_KEY` (Secret, optional, YouTube Data API v3) for more reliable video lookup. Without it, the generator reads YouTube's public search page and falls back to a search link if no video is found.
7. Redeploy the latest commit after changing environment variables.
8. Open `/admin.html` and sign in.

Provider keys and model access are separate for each vendor. The router does not create accounts, bypass provider limits, or create free quota. Some providers require billing or paid credits. Configure only providers for which you have valid API keys and access to the selected model.

AI drafts are not automatically published. Verify facts and sources, then choose the desired status. The AI endpoint checks the user's Supabase session and admin membership before calling any configured provider. Provider API keys remain server-side in Cloudflare Pages Secrets.
