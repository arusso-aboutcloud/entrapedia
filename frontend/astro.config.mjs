// @ts-check
import { defineConfig } from 'astro/config';
import rehypeArticleSections from './plugins/rehype-article-sections.mjs';

// Static output. The dynamic surface is the same-origin /api/* Pages Functions
// (search proxy + corpus-doc fetch). Authored articles are markdown content
// collections rendered at build time; the rehype plugin badges article sections
// AUTHORED vs CITED.
export default defineConfig({
  output: 'static',
  site: 'https://entrapedia.pages.dev',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
  markdown: {
    rehypePlugins: [rehypeArticleSections],
  },
});
