import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Authored concept articles. Crown-jewel curator work: git-versioned markdown in
// src/content/articles/<category>/<slug>.md. Frontmatter = metadata + the cited
// sources; body = the seven sections (authored + cited prose). NOT in D1.
const articles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/articles' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    category: z.string(),
    summary: z.string(),
    tags: z.array(z.string()).default([]),
    layer: z.enum(['current', 'legacy']).default('current'),
    see_also: z.array(z.string()).default([]),
    last_reviewed: z.string(),
    licensing_as_of: z.string().optional(),
    draft: z.boolean().default(false),
    featured: z.boolean().default(false),
    // cited sources used by the cited sections (rendered in-section + footer)
    citations: z.array(z.object({
      id: z.string(),
      title: z.string(),
      source_url: z.string(),
      license: z.string(),
      attribution: z.string(),
    })).default([]),
  }),
});

export const collections = { articles };
