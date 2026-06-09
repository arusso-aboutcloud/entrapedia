// Doc proxy (Cloudflare Pages Function).
//
// Renders a corpus document for the doc page. doc_id is `{source}:{path}`. The
// content is fetched SERVER-SIDE from the document's PUBLIC GitHub source (the
// same source we attribute and cite) and rendered to sanitized HTML. This needs
// no secret (public content) and does NOT touch the retrieval API / R2 / worker.
// Edge-cached. Large docs are size-capped (noted as truncated).

const SOURCES = {
  'entra-docs': { owner: 'MicrosoftDocs', repo: 'entra-docs', branch: 'main', trust: 'official', layer: 'current', license: 'MIT', attribution: 'Microsoft Docs - MicrosoftDocs/entra-docs (MIT)', label: 'Microsoft Entra documentation' },
  'entra-powershell-docs': { owner: 'MicrosoftDocs', repo: 'entra-powershell-docs', branch: 'main', trust: 'official', layer: 'current', license: 'MIT', attribution: 'Microsoft Docs - MicrosoftDocs/entra-powershell-docs (MIT)', label: 'Microsoft Entra PowerShell documentation' },
  'graph-docs': { owner: 'microsoftgraph', repo: 'microsoft-graph-docs-contrib', branch: 'main', trust: 'official', layer: 'current', license: 'CC-BY-4.0', attribution: 'Microsoft Graph docs - microsoftgraph/microsoft-graph-docs-contrib (CC-BY-4.0)', label: 'Microsoft Graph documentation' },
  'azure-docs-aad': { owner: 'MicrosoftDocs', repo: 'azure-docs', branch: 'main', trust: 'official', layer: 'legacy', license: 'CC-BY-4.0', attribution: 'Microsoft Azure docs - MicrosoftDocs/azure-docs (CC-BY-4.0)', label: 'Azure documentation (Azure AD heritage)' },
};

const MAX_BYTES = 60_000; // cap render size for very large pages
const DOC_TTL = 3600;

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function safeHref(u) {
  const s = String(u || '').trim();
  if (/^https?:\/\//i.test(s) || s.startsWith('/') || s.startsWith('#') || /^mailto:/i.test(s)) return s;
  return '#';
}

// Inline markdown on ALREADY-ESCAPED text: code spans, bold, italic, links.
function inline(t) {
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (_, txt, href) => `<a href="${esc(safeHref(href))}" target="_blank" rel="noopener">${txt}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return t;
}

// Minimal, safe block renderer for the docfx-flavoured markdown in the corpus.
function renderMarkdown(md) {
  // strip YAML frontmatter, HTML comments, docfx :::triple::: containers, INCLUDE refs
  md = md.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  md = md.replace(/<!--[\s\S]*?-->/g, '');
  md = md.replace(/^\s*:::.*$/gm, '');
  md = md.replace(/\[!INCLUDE\s*\[[^\]]*\]\([^)]*\)\]/g, '');
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0, para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(esc(para.join(' ')))}</p>`); para = []; } };

  while (i < lines.length) {
    let line = lines[i];

    // fenced code
    const fence = line.match(/^\s*(```|~~~)(.*)$/);
    if (fence) {
      flushPara();
      const buf = []; i++;
      while (i < lines.length && !lines[i].match(/^\s*(```|~~~)\s*$/)) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    // heading
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) { flushPara(); const lv = Math.min(h[1].length, 4); out.push(`<h${lv}>${inline(esc(h[2].trim()))}</h${lv}>`); i++; continue; }
    // hr
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushPara(); out.push('<hr>'); i++; continue; }
    // gfm table
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushPara();
      const rowCells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const header = rowCells(line); i += 2;
      const body = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) { body.push(rowCells(lines[i])); i++; }
      let tbl = '<table><thead><tr>' + header.map((c) => `<th>${inline(esc(c))}</th>`).join('') + '</tr></thead><tbody>';
      for (const r of body) tbl += '<tr>' + r.map((c) => `<td>${inline(esc(c))}</td>`).join('') + '</tr>';
      out.push(tbl + '</tbody></table>');
      continue;
    }
    // blockquote (incl. docfx > [!NOTE]/[!WARNING] alerts)
    if (/^\s*>/.test(line)) {
      flushPara();
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      let inner = buf.join(' ').replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, (_, k) => `<strong>${esc(k.toUpperCase())}:</strong> `);
      out.push(`<blockquote>${inline(esc(inner)).replace(/&amp;lt;strong&amp;gt;/g,'')}</blockquote>`);
      continue;
    }
    // lists
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      flushPara();
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '')); i++; }
      out.push(`<${ordered ? 'ol' : 'ul'}>` + items.map((t) => `<li>${inline(esc(t))}</li>`).join('') + `</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (line.trim() === '') { flushPara(); i++; continue; }
    para.push(line.trim()); i++;
  }
  flushPara();
  return out.join('\n');
}

// Core: resolve + fetch + render a doc_id into a payload. Pure-ish (only global
// fetch); reused by onRequest and by the local screenshot server. Returns
// { status, payload }.
export async function buildDoc(id) {
  id = String(id || '').trim();
  if (!id || !id.includes(':')) return { status: 400, payload: { error: 'bad_id' } };
  const key = id.slice(0, id.indexOf(':'));
  const path = id.slice(id.indexOf(':') + 1);
  const src = SOURCES[key];
  if (!src || !path || path.includes('..')) return { status: 404, payload: { error: 'unknown_source', detail: key } };

  const rawUrl = `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${src.branch}/${path}`;
  const blobUrl = `https://github.com/${src.owner}/${src.repo}/blob/${src.branch}/${path}`;
  let res;
  try { res = await fetch(rawUrl, { headers: { 'user-agent': 'entrapedia-frontend' } }); }
  catch (e) { return { status: 502, payload: { error: 'source_unreachable' } }; }
  if (!res.ok) return { status: res.status === 404 ? 404 : 502, payload: { error: 'source_not_found', status: res.status, source_url: blobUrl } };

  let md = await res.text();
  let truncated = false;
  if (md.length > MAX_BYTES) { md = md.slice(0, MAX_BYTES); truncated = true; }

  let title = '';
  const fm = md.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) { const tm = fm[1].match(/^title:\s*(.+)$/m); if (tm) title = tm[1].trim().replace(/^["']|["']$/g, ''); }
  if (!title) { const hm = md.match(/^#\s+(.+)$/m); if (hm) title = hm[1].trim(); }
  if (!title) title = path.split('/').pop();

  let html = renderMarkdown(md);
  if (truncated) html += '<p class="notice">// document truncated for rendering — full content at the source link below.</p>';

  return {
    status: 200,
    payload: {
      ok: true, doc_id: id, source: key, source_label: src.label,
      trust: src.trust, layer: src.layer, title, html,
      citation: { source_url: blobUrl, license: src.license, attribution: src.attribution },
      truncated,
    },
  };
}

export async function onRequest(context) {
  const { request, waitUntil } = context;
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/api/doc?id=${encodeURIComponent(id)}`, { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) { const r = new Response(hit.body, hit); r.headers.set('x-entrapedia-cache', 'edge-hit'); return r; }

  const { status, payload } = await buildDoc(id);
  if (status !== 200) return json(payload, status);

  const out = new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${DOC_TTL}`, 'x-entrapedia-cache': 'miss' },
  });
  waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}
