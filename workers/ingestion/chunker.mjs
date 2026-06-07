/**
 * Entrapedia heading-aware chunker (chunk 3b).
 *
 * Pure function: a document body + its metadata in -> an array of chunk objects
 * out. NO DB writes, NO embedding, NO Workers AI. Phase 3b-1 runs this as a dry
 * run for measurement; phase 3b-2 will embed the chunks it produces.
 *
 * Strategy (see DESIGN.md sections 5-7):
 *  - Strip YAML frontmatter from the body; keep useful fields as metadata.
 *  - Markdown: split on heading boundaries (H1-H3), target ~512 tokens with a
 *    ~256-640 range, and NEVER split inside a fenced code block or a table.
 *  - Merge a tiny trailing section into the previous chunk (no near-empty chunks).
 *  - Keep the section's heading trail attached to each chunk for context.
 *  - .yml content docs: chunk by logical unit (top-level list entry) instead of
 *    by heading.
 *
 * Token counting is injectable (opts.countTokens) so the dry run can pass a real
 * bge-base tokenizer while the default is a fast WordPiece approximation.
 */

const DEFAULTS = { targetTokens: 512, minTokens: 256, maxTokens: 640 };

// WordPiece approximation for bge-base (BERT uncased, ~30k vocab). Splits text
// into alphanumeric "words" and individual punctuation/symbols; words inflate by
// length (~len/4 subword pieces), punctuation counts ~1 token each. This tends
// to slightly OVER-count vs the real tokenizer (conservative for budgeting).
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

// Strip a leading '---\n ... \n---' YAML block; return { body, frontmatter }.
// Parses only simple top-level "key: value" scalars (no nested structures).
export function stripFrontmatter(raw) {
  const m = raw.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { body: raw.replace(/^﻿/, ''), frontmatter: {} };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_.\-]+):\s*(.*)$/);
    if (kv) {
      let v = kv[2].trim().replace(/^["']|["']$/g, '');
      fm[kv[1]] = v;
    }
  }
  return { body: raw.slice(m[0].length), frontmatter: fm };
}

// Pull the fields we care about (others are ignored to avoid embedding noise).
function pickFrontmatter(fm) {
  const keep = {};
  for (const k of ['title', 'description', 'ms.topic', 'ms.subservice', 'ms.service', 'author', 'keywords']) {
    if (fm[k]) keep[k] = fm[k];
  }
  return keep;
}

// ---- markdown block parsing ----------------------------------------------

// Parse a markdown body into atomic blocks. Fenced code blocks and tables are
// single, never-split blocks.
function parseBlocks(body) {
  const lines = body.split(/\r?\n/);
  const blocks = [];
  let i = 0;
  let para = [];
  const flushPara = () => {
    if (para.length) {
      const text = para.join('\n').trim();
      if (text) blocks.push({ type: 'text', text });
      para = [];
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^(\s*)(```|~~~)/);
    if (fence) {
      flushPara();
      const marker = fence[2];
      const buf = [line];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) { buf.push(lines[i]); i++; }
      if (i < lines.length) { buf.push(lines[i]); i++; }
      blocks.push({ type: 'code', text: buf.join('\n') });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushPara();
      blocks.push({ type: 'heading', level: heading[1].length, title: heading[2].trim(), text: line });
      i++;
      continue;
    }
    // table: a row with '|' immediately followed by a separator row of |---|.
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushPara();
      const buf = [line];
      i++;
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') { buf.push(lines[i]); i++; }
      blocks.push({ type: 'table', text: buf.join('\n') });
      continue;
    }
    if (line.trim() === '') { flushPara(); i++; continue; }
    para.push(line);
    i++;
  }
  flushPara();
  return blocks;
}

// Maintain an H1-H3 heading trail (deeper headings reset on a higher one).
function updateTrail(trail, block) {
  if (block.level > 3) return trail; // only H1-H3 drive section context
  const next = trail.filter((h) => h.level < block.level);
  next.push({ level: block.level, title: block.title });
  return next;
}

function trailText(trail) {
  return trail.map((h) => `${'#'.repeat(h.level)} ${h.title}`).join('\n');
}

// ---- markdown chunking ---------------------------------------------------

function chunkMarkdown(body, meta, opts) {
  const { minTokens, maxTokens } = opts;
  const count = opts.countTokens;
  const blocks = parseBlocks(body);

  const chunks = [];
  let trail = [];
  let cur = null; // { trail, parts: [], tokens, flags:Set }
  const startChunk = (t) => ({ trail: t.slice(), parts: [], tokens: 0, flags: new Set() });

  const emit = () => {
    if (!cur) return;
    const sectionText = cur.parts.join('\n\n').trim();
    if (!sectionText) { cur = null; return; }
    const heading = trailText(cur.trail);
    const text = heading ? `${heading}\n\n${sectionText}` : sectionText;
    chunks.push({
      heading,
      headingTrail: cur.trail.map((h) => h.title),
      text,
      token_count: count(text),
      flags: [...cur.flags],
    });
    cur = null;
  };

  for (const b of blocks) {
    if (b.type === 'heading') {
      trail = updateTrail(trail, b);
      // Heading boundary: close the current chunk only if it is already a
      // worthwhile size; otherwise keep accumulating (merges tiny sections).
      if (cur && cur.tokens >= minTokens) emit();
      if (!cur) cur = startChunk(trail);
      else cur.trail = trail.slice(); // adopt deeper heading context going forward
      continue;
    }
    const btok = count(b.text);
    if (!cur) cur = startChunk(trail);
    if (cur.tokens > 0 && cur.tokens + btok > maxTokens && cur.tokens >= minTokens) {
      emit();
      cur = startChunk(trail);
    }
    cur.parts.push(b.text);
    cur.tokens += btok;
    if ((b.type === 'code' || b.type === 'table') && btok > maxTokens) {
      cur.flags.add(b.type === 'code' ? 'oversized_code_block' : 'oversized_table');
    }
  }
  emit();

  // Orphan merge: fold a too-small trailing chunk into its predecessor.
  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1];
    if (last.token_count < minTokens) {
      const prev = chunks[chunks.length - 2];
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
  // Split on top-level list entries ("- " at column 0). Falls back to the whole
  // doc as one chunk when there is no such structure.
  const lines = body.split(/\r?\n/);
  const units = [];
  let buf = [];
  for (const line of lines) {
    if (/^- /.test(line) && buf.length) { units.push(buf.join('\n')); buf = [line]; }
    else buf.push(line);
  }
  if (buf.length) units.push(buf.join('\n'));
  const cleaned = units.map((u) => u.trim()).filter(Boolean);
  const source = cleaned.length ? cleaned : [body.trim()];
  return source.map((text) => ({
    heading: '',
    headingTrail: [],
    text,
    token_count: count(text),
    flags: ['yml_unit'],
  }));
}

// ---- entry point ---------------------------------------------------------

/**
 * chunkDocument(rawBody, meta, opts) -> chunk[]
 * meta: { doc_id, source, trust, content_type, layer, r2_key }
 * opts: { targetTokens, minTokens, maxTokens, countTokens }
 * Each returned chunk: { doc_id, chunk_index, source, trust, content_type,
 *   layer, r2_key, heading, headingTrail, frontmatter, token_count, text, flags }
 */
export function chunkDocument(rawBody, meta, opts = {}) {
  const o = { ...DEFAULTS, ...opts, countTokens: opts.countTokens || estimateTokens };
  const { body, frontmatter } = stripFrontmatter(rawBody || '');
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
    text: c.text,
    flags: c.flags,
  }));
}

export default chunkDocument;
