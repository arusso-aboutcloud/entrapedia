/**
 * Entrapedia ingestion worker -- chunk 3a: FETCH + STORE ONLY.
 *
 * Per run, for each wired Tier-A source: resolve the repo head, walk the tree to
 * enumerate in-scope files, diff their git blob SHAs against the `documents`
 * registry, fetch ONLY changed/new bodies, write each raw body to R2, upsert a
 * `documents` row, and persist walk + sync progress. Hitting the per-run file or
 * subrequest budget leaves progress mid-flight so the next run resumes the tree
 * walk AND the fetch step (resumable backfill). An unchanged head is a cheap
 * no-op.
 *
 * SCOPE (chunk 3a): NO Workers AI, NO embeddings, NO Vectorize, NO `chunks`
 * rows. The AI and VECTORIZE bindings are intentionally NOT referenced in this
 * file. Embedding is chunk 3b.
 *
 * Tree walk: the GitHub Git Trees API truncates large recursive trees, and a
 * recursive call on a big directory returns multi-MB JSON whose parse alone can
 * exceed the Workers Free CPU limit (error 1102). So we never fetch recursively:
 * we list one directory level non-recursively per visit and enqueue child dirs
 * (skipping includes/images/dot-dirs that never yield content). The pending-
 * directory frontier is persisted in sync_state.last_etag so a capped run
 * resumes the walk -- no hardcoded content paths, self-maintaining against reorg.
 *
 * Secrets (NOT committed; set via `wrangler secret put`):
 *   GITHUB_TOKEN   - GitHub token (public-repo read is sufficient). Sent as a
 *                    Bearer token on GitHub API + raw.githubusercontent calls to
 *                    lift the unauthenticated 60/hr rate limit.
 *   TRIGGER_SECRET - shared secret guarding the manual POST/GET /run trigger.
 */

import { chunkDocument, estimateTokens } from './chunker.mjs';

// ---- tunable run budgets -------------------------------------------------

// Per-run changed-file cap (bodies fetched + stored per invocation). TUNABLE.
const MAX_FILES_PER_RUN = 25;

// Hard ceiling on subrequests per invocation. fetch(), R2, and D1 calls each
// count as one subrequest. Workers Free allows 50 subrequests/request; we stay
// under it and let the resumable walk continue next run. Raise on Workers Paid
// (1000). TUNABLE.
const SUBREQUEST_BUDGET = 45;

// ---- embedding budgets (chunk 3b) ----------------------------------------

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5'; // 768-dim, max 512 input tokens
const EMBED_MAX_TOKENS = 512;                    // model input cap; longer is silently dropped
const NEURONS_PER_MTOKEN = 6058;                 // @cf/baai/bge-base-en-v1.5 (Cloudflare pricing)

// Per-DAY (UTC) neuron cap for the embedding backfill. The hard free-tier reset
// is 00:00 UTC; we hard-stop the day's embedding here.
// CALIBRATION: real Workers AI usage measured ~1.25x this estimated count
// (per-request overhead beyond the 6058/M-token input rate), so a 9000 budget
// overshot to the 10k ceiling (error 4006). Set to 6000 (estimated) -> ~7.5k
// real, reserving ~2.5k/day of real headroom so retrieval `/search` query
// embeds (~1 neuron each) never starve the backfill or trip 4006. TUNABLE.
const EMBED_NEURON_BUDGET = 6000;

// Per-INVOCATION subrequest cap (Workers Free allows 50). Embedding batches a
// whole doc's chunks into one AI call + one Vectorize upsert + one D1 batch, so
// this bounds docs-per-invocation; many invocations/day fill the neuron budget.
// TUNABLE.
const EMBED_SUBREQUEST_BUDGET = 45;
const EMBED_DOCS_PER_RUN = 40; // safety cap on docs selected per invocation

// ---- retrieval / search (chunk 4) ----------------------------------------

// bge-base s2p convention: prefix the QUERY (not the passages) with this
// instruction for short-query -> long-passage retrieval.
const BGE_QUERY_INSTRUCTION = 'Represent this sentence for searching relevant passages: ';
// Trust re-rank: additive bonus to the cosine score for official over community,
// so official outranks community at similar relevance. TUNABLE (raise when
// community/Tier-D content lands and needs a stronger demotion).
const TRUST_BONUS = 0.05;
const SEARCH_TOPK_DEFAULT = 8;
const SEARCH_TOPK_MAX = 25;
// Query-result cache staleness bound. While the embedding backfill is still
// filling the index, a short TTL keeps repeats cheap without serving a stale
// partial result set indefinitely; raise it once the corpus is fully embedded.
// TUNABLE.
const SEARCH_CACHE_TTL_SECONDS = 3600;

