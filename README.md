# UNDERGROUND — Extreme Music Magazine

Static Cloudflare Pages site with a Supabase-backed editorial workflow and multi-provider AI article generation.

## Deploy
- Cloudflare Pages project: underground-music
- Production branch: main
- Framework preset: None
- Build command: empty
- Build output directory: .

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
5. Add one or more AI provider API keys as **Secrets**. The router tries configured providers in order and automatically falls back after a provider error, timeout, rate limit, or quota failure:
   - `ANTHROPIC_API_KEY` — Claude
   - `GEMINI_API_KEY` — Google Gemini
   - `OPENAI_API_KEY` — OpenAI
   - `DEEPSEEK_API_KEY` — DeepSeek
   - `MISTRAL_API_KEY` — Mistral
   - `GROQ_API_KEY` — Groq
   - `OPENROUTER_API_KEY` — OpenRouter
6. Optional plain-text configuration variables:
   - `AI_PROVIDER_ORDER` = `claude,gemini,openai,deepseek,mistral,groq,openrouter,workersai`
   - Model overrides: `CLAUDE_MODEL`, `GEMINI_MODEL`, `OPENAI_MODEL`, `DEEPSEEK_MODEL`, `MISTRAL_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL`, `WORKERSAI_MODEL`
6b. Optional free fallback without an API key: Cloudflare Workers AI. In Cloudflare Pages → Settings → Bindings, add a **Workers AI** binding with variable name `AI` (for Production and Preview), then redeploy. It uses Cloudflare's free daily Neuron allocation; default model `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
7. Redeploy the latest commit after changing environment variables.
8. Open `/admin.html` and sign in.

Provider keys and model access are separate for each vendor. The router does not create accounts, bypass provider limits, or create free quota. Some providers require billing or paid credits. Configure only providers for which you have valid API keys and access to the selected model.

AI drafts are not automatically published. Verify facts and sources, then choose the desired status. The AI endpoint checks the user's Supabase session and admin membership before calling any configured provider. Provider API keys remain server-side in Cloudflare Pages Secrets.
