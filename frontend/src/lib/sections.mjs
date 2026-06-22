// The seven-section article model (DESIGN.md 3.2), split into AUTHORED (the
// curator's editorial voice) and CITED (corpus-grounded, every claim carries a
// citation). Section order is canonical; the rehype plugin badges each H2 by
// matching its (lowercased, parenthetical-stripped) text against `key`.
export const SECTIONS = [
  { key: 'what it is', title: 'What it is', kind: 'authored' },
  { key: 'why it matters', title: 'Why it matters', kind: 'authored' },
  { key: 'how it relates', title: 'How it relates', kind: 'authored' },
  { key: 'current state', title: 'Current state', kind: 'cited' },
  { key: 'licensing', title: 'Licensing', kind: 'cited' },
  { key: 'history', title: 'History', kind: 'cited' },
  { key: 'see also', title: 'See also', kind: 'authored' },
];
export const SECTION_KIND = Object.fromEntries(SECTIONS.map((s) => [s.key, s.kind]));
