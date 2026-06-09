// Public search proxy (Cloudflare Pages Function).
//
// The worker's /search is authenticated behind TRIGGER_SECRET. This proxy holds
// that secret SERVER-SIDE (never shipped to the browser) and exposes a public,
// input-capped, rate-limited, edge-cached search route. Defence layers, in order:
//   1. Input caps      - query <= 256 chars, top_k <= 10, scope allowlist. Cheap
//                        rejection of abusive/oversized input.
//   2. Edge cache      - identical queries are served from the Pages edge cache
//                        (zero worker hits, zero neurons) for SEARCH_TTL seconds.
//   3. Soft IP limit   - per-isolate token bucket (best-effort first line).
//   4. Hard backstop   - the worker's own daily neuron cap + answer_cache mean
//                        even unbounded proxy traffic cannot overspend neurons
//                        (it returns cached results or 4006), so the budget is
//                        structurally protected regardless of this proxy.
// (3) is per-isolate, not global; a Durable Object / KV token bucket is the
// hardening step for true public launch -- see docs/OPERATIONS.md.

const ORIGIN_FALLBACK = 'https://entrapedia.russo-antonio76.workers.dev';
const MAX_Q = 256;
const MAX_TOPK = 10;
const SCOPES = new Set(['official', 'community', 'both']);
const SEARCH_TTL = 600; // edge-cache identical queries for 10 min

// soft per-IP limiter (per-isolate, best-effort)
const RL_WINDOW_MS = 60_000;
const RL_MAX = 30;
const hits = new Map(); // ip -> number[] (timestamps)

function rateLimited(ip, now) {
  const arr = (hits.get(ip) || []).filter((t) => now - t < RL_WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) { for (const k of hits.keys()) { if (hits.size <= 2500) break; hits.delete(k); } }
  return arr.length > RL_MAX;
}

function json(body, status, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

export async function onRequest(context) {
  const { request, env, waitUntil } = context;
  const url = new URL(request.url);

  let query = '', scope = 'both', topK = 8;
  if (request.method === 'POST') {
    let b = {}; try { b = await request.json(); } catch (_) {}
    query = b.query || b.q || '';
    scope = b.trust_scope || b.scope || 'both';
    topK = b.top_k || 8;
  } else if (request.method === 'GET') {
    query = url.searchParams.get('q') || url.searchParams.get('query') || '';
    scope = url.searchParams.get('scope') || 'both';
    topK = url.searchParams.get('top_k') || 8;
  } else {
    return json({ error: 'method not allowed' }, 405);
  }

  query = String(query).trim().slice(0, MAX_Q);
  if (!query) return json({ error: 'empty query' }, 400);
  if (!SCOPES.has(scope)) scope = 'both';
  topK = Math.max(1, Math.min(MAX_TOPK, parseInt(topK, 10) || 8));

  // 2. edge cache (canonical key independent of how the query arrived)
  const cacheKey = new Request(`${url.origin}/api/search?q=${encodeURIComponent(query.toLowerCase())}&scope=${scope}&top_k=${topK}`, { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const r = new Response(cached.body, cached);
    r.headers.set('x-entrapedia-cache', 'edge-hit');
    return r;
  }

  // 3. soft per-IP rate limit
  const ip = request.headers.get('cf-connecting-ip') || 'anon';
  if (rateLimited(ip, Date.now())) return json({ error: 'rate_limited', detail: 'Too many searches; please slow down.' }, 429);

  const secret = env.TRIGGER_SECRET;
  if (!secret) return json({ error: 'proxy_misconfigured', detail: 'search secret not set' }, 503);
  const origin = (env.SEARCH_ORIGIN || ORIGIN_FALLBACK).replace(/\/+$/, '');

  let upstream;
  try {
    upstream = await fetch(`${origin}/search`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, trust_scope: scope, top_k: topK }),
    });
  } catch (e) {
    return json({ error: 'upstream_unreachable' }, 502);
  }

  const text = await upstream.text();
  const out = new Response(text, {
    status: upstream.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${SEARCH_TTL}`,
      'x-entrapedia-cache': 'miss',
    },
  });
  if (upstream.ok) waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}
