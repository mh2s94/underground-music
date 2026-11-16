# UNDERGROUND — Extreme Music Magazine

Static Cloudflare Pages site with a Supabase-backed editorial workflow and multi-provider AI article generation.

## Deploy
- Cloudflare Pages project: underground-music
- Production branch: main
- Framework preset: None
- Build command: empty
- Build output directory: .

## Public site
`index.html` + `assets/bento.css` + `assets/bento.js`: a "Neon Basement" bento dashboard (Bebas Neue / Inter / Space Mono, neon pink #FF2E63 + UV #7B5CFF, VHS scanlines) with four views (Dashboard, Articles, About, Account), splash screen, animated counters and charts, and an article reader at `#/a/<slug>`. All numbers and charts are computed from published articles. To enable the "Submit your demo" and "Contact" buttons, set `SUBMIT_EMAIL` at the top of `assets/bento.js`.

## Music (Basement radio)
1. Supabase Dashboard → SQL Editor → run `supabase/music.sql` once (after `community.sql`). It creates the `tracks` table, a public `music` storage bucket (25 MB per file, audio + cover images, admin-only uploads) and the `ug_admin_purge` cleanup function.
2. Admin → **Music** tab: drop an MP3/M4A/OGG/WAV/FLAC, add title, artist, genre and an optional cover, then **Upload & publish**. Tracks can be edited, unpublished or deleted (files are removed from storage too).
2b. **Recommended: Cloudflare R2 storage** (10 GB free, no streaming/egress fees, up to 100 MB per song, uploaded in 10 MB chunks). Cloudflare Dashboard → **R2 Object Storage** → enable R2 (Cloudflare may ask for a payment method to verify the account; the free tier is not charged) → **Create bucket** `underground-music`. Then **Workers & Pages → underground-music → Settings → Bindings → Add → R2 bucket**, variable name `MUSIC`, bucket `underground-music`, and redeploy. The admin then uploads to R2 automatically (`functions/api/music/[[path]].js` streams files with Range support for seeking). Without the binding, uploads fall back to Supabase Storage (1 GB, 5 GB egress/month).
2c. Run `supabase/music-v2.sql` once (adds album and release year to tracks).
2d. **Auto-fill:** when the admin picks a song, the browser reads its embedded tags and cover (`assets/audiotags.js`: ID3, FLAC, M4A). `/api/track-info` then looks the song up on iTunes and Deezer (free, no key) for album, year and cover art, and asks the configured AI to clean up names and choose the genre. The admin only reviews the form and publishes.
2e. **Charts:** run `supabase/charts.sql` once. Members rate songs 1–5 stars in the player. The **Charts** view shows Top 10 Bands and Top 10 Hits in two modes: *Community* (members' ratings, This week / All time, ranked by Bayesian average so a single vote can't top the list) and *Global metal* (`/api/charts`, built from Deezer's free public API and cached for 6 h: bands by fans, hits by current popularity, with 30-second previews). The home page shows the top 3.
3. Visitors play tracks from the **Music** view; the mini player keeps playing while they browse, with lock-screen controls on phones.

## Admin settings: clean up data
Admin → **Settings** shows counts and lets you delete articles, comments, saved articles, music (with files) or demo submissions, or **Reset everything**. Every deletion asks you to type DELETE / RESET first. Member accounts, admin access and categories are never deleted.

## Scene radar (music news)
`functions/api/news.js` reads the public RSS feeds of heavy-music sites (Metal Injection, MetalSucks, Theprp, Decibel, Loudwire metal, New Noise, Distorted Sound), tags each headline with our genres, guesses the band name, and caches the list for 15 minutes. No API key needed. The public "Underground wire" shows headlines linking to the original sites; the admin **Scene radar** panel has a **Write article** button that fills the AI generator with the facts and adds a source credit. Only headlines, short summaries and links are used — full articles stay on the original sites. Edit the `SOURCES` list in that file to add or remove feeds.

## Visitor accounts (sign up, saved articles, comments, demo submissions)
1. Supabase Dashboard → SQL Editor → paste and run `supabase/community.sql` (safe to re-run).
2. Authentication → Sign In / Providers → Email: enable **Allow new users to sign up** and keep **Confirm email** on.
3. Authentication → URL Configuration: set **Site URL** to `https://underground-music.pages.dev` and add `https://underground-music.pages.dev/**` to **Redirect URLs** (plus your custom domain if you add one).
4. Optional: Authentication → Emails → customise the confirmation and reset-password templates with the UNDERGROUND name.

Members can save articles, comment (5 per minute limit), and submit up to 3 demos per day. Admins can delete any comment from the article reader and manage demos in the admin **Demo inbox**.

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