const GH_API = 'https://api.github.com';
const GH_RAW = 'https://raw.githubusercontent.com';

// ---- source config (add sources by editing this list, not the code) ------

const SOURCES = [
  {
    key: 'entra-docs',
    owner: 'MicrosoftDocs', repo: 'entra-docs', pathPrefixes: null,
    content_type: 'A', trust: 'official', layer: 'current', license: 'MIT',
    attribution: 'Microsoft Docs - MicrosoftDocs/entra-docs (MIT)',
  },
  {
    key: 'entra-powershell-docs',
    owner: 'MicrosoftDocs', repo: 'entra-powershell-docs', pathPrefixes: null,
    content_type: 'A', trust: 'official', layer: 'current', license: 'MIT',
    attribution: 'Microsoft Docs - MicrosoftDocs/entra-powershell-docs (MIT)',
  },
  {
    key: 'graph-docs',
    owner: 'microsoftgraph', repo: 'microsoft-graph-docs-contrib', pathPrefixes: null,
    content_type: 'A', trust: 'official', layer: 'current', license: 'CC-BY-4.0',
    attribution: 'Microsoft Graph docs - microsoftgraph/microsoft-graph-docs-contrib (CC-BY-4.0)',
  },
  {
    key: 'azure-docs-aad',
    owner: 'MicrosoftDocs', repo: 'azure-docs',
    pathPrefixes: ['articles/active-directory-b2c/', 'articles/active-directory/'],
    content_type: 'A', trust: 'official', layer: 'legacy', license: 'CC-BY-4.0',
    attribution: 'Microsoft Azure docs - MicrosoftDocs/azure-docs (CC-BY-4.0)',
  },
];

// ---- filters (strict) ----------------------------------------------------

// Repo-meta filenames that are not documentation content. Excluded at the repo
// root (where they live); a same-named page inside the doc tree is still kept.
const REPO_META = new Set([
  'readme.md', 'contributing.md', 'security.md', 'support.md',
  'code_of_conduct.md', 'code-of-conduct.md', 'changelog.md', 'change-log.md',
  'thirdpartynotices.md', 'third-party-notices.md', 'license.md', 'licence.md',
  'agents.md', 'notices.md', 'notfound.md',
]);

// Ingest only .md and content .yml (e.g. faq.yml). Skip dot-dirs (.github),
// /includes/ snippet fragments, root repo-meta files, TOC/breadcrumb/config and
// root-level build YAML, and everything else (media, .json, binaries).
function isContentFile(path) {
  const l = path.toLowerCase();
  const segs = l.split('/');
  if (segs.some((s) => s.startsWith('.'))) return false; // .github, .vscode, ...
  if (segs.includes('includes')) return false;           // snippet fragments at any depth (incl. a repo-root includes/)
  const base = segs[segs.length - 1];
  const atRoot = segs.length === 1;
  if (atRoot && REPO_META.has(base)) return false;        // root README/LICENSE/etc.
  if (l.endsWith('.md')) return true;
  if (l.endsWith('.yml')) {
    // Content YAML must live in the doc tree (below the repo root); this drops
    // root-level build/config YAML such as cabgen-bootstrap.yml.
    if (atRoot) return false;
    if (base === 'toc.yml') return false;
    if (l.includes('breadcrumb')) return false;
    if (base.endsWith('.config.yml')) return false;
    return true;
  }
  return false;
}

function inScope(source, path) {
  if (source.pathPrefixes && !source.pathPrefixes.some((p) => path.startsWith(p))) return false;
  return isContentFile(path);
}

// ---- GitHub helpers ------------------------------------------------------

function ghHeaders(env) {
  const h = { 'User-Agent': 'entrapedia-ingestion', 'Accept': 'application/vnd.github+json' };
  if (env.GITHUB_TOKEN) h['Authorization'] = `Bearer ${env.GITHUB_TOKEN}`;
  return h;
}

async function ghJson(env, url, budget) {
  budget.sub--;
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (!res.ok) throw new Error(`GitHub ${res.status} ${url}`);
  return res.json();
}

async function getHead(env, source, budget) {
  const repo = await ghJson(env, `${GH_API}/repos/${source.owner}/${source.repo}`, budget);
  const branch = repo.default_branch;
  const head = await ghJson(env, `${GH_API}/repos/${source.owner}/${source.repo}/commits/${branch}`, budget);
  return { branch, headSha: head.sha };
}

