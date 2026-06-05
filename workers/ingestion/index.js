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
 * Tree truncation: the GitHub Git Trees API truncates large recursive trees
 * (~100k entries / 7MB). microsoft-graph-docs-contrib exceeds it. We therefore
 * "descend on truncation": one recursive tree call per directory, and only when
 * a directory comes back `truncated` do we list it non-recursively and enqueue
 * its child directories. The pending-directory frontier is persisted in
 * sync_state.last_etag so a capped run resumes the walk -- no hardcoded content
 * paths, self-maintaining against upstream reorg.
 *
 * Secrets (NOT committed; set via `wrangler secret put`):
 *   GITHUB_TOKEN   - GitHub token (public-repo read is sufficient). Sent as a
 *                    Bearer token on GitHub API + raw.githubusercontent calls to
 *                    lift the unauthenticated 60/hr rate limit.
 *   TRIGGER_SECRET - shared secret guarding the manual POST/GET /run trigger.
 */

// ---- tunable run budgets -------------------------------------------------

// Per-run changed-file cap (bodies fetched + stored per invocation). TUNABLE.
const MAX_FILES_PER_RUN = 25;

// Hard ceiling on subrequests per invocation. fetch(), R2, and D1 calls each
// count as one subrequest. Workers Free allows 50 subrequests/request; we stay
// under it and let the resumable walk continue next run. Raise on Workers Paid
// (1000). TUNABLE.
const SUBREQUEST_BUDGET = 45;

// A directory whose recursive listing exceeds this many entries is descended
// per-subdirectory (like a truncated tree) instead of filtered whole every run.
// This bounds per-run CPU so we stay under the Workers Free CPU-time limit
// (error 1102) on repos with very large directories. TUNABLE.
const LARGE_TREE = 1200;

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

async function loadKnownHashes(env, sourceKey, budget) {
  budget.sub--;
  const { results } = await env.DB.prepare(
    'SELECT doc_id, content_hash FROM documents WHERE source = ?'
  ).bind(sourceKey).all();
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

  const known = await loadKnownHashes(env, source.key, budget);

  // Walk the directory frontier, fetching changed blobs as we discover them.
  while (ws.frontier.length > 0 && budget.files > 0 && budget.sub > 4) {
    const dir = ws.frontier[0];
    const t = await ghJson(env, treeUrl(source, dir.sha, true), budget);

    let blobs = [];
    let subdirs = [];
    // Descend per-subdirectory when the tree is truncated OR simply too large to
    // filter whole each run (CPU bound). Either way we list this level
    // non-recursively and enqueue child directories.
    if (t.truncated || (Array.isArray(t.tree) && t.tree.length > LARGE_TREE)) {
      const t2 = await ghJson(env, treeUrl(source, dir.sha, false), budget);
      for (const e of t2.tree) {
        if (e.type === 'blob') blobs.push({ path: dir.prefix + e.path, sha: e.sha });
        else if (e.type === 'tree') subdirs.push({ sha: e.sha, prefix: dir.prefix + e.path + '/' });
      }
    } else {
      for (const e of t.tree) if (e.type === 'blob') blobs.push({ path: dir.prefix + e.path, sha: e.sha });
    }
    stat.examined += blobs.length;

    const changed = blobs.filter(
      (b) => inScope(source, b.path) && known.get(`${source.key}:${b.path}`) !== b.sha
    );

    let completedDir = true;
    for (const b of changed) {
      if (budget.files <= 0 || budget.sub < 4) { completedDir = false; break; }
      const body = await fetchBody(env, source, branch, b.path, budget);
      const existed = known.has(`${source.key}:${b.path}`);
      await storeDoc(env, source, branch, b, body, now, budget);
      known.set(`${source.key}:${b.path}`, b.sha);
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

export default {
  // Daily Tier-A reconcile (cron expression lives in wrangler.toml). The lead
  // source rotates by day-of-year so every source gets the budget over time;
  // each resumes its own sync_state frontier.
  async scheduled(event, env, ctx) {
    const now = new Date();
    const dayOfYear = Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86400000);
    ctx.waitUntil(runIngestion(env, { startIndex: dayOfYear }));
  },

  // Authenticated manual trigger: POST/GET /run with Bearer TRIGGER_SECRET.
  // Optional query params: ?source=<key>&max=<n>&sub=<n>. No other path is served.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/run') return new Response('Not found', { status: 404 });

    const auth = request.headers.get('Authorization') || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : (url.searchParams.get('key') || '');
    if (!env.TRIGGER_SECRET || provided !== env.TRIGGER_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    const opts = {};
    const max = parseInt(url.searchParams.get('max') || '', 10);
    if (Number.isFinite(max) && max > 0) opts.max = max;
    const sub = parseInt(url.searchParams.get('sub') || '', 10);
    if (Number.isFinite(sub) && sub > 0) opts.subBudget = sub;
    const src = url.searchParams.get('source');
    if (src) opts.source = src;

    const summary = await runIngestion(env, opts);
    return new Response(JSON.stringify(summary, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
