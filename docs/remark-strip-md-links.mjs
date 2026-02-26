import { basename } from 'node:path';
import { visit } from 'unist-util-visit';

/**
 * Remark plugin that strips .md / .mdx extensions from internal links
 * and adjusts relative paths for Starlight's trailing-slash routing.
 *
 * Starlight serves every page with a trailing slash:
 *   index.mdx  -> /en/          (locale root)
 *   features.md -> /en/features/ (one level deeper)
 *
 * For non-index pages, `./ocr` resolves to /en/features/ocr (wrong),
 * so we rewrite `./` to `../` -> /en/ocr (correct).
 *
 * For index pages, `./ocr` already resolves to /en/ocr (correct),
 * so we only strip the .md extension.
 */
function remarkStripMdLinks() {
  return (tree, file) => {
    const fileName = file?.path ? basename(file.path) : '';
    const isIndex = /^index\.mdx?$/.test(fileName);

    visit(tree, 'link', (node) => {
      if (
        node.url &&
        !node.url.startsWith('http') &&
        /\.mdx?($|#)/.test(node.url)
      ) {
        if (!isIndex) {
          node.url = node.url.replace(/^\.\//, '../');
        }
        node.url = node.url.replace(/\.mdx?($|#)/, '$1');
      }
    });
  };
}

/**
 * Astro integration that injects the remarkStripMdLinks plugin
 * into both the markdown and MDX pipelines via astro:config:setup.
 * This ensures the plugin runs for all content files (.md and .mdx),
 * even when Starlight's own updateConfig overwrites the initial
 * markdown.remarkPlugins array.
 */
export function stripMdLinksIntegration() {
  return {
    name: 'strip-md-links',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({
          markdown: {
            remarkPlugins: [remarkStripMdLinks],
          },
        });
      },
    },
  };
}
