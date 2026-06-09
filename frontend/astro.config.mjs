// @ts-check
import { defineConfig } from 'astro/config';

// Static output. The site is a static shell + client-side search that calls the
// same-origin /api/* Pages Functions (search proxy + doc fetch). No SSR adapter:
// the dynamic surface is the Functions, not Astro routes.
export default defineConfig({
  output: 'static',
  site: 'https://entrapedia.pages.dev',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
});
