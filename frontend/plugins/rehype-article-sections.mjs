// rehype plugin: badge each article H2 as AUTHORED or CITED (per the seven-section
// model) so the curated-vs-grounded split is visible. Adds data-kind to the <h2>
// and prepends a small badge span. No external unist dep -- a manual hast walk.
import { SECTION_KIND } from '../src/lib/sections.mjs';

function textOf(node) {
  if (node.type === 'text') return node.value;
  return (node.children || []).map(textOf).join('');
}

export default function rehypeArticleSections() {
  return (tree) => walk(tree);
}

function walk(node) {
  if (node && node.type === 'element' && node.tagName === 'h2') {
    const t = textOf(node).toLowerCase().replace(/\s+/g, ' ').trim().replace(/\s*\(.*\)\s*$/, '');
    const kind = SECTION_KIND[t];
    if (kind) {
      node.properties = node.properties || {};
      node.properties.dataKind = kind; // -> data-kind
      node.children.unshift({
        type: 'element', tagName: 'span',
        properties: { className: ['sec-badge', 'k-' + kind] },
        children: [{ type: 'text', value: kind === 'cited' ? 'cited / grounded' : 'authored' }],
      });
    }
  }
  (node.children || []).forEach(walk);
}
