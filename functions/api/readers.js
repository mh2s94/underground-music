// GET /api/readers — "Where our readers are" (footer)
// Returns the share of page views per country for the last 30 days, read from
// Cloudflare Web Analytics (cookieless, bots excluded) through the GraphQL
// Analytics API. Only percentages leave this function: no counts, no IPs, no
// per-visitor data. Results are cached at the edge for 1 hour.
//
// Needs two Pages environment variables (Production):
//   CF_ACCOUNT_ID        Cloudflare account ID (plain text)
//   CF_ANALYTICS_TOKEN   API token with "Account Analytics: Read" (secret)
// Optional:
//   CF_WA_HOST           hostname to count (default music.mikasa.me)
// Without them the endpoint answers { ok:false } and the footer box stays hidden.

const CACHE_SECONDS = 3600;
const DAYS = 30;
const TOP = 5;
const MIN_VIEWS = 50; // below this the box is hidden (too few readers to be meaningful)

const QUERY = `query ($account: String!, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      total: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 1) { count }
      countries: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 50, orderBy: [count_DESC]) {
        count
        dimensions { countryName }
      }
    }
  }
}`;

const json = (body, maxAge) => new Response(JSON.stringify(body), {
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": `public, max-age=${maxAge}`,
    "x-content-type-options": "nosniff"
  }
});

export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_TOKEN) return json({ ok: false }, 300);

  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).origin + "/api/readers?v=1", { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const now = new Date();
  const since = new Date(now.getTime() - DAYS * 86400000);
  const filter = {
    AND: [
      { datetime_geq: since.toISOString(), datetime_leq: now.toISOString() },
      { requestHost: env.CF_WA_HOST || "music.mikasa.me" }
    ]
  };

  let data;
  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}` },
      body: JSON.stringify({ query: QUERY, variables: { account: env.CF_ACCOUNT_ID, filter } })
    });
    data = await r.json();
  } catch {
    return json({ ok: false }, 300);
  }

  const acc = data?.data?.viewer?.accounts?.[0];
  if (!acc || data.errors?.length) {
    console.log("readers: analytics query failed", JSON.stringify(data?.errors || []).slice(0, 300));
    return json({ ok: false }, 300);
  }

  const total = acc.total?.[0]?.count || 0;
  if (total < MIN_VIEWS) return json({ ok: false, reason: "few" }, 1800);

  const rows = (acc.countries || []).filter((c) => c.dimensions?.countryName && c.dimensions.countryName !== "XX" && c.dimensions.countryName !== "T1");
  const top = rows.slice(0, TOP).map((c) => ({ code: c.dimensions.countryName, pct: (c.count / total) * 100 }));

  // Round so the shares always add up to 100.
  const shares = top.map((c) => ({ code: c.code, pct: Math.round(c.pct) })).filter((c) => c.pct >= 1);
  const other = 100 - shares.reduce((s, c) => s + c.pct, 0);
  if (other > 0) shares.push({ code: "other", pct: other });

  const res = json({ ok: true, days: DAYS, countries: shares }, CACHE_SECONDS);
  waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