function treeUrl(source, sha, recursive) {
  return `${GH_API}/repos/${source.owner}/${source.repo}/git/trees/${sha}${recursive ? '?recursive=1' : ''}`;
}

// Resolve the tree SHA of a slash-delimited directory path (for path-scoped
// sources such as azure-docs, so we seed the frontier at the in-scope subtrees
// instead of walking the whole repo).
async function resolveDirSha(env, source, branch, dirPath, budget) {
  let tree = await ghJson(env, treeUrl(source, branch, false), budget);
  let sha = null;
  for (const part of dirPath.split('/')) {
    const e = tree.tree.find((x) => x.path === part && x.type === 'tree');
    if (!e) return null;
    sha = e.sha;
    tree = await ghJson(env, treeUrl(source, sha, false), budget);
  }
  return sha;
}

async function seedFrontier(env, source, branch, budget) {
  if (!source.pathPrefixes) return [{ sha: branch, prefix: '' }];
  const frontier = [];
  for (const prefix of source.pathPrefixes) {
    const sha = await resolveDirSha(env, source, branch, prefix.replace(/\/+$/, ''), budget);
    if (sha) frontier.push({ sha, prefix });
  }
  return frontier;
}

async function fetchBody(env, source, branch, path, budget) {
  budget.sub--;
  const res = await fetch(`${GH_RAW}/${source.owner}/${source.repo}/${branch}/${path}`, { headers: ghHeaders(env) });
  if (!res.ok) throw new Error(`raw ${res.status} ${path}`);
  return res.text();
}

// ---- store helpers -------------------------------------------------------

// Known content hashes for the DIRECT files of one directory only (not the whole
// source) -- keeps the in-memory set and D1 response small so per-run CPU stays
// under the Workers Free limit even on directories with thousands of files.
// Known content hashes for docs under one directory prefix, via a RANGE scan
// (no LIKE -> no wildcard pitfalls, no "pattern too complex"). Returns the whole
// subtree under the prefix; only the directory's direct blobs are ever looked
// up, so extra nested rows are harmless. For the leaf/non-content dirs that
// dominate the frontier this returns ~0 rows.
async function loadKnownHashesForDir(env, sourceKey, dirPrefix, budget) {
  budget.sub--;
  const lo = `${sourceKey}:${dirPrefix}`;
  const hi = lo + String.fromCharCode(0xffff);
  const { results } = await env.DB.prepare(
    'SELECT doc_id, content_hash FROM documents WHERE source = ? AND doc_id >= ? AND doc_id < ?'
  ).bind(sourceKey, lo, hi).all();
  const m = new Map();
  for (const r of results) m.set(r.doc_id, r.content_hash);
  return m;
}

async function storeDoc(env, source, branch, blob, body, now, budget) {
  const docId = `${source.key}:${blob.path}`;
  const r2Key = `${source.key}/${blob.path}`;
  const contentType = blob.path.toLowerCase().endsWith('.md') ? 'text/markdown' : 'application/yaml';
  budget.sub--;
  await env.CORPUS.put(r2Key, body, { httpMetadata: { contentType } });
  const sourceUrl = `https://github.com/${source.owner}/${source.repo}/blob/${branch}/${blob.path}`;
  budget.sub--;
  await env.DB.prepare(
    `INSERT INTO documents
       (doc_id, source, content_type, trust, layer, source_url, license, attribution, content_hash, fetched_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
     ON CONFLICT(doc_id) DO UPDATE SET
       content_type = ?3, trust = ?4, layer = ?5, source_url = ?6, license = ?7,
       attribution = ?8, content_hash = ?9, updated_at = ?10`
  ).bind(
    docId, source.key, source.content_type, source.trust, source.layer,
    sourceUrl, source.license, source.attribution, blob.sha, now
  ).run();
}

async function saveSyncState(env, sourceKey, headSha, walkState, status, now) {
  await env.DB.prepare(
    `INSERT INTO sync_state (source, last_run_at, last_cursor, last_etag, status)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(source) DO UPDATE SET last_run_at = ?2, last_cursor = ?3, last_etag = ?4, status = ?5`
  ).bind(sourceKey, now, headSha, JSON.stringify(walkState), status).run();
}

// ---- per-source processing ----------------------------------------------

