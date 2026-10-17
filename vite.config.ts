import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const PARTIALS = fileURLToPath(new URL('./src/generated/partials.json', import.meta.url));

/**
 * Injects build-time HTML (factor panels, KaTeX formulas, SVG diagrams,
 * download tables) into index.html at every <!-- partial:name --> marker.
 * The partials are produced by `npm run data` (scripts/build-data.mjs),
 * so the page is fully readable before any JavaScript runs.
 */
function partials(): Plugin {
  return {
    name: 'crypto-factor:partials',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const parts: Record<string, string> = JSON.parse(fs.readFileSync(PARTIALS, 'utf8'));
        const missing = new Set<string>();
        const out = html.replace(/<!--\s*partial:([\w-]+)\s*-->/g, (_, key: string) => {
          if (!(key in parts)) {
            missing.add(key);
            return '';
          }
          return parts[key];
        });
        if (missing.size) throw new Error(`Missing partials: ${[...missing].join(', ')}. Run "npm run data".`);
        return out;
      },
    },
    configureServer(server) {
      server.watcher.add(PARTIALS);
      server.watcher.on('change', (file) => {
        if (file === PARTIALS) server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

export default defineConfig({
  plugins: [partials()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 700,
  },
});
