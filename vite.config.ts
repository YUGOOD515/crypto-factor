import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const PARTIALS = fileURLToPath(new URL('./src/generated/partials.json', import.meta.url));
const HEADERS = fileURLToPath(new URL('./public/_headers', import.meta.url));
const NOT_FOUND = fileURLToPath(new URL('./public/404.html', import.meta.url));

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

/**
 * The Content-Security-Policy in public/_headers allows inline scripts only by
 * hash (the pre-paint theme script, shared by index.html and public/404.html).
 * Fail the build when an inline script has no matching hash, instead of
 * shipping a page whose script the browser silently refuses to run.
 */
function cspHashes(): Plugin {
  const check = (html: string, file: string) => {
    const csp = fs.readFileSync(HEADERS, 'utf8');
    for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (/\bsrc=/.test(attrs) || !body.trim()) continue;
      const hash = `'sha256-${createHash('sha256').update(body).digest('base64')}'`;
      if (!csp.includes(hash)) throw new Error(`${file}: add ${hash} to script-src in public/_headers (inline script changed).`);
    }
  };
  return {
    name: 'crypto-factor:csp-hashes',
    apply: 'build',
    buildStart() {
      check(fs.readFileSync(NOT_FOUND, 'utf8'), 'public/404.html');
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        check(html, 'index.html');
      },
    },
  };
}

export default defineConfig({
  plugins: [partials(), cspHashes()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 700,
  },
});
