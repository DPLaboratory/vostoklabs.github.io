import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Our CSP-safe manifold rebuild (see packages/manifold-noeval/README.md). Aliased in EVERY
// mode, as in the clicker and the keycap generator, so the public site and the MakerLab embed
// run the same geometry engine and there is only one to reason about. The npm package stays
// installed — it still provides the TypeScript types — but its glue calls `new Function()` via
// Embind, which needs `'unsafe-eval'` in the CSP, and MakerWorld's review requires that be
// dropped. The subpath rule must come first so `manifold-3d/manifold.wasm?url` resolves to the
// vendored .wasm rather than npm's.
const MANIFOLD_NOEVAL = resolve(__dirname, '../../packages/manifold-noeval');

/*
  `virtual:makerlab` — the MakerLab (MakerWorld) seam, the same one the clicker, the keycap
  generator and foldbox have.

  In `--mode makerworld` it resolves to src/makerlab/glue.ts, which pulls in the NDA SDK from
  src/makerlab/lib/. Both are gitignored — .gitignore fences every `makerlab` folder in the
  tree — so they are NOT in a public clone; see makerlab/README.md for how to repopulate them.
  (Do not write that ignore pattern out in a block comment: its slash-star closes the comment,
  which is how this file first failed to parse.) In every other build this resolves to the
  inline stub below, whose `MAKERLAB` is the literal `false`: no SDK file ever enters the module
  graph, so the published site and the offline page carry none of it, and `pnpm build` in a
  fresh clone with no src/makerlab/ at all still works. That last part is not a nicety — it is
  what deploy.yml runs.

  The FREE surface, with the paid seam STUBBED (Ian, 2026-09-22). Laser Studio sells nothing on
  MakerWorld today, so nothing calls `ensureAccess` and config.json carries no function points.
  The access helpers are exported anyway, hard-locked in the stub and real in the glue, so
  adding a pack later is a config.json + call-site change rather than a rebuild of this seam.
  Nothing here can grant access: `isUnlocked` and `ensureAccess` answer false in every build
  that is not talking to a host.
*/
function makerlabPlugin(enabled: boolean) {
  const VIRTUAL_ID = 'virtual:makerlab';
  const STUB_ID = '\0virtual:makerlab-stub';
  const gluePath = resolve(__dirname, 'src/makerlab/glue.ts');
  return {
    name: 'makerlab',
    resolveId(id: string) {
      if (id === VIRTUAL_ID) return enabled ? gluePath : STUB_ID;
      return null;
    },
    load(id: string) {
      if (id !== STUB_ID) return null;
      return [
        'export const MAKERLAB = false;',
        'export const isEmbedded = () => false;',
        'export async function initMakerlab() { return null; }',
        'export const isReady = () => false;',
        'export const can = () => false;',
        'export async function sdkExport() { throw new Error("MakerLab SDK not available in this build"); }',
        'export async function sdkToast() {}',
        // The paid seam, hard-locked. It exists so the call sites and the types are identical
        // in both builds; it cannot unlock anything, and no build that ships today asks it to.
        'export const isUnlocked = () => false;',
        'export async function ensureAccess() { return false; }',
      ].join('\n');
    },
    transformIndexHtml(html: string) {
      if (!enabled) return html;
      // The MakerLab host enforces `script-src` WITHOUT `'unsafe-inline'`, so strip inline
      // <script> blocks (those with no src). The only one is the theme bootstrap, and the kit's
      // sidebar footer re-applies the saved/system theme on mount, so nothing is lost — the app
      // simply stays CSP-clean in QA.
      return html.replace(/[ \t]*<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>\s*/gi, '\n');
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Relative base so the static build works on ANY GitHub Pages URL with no reconfig.
  base: './',
  plugins: [makerlabPlugin(mode === 'makerworld')],
  worker: { format: 'es' },
  server: {
    /* Don't watch `tests/`.
     *
     * Every headless harness in there points Chrome at a `--user-data-dir` inside the app —
     * `tests/.headless/chrome-profile`, `tests/node/.out/chrome-shoot`, and four more — and
     * Chrome writes journal and lock files into them continuously. Chokidar tries to stat those
     * while Chrome is mid-write and the dev server DIES on an `UNKNOWN` fs error, mid-run.
     *
     * That is what was behind a string of "the server is down" and "the test can't find the
     * gallery" symptoms while this app was being reviewed: not a slow cold start, and not the
     * app — the server had crashed under the very test that was driving it. Nothing in `tests/`
     * is ever part of the bundle, so there is nothing to watch there anyway. */
    watch: { ignored: ['**/tests/**'] },
  },
  build: {
    target: 'es2022',
    // The MakerLab build goes to its own folder, never `dist/` — `dist/` is what deploy.yml
    // copies onto the live site, and a bundle carrying the SDK must not be able to sit where
    // the public build lives. `assetsInlineLimit: 0` because the host's CSP is `font-src 'self'`
    // and `connect-src 'self'`: an asset Vite inlined as a `data:` URI would be refused as a
    // font and as a fetch.
    ...(mode === 'makerworld' ? { outDir: 'dist-mw', assetsInlineLimit: 0 } : {}),
  },
  // manifold-3d ships its own WASM; keep esbuild from trying to pre-bundle it.
  optimizeDeps: { exclude: ['manifold-3d'] },
  resolve: {
    alias: [
      { find: /^manifold-3d\//, replacement: MANIFOLD_NOEVAL + '/' },
      { find: /^manifold-3d$/, replacement: MANIFOLD_NOEVAL + '/manifold.js' },
    ],
  },
}));