async function processSource(env, source, budget) {
  const now = Math.floor(Date.now() / 1000);
  const stat = { source: source.key, created: 0, updated: 0, fetched: 0, examined: 0, frontier: 0, status: 'idle' };

  const { branch, headSha } = await getHead(env, source, budget);

  const prior = await env.DB.prepare('SELECT last_etag FROM sync_state WHERE source = ?').bind(source.key).first();
  let ws = null;
  if (prior && prior.last_etag) { try { ws = JSON.parse(prior.last_etag); } catch (_) { ws = null; } }

  // Cheap no-op: head unchanged and last walk completed.
  if (ws && ws.headSha === headSha && ws.done) { stat.status = 'nochange'; stat.frontier = 0; return stat; }
  // New head (or first run): start a fresh walk.
  if (!ws || ws.headSha !== headSha) {
    ws = { headSha, frontier: await seedFrontier(env, source, branch, budget), done: false };
  }

  // Walk the directory frontier, fetching changed blobs as we discover them.
  while (ws.frontier.length > 0 && budget.files > 0 && budget.sub > 4) {
    const dir = ws.frontier[0];
    // Always list ONE directory level non-recursively and enqueue child dirs.
    // A recursive call on a large/truncated tree returns a multi-MB JSON whose
    // parse alone can exceed the Workers Free CPU limit (error 1102), so we never
    // fetch recursively -- we descend the tree one level per visit. Bounded
    // per-run CPU at the cost of more (small) tree calls; the frontier persists
    // so the walk is fully resumable.
    const t = await ghJson(env, treeUrl(source, dir.sha, false), budget);
    let blobs = [];
    let subdirs = [];
    for (const e of t.tree) {
      if (e.type === 'blob') {
        blobs.push({ path: dir.prefix + e.path, sha: e.sha });
      } else if (e.type === 'tree') {
        // Don't descend into dirs that never yield content: snippet fragments
        // (`includes`), binary `images`, or dot-dirs. Saves walking thousands of
        // empty-for-us directories (e.g. Graph's per-topic image folders).
        const name = e.path.toLowerCase();
        if (name === 'includes' || name === 'images' || name.startsWith('.')) continue;
        subdirs.push({ sha: e.sha, prefix: dir.prefix + e.path + '/' });
      }
    }
    stat.examined += blobs.length;

    // Known hashes for THIS directory's direct files only (bounded CPU).
    const known = await loadKnownHashesForDir(env, source.key, dir.prefix, budget);
    const changed = blobs.filter(
      (b) => inScope(source, b.path) && known.get(`${source.key}:${b.path}`) !== b.sha
    );

    let completedDir = true;
    for (const b of changed) {
      if (budget.files <= 0 || budget.sub < 4) { completedDir = false; break; }
      const body = await fetchBody(env, source, branch, b.path, budget);
      const existed = known.has(`${source.key}:${b.path}`);
      await storeDoc(env, source, branch, b, body, now, budget);
      budget.files--;
      stat.fetched++;
      if (existed) stat.updated++; else stat.created++;
    }

    if (completedDir) {
      ws.frontier.shift();              // this dir's in-scope blobs are all stored
      ws.frontier.push(...subdirs);     // enqueue children (only set when truncated)
    } else {
      break;                            // budget hit mid-dir; re-expand next run
    }
  }

  ws.done = ws.frontier.length === 0;
  stat.frontier = ws.frontier.length;
  stat.status = ws.done ? 'complete' : 'in_progress';
  await saveSyncState(env, source.key, headSha, ws, stat.status, now);
  return stat;
}

// ---- run orchestration ---------------------------------------------------

async function runIngestion(env, opts = {}) {
  const budget = {
    files: opts.max && opts.max > 0 ? opts.max : MAX_FILES_PER_RUN,
    sub: opts.subBudget && opts.subBudget > 0 ? opts.subBudget : SUBREQUEST_BUDGET,
  };
  const only = opts.source || null;
  // Rotation-with-resumption: the scheduled run passes a day-of-year startIndex
  // so the per-run budget leads with a different source each day (fairness),
  // wrapping through the rest if budget remains. Each source resumes its own
  // persisted sync_state frontier -- rotation never resets a source's progress.
  const n = SOURCES.length;
  let start = 0;
  if (Number.isInteger(opts.startIndex)) start = ((opts.startIndex % n) + n) % n;

  const summary = {
    started_at: Math.floor(Date.now() / 1000),
    start_index: start,
    max_files: budget.files,
    subrequest_budget: budget.sub,
    ai_calls: 0, // invariant: this chunk performs zero Workers AI calls
    sources: {},
  };

  for (let k = 0; k < n; k++) {
    const source = SOURCES[(start + k) % n];
    if (only && source.key !== only) continue;
    if (budget.files <= 0 || budget.sub < 6) { summary.sources[source.key] = { status: 'deferred' }; continue; }
    try {
      summary.sources[source.key] = await processSource(env, source, budget);
    } catch (e) {
      summary.sources[source.key] = { status: 'error', error: String(e).slice(0, 300) };
    }
  }

  summary.files_remaining = budget.files;
  summary.subrequests_remaining = budget.sub;
  return summary;
}

