/**
 * Entrapedia heading-aware chunker (chunk 3b).
 *
 * Pure function: a document body + its metadata in -> an array of chunk objects
 * out. NO DB writes, NO embedding, NO Workers AI. The embedding pass (3b-2)
 * feeds these chunks to bge-base.
 *
 * Strategy (see DESIGN.md sections 5-7):
 *  - Strip YAML frontmatter; keep useful fields as metadata.
 *  - Markdown: split on heading boundaries (H1-H3), target ~448 tokens, and
 *    NEVER let a chunk exceed maxTokens (the model's 512-token input limit) --
 *    except a single un-splittable oversized code block (flagged `oversized_code`,
 *    truncated to 512 at embed time; the full code stays intact in R2).
 *  - Tables over the limit are split by ROW-GROUPS with the header row(s)
 *    repeated on each piece, so no data row is ever sheared from its columns.
 *  - Merge a tiny trailing section into the previous chunk.
 *  - Keep the heading trail attached to each chunk for context.
 *  - .yml content docs: chunk by logical unit (top-level list entry).
 *
 * Token counting is injectable (opts.countTokens) so the dry run / embed pass can
 * pass a real bge-base tokenizer; the default is a fast WordPiece approximation.
 */

const DEFAULTS = { targetTokens: 448, minTokens: 256, maxTokens: 512, maxEmbedTokens: 512 };

// WordPiece approximation for bge-base (BERT uncased, ~30k vocab). Splits text
// into alphanumeric "words" and individual punctuation/symbols; words inflate by
// length (~len/4 subword pieces), punctuation counts ~1 token each. Tends to
// slightly OVER-count vs the real tokenizer (conservative for the 512 cap and
// for neuron budgeting).
export function estimateTokens(text) {
  if (!text) return 0;
  const atoms = text.match(/[A-Za-z0-9]+|[^\sA-Za-z0-9]/g);
  if (!atoms) return 0;
  let t = 0;
  for (const a of atoms) {
    if (a.length > 1 || /[A-Za-z0-9]/.test(a)) t += Math.max(1, Math.round(a.length / 4));
    else t += 1;
  }
  return t;
}

// ---- frontmatter ---------------------------------------------------------

export function stripFrontmatter(raw) {
  const m = raw.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { body: raw.replace(/^﻿/, ''), frontmatter: {} };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_.\-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { body: raw.slice(m[0].length), frontmatter: fm };
}

function pickFrontmatter(fm) {
  const keep = {};
  for (const k of ['title', 'description', 'ms.topic', 'ms.subservice', 'ms.service', 'author', 'keywords']) {
    if (fm[k]) keep[k] = fm[k];
  }
  return keep;
}

// ---- markdown block parsing ----------------------------------------------

