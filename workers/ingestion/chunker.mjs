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