// ---- embedding pass (chunk 3b) -------------------------------------------

// Priority-tier SQL fragments over doc_id (instr/substr only -- no LIKE, to
// avoid SQLite "pattern too complex"). P1 front-loads the table-heavy, high-value
// content; P3 is the long tail.
const TIER1_SQL = `(
  doc_id = 'graph-docs:concepts/permissions-reference.md'
  OR instr(doc_id, 'graph-docs:api-reference/') = 1
  OR (instr(doc_id, 'entra-docs:') = 1 AND (
       instr(doc_id, 'conditional-access') > 0 OR instr(doc_id, 'sign-in') > 0
       OR instr(doc_id, 'signin') > 0 OR instr(doc_id, 'app-registration') > 0
       OR instr(doc_id, 'register-app') > 0 OR instr(doc_id, 'enterprise-app') > 0
       OR instr(doc_id, 'authentication') > 0 OR instr(doc_id, 'identity-protection') > 0
       OR instr(doc_id, 'identity-platform') > 0))
)`;
const TIER3_SQL = `(instr(doc_id, 'entra-powershell-docs:') = 1 OR instr(doc_id, 'azure-docs-aad:') = 1)`;

function chunkNeurons(tokenCount) {
  return Math.ceil(Math.min(tokenCount, EMBED_MAX_TOKENS) / 1e6 * NEURONS_PER_MTOKEN);
}

// Deterministic 48-hex-char Vectorize id from the chunk_id (keeps ids short and
// valid regardless of how long the doc path is).
async function vectorId(chunkId) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(chunkId));
  return [...new Uint8Array(h)].slice(0, 24).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function loadEmbedBudget(env) {
  const today = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare("SELECT last_etag FROM sync_state WHERE source = '@embed'").first();
  if (row && row.last_etag) {
    try { const p = JSON.parse(row.last_etag); if (p.date === today) return p; } catch (_) { /* reset */ }
  }
  return { date: today, neurons: 0 };
}
async function saveEmbedBudget(env, st) {
  await env.DB.prepare(
    `INSERT INTO sync_state (source, last_run_at, last_cursor, last_etag, status)
     VALUES ('@embed', ?1, ?2, ?3, 'embedding')
     ON CONFLICT(source) DO UPDATE SET last_run_at = ?1, last_cursor = ?2, last_etag = ?3, status = 'embedding'`
  ).bind(Math.floor(Date.now() / 1000), st.date, JSON.stringify(st)).run();
}

// Pick the next batch of not-yet-embedded docs, highest priority tier first.
async function selectEmbedDocs(env, limit, budget) {
  const cols = 'doc_id, source, content_type, trust, layer';
  const tiers = [
    [1, `${cols} FROM documents WHERE embedded_at IS NULL AND ${TIER1_SQL} LIMIT ?`],
    [2, `${cols} FROM documents WHERE embedded_at IS NULL AND (instr(doc_id,'graph-docs:')=1 OR instr(doc_id,'entra-docs:')=1) AND NOT ${TIER1_SQL} LIMIT ?`],
    [3, `${cols} FROM documents WHERE embedded_at IS NULL AND ${TIER3_SQL} ORDER BY CASE WHEN instr(doc_id,'entra-powershell-docs:')=1 THEN 0 ELSE 1 END LIMIT ?`],
  ];
  for (const [tier, sql] of tiers) {
    budget.sub--;
    const r = await env.DB.prepare(`SELECT ${sql}`).bind(limit).all();
    if (r.results.length) return { tier, docs: r.results };
  }
  return { tier: null, docs: [] };
}

