# UNDERGROUND — Extreme Music Magazine

Static Cloudflare Pages site with Supabase-backed editorial workflow.

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

## Finish admin setup
1. In Supabase Dashboard → Authentication → Users, create an admin user with your email and a strong password.
2. Copy that user's UUID.
3. Open SQL Editor and run:
   insert into public.admin_users (user_id) values ('YOUR-AUTH-USER-UUID');
4. In Cloudflare Pages → Settings → Variables and Secrets, add:
   - SUPABASE_URL = https://lhhmzfwjznlwkentbakv.supabase.co
   - SUPABASE_ANON_KEY = your Supabase publishable key (or legacy anon key)
   - GEMINI_API_KEY = your Gemini API key (secret; never place it in browser code)
5. Redeploy the latest commit after adding variables.
6. Open /admin.html and sign in.

AI drafts are not automatically published. Verify facts and sources, then choose the desired status. The AI endpoint checks the user's Supabase session and admin membership before calling Gemini.