function parseBlocks(body) {
  const lines = body.split(/\r?\n/);
  const blocks = [];
  let i = 0;
  let para = [];
  const flushPara = () => {
    if (para.length) { const text = para.join('\n').trim(); if (text) blocks.push({ type: 'text', text }); para = []; }
  };
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^(\s*)(```|~~~)/);
    if (fence) {
      flushPara();
      const marker = fence[2];
      const buf = [line]; i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) { buf.push(lines[i]); i++; }
      if (i < lines.length) { buf.push(lines[i]); i++; }
      blocks.push({ type: 'code', text: buf.join('\n') });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) { flushPara(); blocks.push({ type: 'heading', level: heading[1].length, title: heading[2].trim(), text: line }); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushPara();
      const buf = [line]; i++;
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') { buf.push(lines[i]); i++; }
      blocks.push({ type: 'table', text: buf.join('\n') });
      continue;
    }
    if (line.trim() === '') { flushPara(); i++; continue; }
    para.push(line); i++;
  }
  flushPara();
  return blocks;
}

function updateTrail(trail, block) {
  if (block.level > 3) return trail;
  const next = trail.filter((h) => h.level < block.level);
  next.push({ level: block.level, title: block.title });
  return next;
}
function trailText(trail) { return trail.map((h) => `${'#'.repeat(h.level)} ${h.title}`).join('\n'); }

// Split a too-large table by row-groups, repeating the header+separator on each
// piece so no row loses its column headers. Each piece stays under `limit`.
function splitTable(tableText, count, limit) {
  const lines = tableText.split('\n');
  let sepIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i]) && lines[i].includes('-')) { sepIdx = i; break; }
  }
  if (sepIdx < 1) return [tableText]; // unparseable; leave intact
  const headerText = lines.slice(0, sepIdx + 1).join('\n');
  const rows = lines.slice(sepIdx + 1).filter((l) => l.trim());
  const headerTok = count(headerText);
  const pieces = [];
  let group = [];
  let tok = headerTok;
  const flush = () => { if (group.length) { pieces.push(`${headerText}\n${group.join('\n')}`); group = []; tok = headerTok; } };
  for (const r of rows) {
    const rt = count(r);
    if (group.length && tok + rt > limit) flush();
    group.push(r); tok += rt;
  }
  flush();
  return pieces.length ? pieces : [tableText];
}

// Split an oversized non-code text block (e.g. a docfx blockquote that wraps code
// fences we can't treat atomically) by line-groups into pieces under `limit`.
function splitText(text, count, limit) {
  const lines = text.split('\n');
  const pieces = [];
  let group = [];
  let tok = 0;
  const flush = () => { if (group.length) { pieces.push(group.join('\n')); group = []; tok = 0; } };
  for (const ln of lines) {
    const lt = count(ln) || 1;
    if (group.length && tok + lt > limit) flush();
    group.push(ln); tok += lt;
  }
  flush();
  return pieces.length ? pieces : [text];
}

// ---- markdown chunking ---------------------------------------------------

// Tokens reserved for the heading trail prepended to each chunk's text, so the
// final text (heading + content) stays under the cap.
const HEADING_RESERVE = 96;

function chunkMarkdown(body, meta, opts) {
  const { minTokens, maxTokens, maxEmbedTokens } = opts;
  const count = opts.countTokens;
  const contentCap = maxTokens - HEADING_RESERVE; // budget for content (heading added on top)

  // Pre-expand tables whose content would not fit (with a heading on top) into
  // isolated row-group pieces.
  const raw = parseBlocks(body);
  const blocks = [];
  for (const b of raw) {
    if (b.type === 'table' && count(b.text) > contentCap) {
      for (const piece of splitTable(b.text, count, contentCap - 8)) blocks.push({ type: 'tablepiece', text: piece, isolate: true });
      continue;
    }
    // Oversized non-code text (e.g. a blockquote-wrapped quickstart): split by
    // line-groups so no single unsplittable text block blows the 512 cap.
    if (b.type === 'text' && count(b.text) > contentCap) {
      for (const piece of splitText(b.text, count, contentCap)) blocks.push({ type: 'text', text: piece });
      continue;
    }
    blocks.push(b);
  }

  const chunks = [];
  let trail = [];
  let cur = null;
  const startChunk = (t) => ({ trail: t.slice(), headingTok: count(trailText(t)), parts: [], tokens: 0, flags: new Set(), oversized_code: false });
  const emit = () => {
    if (!cur) return;
    const sectionText = cur.parts.join('\n\n').trim();
    if (!sectionText) { cur = null; return; }
    const heading = trailText(cur.trail);
    const text = heading ? `${heading}\n\n${sectionText}` : sectionText;
    chunks.push({ heading, headingTrail: cur.trail.map((h) => h.title), text, token_count: count(text), oversized_code: cur.oversized_code, flags: [...cur.flags] });
    cur = null;
  };

  for (const b of blocks) {
    if (b.type === 'heading') {
      trail = updateTrail(trail, b);
      if (cur && cur.tokens >= minTokens) emit();
      if (!cur) cur = startChunk(trail);
      else { cur.trail = trail.slice(); cur.headingTok = count(trailText(trail)); }
      continue;
    }
    if (b.isolate) { // an oversized-table row-group piece: stands alone
      if (cur && cur.tokens > 0) emit();
      cur = startChunk(trail);
      cur.parts.push(b.text); cur.tokens += count(b.text); cur.flags.add('table_rowgroup');
      emit();
      continue;
    }
    const btok = count(b.text);
    if (!cur) cur = startChunk(trail);
    // Hard cap including the heading trail: never let final text exceed maxTokens
    // by adding a block (a single block over the cap is handled below).
    if (cur.tokens > 0 && cur.headingTok + cur.tokens + btok > maxTokens) { emit(); cur = startChunk(trail); }
    cur.parts.push(b.text); cur.tokens += btok;
    if (b.type === 'code' && btok > maxEmbedTokens) { cur.oversized_code = true; cur.flags.add('oversized_code'); }
    else if (b.type === 'table' && btok > maxEmbedTokens) { cur.flags.add('oversized_table'); }
  }
  emit();

  // Orphan merge: fold a too-small trailing chunk into its predecessor (unless
  // that would push the predecessor over the cap).
  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1];
    const prev = chunks[chunks.length - 2];
    if (last.token_count < minTokens && !last.oversized_code && prev.token_count + last.token_count <= maxTokens) {
      prev.text = `${prev.text}\n\n${last.text.replace(/^#.*\n\n?/, '')}`.trim();
      prev.token_count = count(prev.text);
      prev.flags = [...new Set([...prev.flags, ...last.flags, 'merged_orphan'])];
      chunks.pop();
    }
  }
  return chunks;
}

// ---- yml chunking (by logical unit) --------------------------------------

function chunkYml(body, meta, opts) {
  const count = opts.countTokens;
  const lines = body.split(/\r?\n/);
  const units = [];
  let buf = [];
  for (const line of lines) { if (/^- /.test(line) && buf.length) { units.push(buf.join('\n')); buf = [line]; } else buf.push(line); }
  if (buf.length) units.push(buf.join('\n'));
  const cleaned = units.map((u) => u.trim()).filter(Boolean);
  const base = cleaned.length ? cleaned : [body.trim()];
  // Split any unit that exceeds the cap (e.g. a big landing-page yml section).
  const src = [];
  for (const u of base) {
    if (count(u) > opts.maxTokens) for (const piece of splitText(u, count, opts.maxTokens - 16)) src.push(piece);
    else src.push(u);
  }
  return src.map((text) => ({ heading: '', headingTrail: [], text, token_count: count(text), oversized_code: false, flags: ['yml_unit'] }));
}

// ---- structured-reference chunking: permissions-reference (chunk 4) -------
//
// One-permission-per-chunk parser for the Microsoft Graph permissions-reference
// page. Each `### <PermissionName>` section (its own attribute table) becomes
// exactly ONE chunk carrying its own heading -- never a sibling's. This fixes the
// merge-multiple-permissions-per-chunk defect that (a) flattened structurally
// identical permission rows and (b) presented a least-privilege permission under
// its over-privileged sibling's heading. Permission-name + GUIDs + a privilege
// ordinal are extracted as per-chunk metadata for identifier-aware matching and a
// least-privilege re-rank. SCOPED to permissions-reference only (see
// STRUCTURED_TABLE_DOCS in the worker); prose docs keep the generic chunker.

// Privilege ordinal from the action segment of a permission name
// (Resource.Action[.Constraint]). Heuristic, within-family ordering only: it lets
// a least-privilege query prefer the narrower permission. True per-operation least
// privilege lives in the api-reference method pages (a later RAG pass), NOT here.
export function privRank(action) {
  const a = String(action || '').toLowerCase();
  if (a.includes('readbasic')) return 0;
  if (a === 'read') return 1;
  if (a === 'send' || a === 'create' || a === 'add') return 2;
  if (a === 'readwrite') return 3;
  if (a === 'manage' || a === 'fullcontrol') return 4;
  return 2; // unknown action -> mid (flagged priv_unknown on the chunk)
}

// Parse one permission section's attribute table. Returns the permission metadata
// or null if the block has no Identifier row (not a permission).
function parsePermissionBlock(name, blockLines) {
  const idRows = blockLines.filter((l) => /^\s*\|\s*Identifier\s*\|/i.test(l));
  if (idRows.length === 0) return null;                 // not a permission
  if (idRows.length > 1) {                              // the old merge bug -- fail loud
    throw new Error(`permissions-reference: section "${name}" has ${idRows.length} Identifier rows (merged permissions); aborting`);
  }
  const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const cellsOf = (line) => line.split('|').map((c) => c.trim());
  const idc = cellsOf(idRows[0]); // ['', 'Identifier', <app>, <delegated>, '']
  const appG = (idc[2] && GUID.test(idc[2])) ? idc[2].match(GUID)[0].toLowerCase() : null;
  const delG = (idc[3] && GUID.test(idc[3])) ? idc[3].match(GUID)[0].toLowerCase() : null;
  const principal = (appG && delG) ? 'both' : (appG ? 'application' : (delG ? 'delegated' : 'unknown'));
  const dispRow = blockLines.find((l) => /^\s*\|\s*DisplayText\s*\|/i.test(l));
  let display_text = '';
  if (dispRow) { const dc = cellsOf(dispRow); display_text = (dc[2] && dc[2] !== '-') ? dc[2] : (dc[3] || ''); }
  const segs = name.split('.');
  const family = segs[0] || '';
  const action = segs[1] || '';
  const pr = privRank(action);
  const known = ['readbasic', 'read', 'send', 'create', 'add', 'readwrite', 'manage', 'fullcontrol'];
  const flags = [];
  if (!known.includes(String(action).toLowerCase())) flags.push('priv_unknown');
  return {
    app_guid: appG, delegated_guid: delG, principal,
    family, action, priv_rank: pr, scope_all: name.endsWith('.All') ? 1 : 0,
    display_text, flags,
  };
}

// Parse the permissions-reference body into ordered chunks: one per permission
// (kind 'perm', name-keyed) plus prose gaps (kind 'prose', positional). chunk_index
// is the document-order position; `suffix` builds the chunk_id namespace in the
// worker (perm=<Name> / sec=<index>) so name-keyed ids never collide with the old
// positional ids during the swap.
export function chunkPermissionsReference(rawBody, meta, opts = {}) {
  const o = { ...DEFAULTS, ...opts, countTokens: opts.countTokens || estimateTokens };
  const count = o.countTokens;
  let { body, frontmatter } = stripFrontmatter(rawBody || '');
  body = body.replace(/<!--[\s\S]*?-->/g, '');
  const fm = pickFrontmatter(frontmatter);
  const lines = body.split(/\r?\n/);

  const out = [];
  let h1 = '', h2 = '';
  let prose = [];
  const trail = () => [h1 && `# ${h1}`, h2 && `## ${h2}`].filter(Boolean);
  const flushProse = () => {
    const text = prose.join('\n').trim();
    prose = [];
    if (!text) return;
    const heading = trail().join('\n');
    out.push({ kind: 'prose', name: null, heading, headingTrail: trail().map((t) => t.replace(/^#+ /, '')), text: heading ? `${heading}\n\n${text}` : text });
  };

  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) {
      const level = m[1].length;
      const title = m[2].trim();
      if (level === 1) { flushProse(); h1 = title; i++; continue; }
      if (level === 2) { flushProse(); h2 = title; i++; continue; }
      if (level === 3) {
        flushProse();
        const name = title;
        const blockLines = [];
        i++;
        while (i < lines.length && !/^#{1,3}\s/.test(lines[i])) { blockLines.push(lines[i]); i++; }
        const perm = parsePermissionBlock(name, blockLines);
        const headingTrail = [...trail(), `### ${name}`];
        const heading = headingTrail.join('\n');
        const bodyText = blockLines.join('\n').trim();
        const text = `${heading}\n\n${bodyText}`.trim();
        if (!perm) { // defensive: treat a non-permission ### as prose, flagged
          out.push({ kind: 'prose', name: null, heading, headingTrail: headingTrail.map((t) => t.replace(/^#+ /, '')), text, flags: ['not_a_permission'] });
          continue;
        }
        out.push({ kind: 'perm', name, heading, headingTrail: headingTrail.map((t) => t.replace(/^#+ /, '')), text, ...perm });
        continue;
      }
      // level > 3: fold into prose
      prose.push(lines[i]); i++; continue;
    }
    prose.push(lines[i]); i++;
  }
  flushProse();

  return out.map((c, idx) => ({
    doc_id: meta.doc_id,
    chunk_index: idx,
    suffix: c.kind === 'perm' ? `perm=${c.name}` : `sec=${idx}`,
    kind: c.kind,
    source: meta.source,
    trust: meta.trust,
    content_type: meta.content_type,
    layer: meta.layer,
    r2_key: meta.r2_key,
    heading: c.heading,
    headingTrail: c.headingTrail,
    frontmatter: fm,
    token_count: count(c.text),
    oversized_code: false,
    oversized: count(c.text) > o.maxEmbedTokens,
    text: c.text,
    flags: c.flags || [],
    // permission metadata (null for prose chunks)
    perm_name: c.kind === 'perm' ? c.name : null,
    app_guid: c.app_guid || null,
    delegated_guid: c.delegated_guid || null,
    principal: c.principal || null,
    family: c.family || null,
    action: c.action || null,
    priv_rank: (c.priv_rank !== undefined ? c.priv_rank : null),
    scope_all: (c.scope_all !== undefined ? c.scope_all : null),
    display_text: c.display_text || null,
  }));
}

// ---- entry point ---------------------------------------------------------

export function chunkDocument(rawBody, meta, opts = {}) {
  const o = { ...DEFAULTS, ...opts, countTokens: opts.countTokens || estimateTokens };
  let { body, frontmatter } = stripFrontmatter(rawBody || '');
  // Strip HTML comments (docfx build metadata such as <!--{ "blockType": ... }-->):
  // non-content noise that would otherwise embed as oversized junk chunks.
  body = body.replace(/<!--[\s\S]*?-->/g, '');
  const fm = pickFrontmatter(frontmatter);
  const isYml = (meta.doc_id || meta.r2_key || '').toLowerCase().endsWith('.yml');
  const raw = isYml ? chunkYml(body, meta, o) : chunkMarkdown(body, meta, o);
  return raw.map((c, idx) => ({
    doc_id: meta.doc_id,
    chunk_index: idx,
    source: meta.source,
    trust: meta.trust,
    content_type: meta.content_type,
    layer: meta.layer,
    r2_key: meta.r2_key,
    heading: c.heading,
    headingTrail: c.headingTrail,
    frontmatter: fm,
    token_count: c.token_count,
    oversized_code: c.oversized_code,
    text: c.text,
    flags: c.flags,
  }));
}

export default chunkDocument;