async function embedDoc(env, doc, now, budget, stat) {
  const r2Key = doc.doc_id.slice(doc.doc_id.indexOf(':') + 1);
  const fullKey = `${doc.source}/${r2Key}`;
  budget.sub--;
  const obj = await env.CORPUS.get(fullKey);
  if (!obj) { stat.missing = (stat.missing || 0) + 1; return; }
  const body = await obj.text();
  const meta = { doc_id: doc.doc_id, source: doc.source, trust: doc.trust, content_type: doc.content_type, layer: doc.layer, r2_key: fullKey };
  const chunks = chunkDocument(body, meta);

  budget.sub--;
  const existing = await env.DB.prepare('SELECT chunk_index FROM chunks WHERE doc_id = ?').bind(doc.doc_id).all();
  const done = new Set(existing.results.map((r) => r.chunk_index));
  const todo = chunks.filter((c) => !done.has(c.chunk_index));

  if (todo.length) {
    const texts = todo.map((c) => (c.token_count > EMBED_MAX_TOKENS ? c.text.slice(0, 2000) : c.text));
    budget.sub--;
    const emb = await env.AI.run(EMBED_MODEL, { text: texts });
    const vectors = emb.data;
    const vrows = [];
    const inserts = [];
    for (let i = 0; i < todo.length; i++) {
      const c = todo[i];
      const chunkId = `${c.doc_id}#${c.chunk_index}`;
      const vid = await vectorId(chunkId);
      const md = { trust: c.trust, source: c.source, content_type: c.content_type, layer: c.layer, doc_id: c.doc_id, chunk_index: c.chunk_index, r2_key: c.r2_key };
      if (c.oversized_code) md.oversized_code = '1';
      vrows.push({ id: vid, values: vectors[i], metadata: md });
      inserts.push(env.DB.prepare(
        `INSERT INTO chunks (chunk_id, doc_id, chunk_index, r2_key, vector_id, token_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(chunk_id) DO UPDATE SET vector_id = ?5, token_count = ?6`
      ).bind(chunkId, c.doc_id, c.chunk_index, c.r2_key, vid, c.token_count));
    }
    budget.sub--;
    await env.VECTORIZE.upsert(vrows);
    budget.sub--;
    await env.DB.batch(inserts);
    for (const c of todo) { const n = chunkNeurons(c.token_count); budget.neurons += n; stat.neurons += n; }
    stat.chunks += todo.length;
    if (todo.some((c) => c.oversized_code)) stat.oversized_code += todo.filter((c) => c.oversized_code).length;
  }
  // mark doc embedded (all its chunks now present)
  budget.sub--;
  await env.DB.prepare('UPDATE documents SET embedded_at = ? WHERE doc_id = ?').bind(now, doc.doc_id).run();
  stat.docs++;
}

async function runEmbedding(env, opts = {}) {
  const now = Math.floor(Date.now() / 1000);
  const dailyCap = opts.neuronBudget && opts.neuronBudget > 0 ? opts.neuronBudget : EMBED_NEURON_BUDGET;
  const budget = { sub: opts.subBudget && opts.subBudget > 0 ? opts.subBudget : EMBED_SUBREQUEST_BUDGET, neurons: 0 };
  const stat = { ai_model: EMBED_MODEL, tier: null, docs: 0, chunks: 0, neurons: 0, oversized_code: 0, status: 'ok' };

  budget.sub--;
  const st = await loadEmbedBudget(env);
  stat.date = st.date;
  stat.neurons_today_before = st.neurons;
  stat.daily_cap = dailyCap;
  if (st.neurons >= dailyCap) { stat.status = 'daily_budget_reached'; stat.neurons_today_after = st.neurons; return stat; }

  const sel = await selectEmbedDocs(env, opts.docs && opts.docs > 0 ? opts.docs : EMBED_DOCS_PER_RUN, budget);
  stat.tier = sel.tier;
  if (!sel.docs.length) { stat.status = 'all_embedded'; stat.neurons_today_after = st.neurons; return stat; }

  for (const doc of sel.docs) {
    if (budget.sub < 8) { stat.status = 'subrequest_budget'; break; }
    if (st.neurons + budget.neurons >= dailyCap) { stat.status = 'daily_budget_reached'; break; }
    try { await embedDoc(env, doc, now, budget, stat); }
    catch (e) { stat.errors = (stat.errors || 0) + 1; stat.last_error = String(e).slice(0, 200); }
  }

  st.neurons += budget.neurons;
  await saveEmbedBudget(env, st);
  stat.neurons_today_after = st.neurons;
  stat.subrequests_remaining = budget.sub;
  return stat;
}

// ---- retrieval / search (chunk 4) ----------------------------------------

// Normalize a query for the cache key: lowercase, trim, collapse whitespace.
function normalizeQuery(q) { return String(q || '').toLowerCase().trim().replace(/\s+/g, ' '); }

async function sha256hex(s) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Retrieval-only search: embed the query (cache-miss only), Vectorize search with
 * trust/source/content_type filters, trust re-rank (official > community), layer
 * post-filter, hydrate chunk text from R2 (re-chunked deterministically) + doc
 * citations from D1, and cache the ranked result list. NO LLM generation.
 */
async function runSearch(env, opts) {
  const query = String(opts.query || '').trim();
  if (!query) return { error: 'empty query', results: [] };
  const norm = normalizeQuery(query);
  const scope = ['official', 'community', 'both'].includes(opts.trust_scope) ? opts.trust_scope : 'both';
  let topK = parseInt(opts.top_k, 10);
  if (!Number.isFinite(topK) || topK < 1) topK = SEARCH_TOPK_DEFAULT;
  topK = Math.min(topK, SEARCH_TOPK_MAX);
  const f = { source: opts.source || '', content_type: opts.content_type || '', layer: opts.layer || '' };
  const now = Math.floor(Date.now() / 1000);

  const cacheKey = await sha256hex(`${norm}|${scope}|${f.source}|${f.content_type}|${f.layer}|${topK}`);

  // --- cache lookup (zero neurons on a fresh hit) ---
  const cached = await env.DB.prepare('SELECT answer, created_at FROM answer_cache WHERE question_hash = ?').bind(cacheKey).first();
  if (cached && (now - cached.created_at) <= SEARCH_CACHE_TTL_SECONDS) {
    await env.DB.prepare('UPDATE answer_cache SET hit_count = hit_count + 1 WHERE question_hash = ?').bind(cacheKey).run();
    try { return { ...JSON.parse(cached.answer), cache_hit: true, neurons: 0 }; } catch (_) { /* fall through to recompute */ }
  }

  // --- embed the query (~1 neuron) ---
  const emb = await env.AI.run(EMBED_MODEL, { text: [BGE_QUERY_INSTRUCTION + query] });
  const qvec = emb.data[0];
  const neurons = chunkNeurons(estimateTokens(query) + 10);

  // --- Vectorize search (indexed filters: trust, source, content_type) ---
  const vfilter = {};
  if (scope === 'official') vfilter.trust = { $eq: 'official' };
  else if (scope === 'community') vfilter.trust = { $eq: 'community' };
  if (f.source) vfilter.source = { $eq: f.source };
  if (f.content_type) vfilter.content_type = { $eq: f.content_type };
  const overFetch = Math.min(50, topK * (f.layer ? 4 : 2)); // overfetch for layer post-filter + re-rank
  const vres = await env.VECTORIZE.query(qvec, {
    topK: overFetch,
    returnMetadata: 'all',
    ...(Object.keys(vfilter).length ? { filter: vfilter } : {}),
  });
  let matches = vres.matches || [];
  if (f.layer) matches = matches.filter((m) => (m.metadata && m.metadata.layer) === f.layer);

  // --- trust re-rank: official outranks community at similar relevance ---
  for (const m of matches) m._eff = m.score + ((m.metadata && m.metadata.trust) === 'official' ? TRUST_BONUS : 0);
  matches.sort((a, b) => b._eff - a._eff);
  matches = matches.slice(0, topK);

  // --- hydrate (dedupe by doc): citations from D1 + chunk text from R2 ---
  const docIds = [...new Set(matches.map((m) => m.metadata.doc_id).filter(Boolean))];
  const docRows = {};
  if (docIds.length) {
    const ph = docIds.map(() => '?').join(',');
    const dr = await env.DB.prepare(`SELECT doc_id, source_url, license, attribution, trust, source, content_type, layer FROM documents WHERE doc_id IN (${ph})`).bind(...docIds).all();
    for (const r of dr.results) docRows[r.doc_id] = r;
  }
  const docChunks = {};
  for (const did of docIds) {
    const m = matches.find((x) => x.metadata.doc_id === did);
    const r2Key = m.metadata.r2_key;
    const obj = await env.CORPUS.get(r2Key);
    if (!obj) continue;
    const body = await obj.text();
    const dr = docRows[did] || {};
    docChunks[did] = chunkDocument(body, { doc_id: did, source: dr.source, trust: dr.trust, content_type: dr.content_type, layer: dr.layer, r2_key: r2Key });
  }

  const results = matches.map((m) => {
    const did = m.metadata.doc_id;
    const idx = m.metadata.chunk_index;
    const chunks = docChunks[did];
    const c = chunks && chunks[idx] ? chunks[idx] : null;
    const dr = docRows[did] || {};
    return {
      score: Math.round(m.score * 10000) / 10000,
      reranked_score: Math.round(m._eff * 10000) / 10000,
      trust: m.metadata.trust,
      layer: m.metadata.layer,
      source: m.metadata.source,
      content_type: m.metadata.content_type,
      doc_id: did,
      chunk_index: idx,
      doc_title: (c && c.frontmatter && c.frontmatter.title) || (c && c.headingTrail && c.headingTrail[0]) || did,
      heading: (c && c.heading) || '',
      snippet: c ? c.text.slice(0, 1200) : null,
      ...(m.metadata.oversized_code ? { oversized_code: true } : {}),
      citation: { source_url: dr.source_url || null, license: dr.license || null, attribution: dr.attribution || null },
    };
  });

  const payload = { query, normalized: norm, scope, top_k: topK, filters: f, count: results.length, results };

  // --- cache the ranked result list (NOT a generated answer) ---
  await env.DB.prepare(
    `INSERT INTO answer_cache (question_hash, answer, citations, created_at, hit_count)
     VALUES (?1, ?2, ?3, ?4, 0)
     ON CONFLICT(question_hash) DO UPDATE SET answer = ?2, citations = ?3, created_at = ?4, hit_count = 0`
  ).bind(cacheKey, JSON.stringify(payload), JSON.stringify(results.map((r) => r.citation)), now).run();

  return { ...payload, cache_hit: false, neurons };
}

export default {
  // Cron handler. The daily 06:00 UTC trigger runs the Tier-A ingestion reconcile
  // (lead source rotates by day-of-year). Any other (more frequent) cron runs the
  // embedding pass, which self-throttles against the daily neuron budget.
  async scheduled(event, env, ctx) {
    if (event.cron === '0 6 * * *') {
      const now = new Date();
      const dayOfYear = Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86400000);
      ctx.waitUntil(runIngestion(env, { startIndex: dayOfYear }));
    } else {
      ctx.waitUntil(runEmbedding(env));
    }
  },

  // Authenticated manual triggers (Bearer TRIGGER_SECRET):
  //   /run    -> ingestion (?source=&max=&sub=)
  //   /embed  -> embedding pass (?docs=&sub=&neurons= per-call daily-cap override)
  //   /search -> retrieval (GET ?q=&scope=&source=&content_type=&layer=&top_k=
  //              or POST JSON {query, trust_scope, source, content_type, layer, top_k})
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/run' && url.pathname !== '/embed' && url.pathname !== '/search') {
      return new Response('Not found', { status: 404 });
    }

    const auth = request.headers.get('Authorization') || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : (url.searchParams.get('key') || '');
    if (!env.TRIGGER_SECRET || provided !== env.TRIGGER_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    let summary;
    try {
    if (url.pathname === '/search') {
      let body = {};
      if (request.method === 'POST') { try { body = await request.json(); } catch (_) { body = {}; } }
      const q = url.searchParams;
      const opts = {
        query: body.query || q.get('q') || q.get('query') || '',
        trust_scope: body.trust_scope || q.get('scope') || q.get('trust_scope') || 'both',
        source: body.source || q.get('source') || '',
        content_type: body.content_type || q.get('content_type') || '',
        layer: body.layer || q.get('layer') || '',
        top_k: body.top_k || q.get('top_k') || '',
      };
      summary = await runSearch(env, opts);
    } else if (url.pathname === '/embed') {
      const opts = {};
      const docs = parseInt(url.searchParams.get('docs') || '', 10);
      if (Number.isFinite(docs) && docs > 0) opts.docs = docs;
      const sub = parseInt(url.searchParams.get('sub') || '', 10);
      if (Number.isFinite(sub) && sub > 0) opts.subBudget = sub;
      const neurons = parseInt(url.searchParams.get('neurons') || '', 10);
      if (Number.isFinite(neurons) && neurons > 0) opts.neuronBudget = neurons;
      summary = await runEmbedding(env, opts);
    } else {
      const opts = {};
      const max = parseInt(url.searchParams.get('max') || '', 10);
      if (Number.isFinite(max) && max > 0) opts.max = max;
      const sub = parseInt(url.searchParams.get('sub') || '', 10);
      if (Number.isFinite(sub) && sub > 0) opts.subBudget = sub;
      const src = url.searchParams.get('source');
      if (src) opts.source = src;
      summary = await runIngestion(env, opts);
    }
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e), stack: (e && e.stack) ? String(e.stack).slice(0, 600) : null }, null, 2), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify(summary, null, 2), { headers: { 'Content-Type': 'application/json' } });
  },
};
