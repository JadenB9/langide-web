// Build script for langide-web.
//
// Bundles src/main.ts → dist/langide.js, src/worker.ts →
// dist/langide-worker.js, and copies everything in public/ into dist/. Designed to produce a self-contained static
// site that can be dropped into any public/ directory (including the
// j4den.com Cloudflare-hosted frontend).

import esbuild from 'esbuild';
import { mkdir, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const outDir = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

const ENTRIES = {
  'langide':        path.join(root, 'src', 'main.ts'),
  'langide-worker': path.join(root, 'src', 'worker.ts'),
};

async function build() {
  // Fresh dist
  if (existsSync(outDir)) {
    await rm(outDir, { recursive: true, force: true });
  }
  await mkdir(outDir, { recursive: true });

  // Bundle TS → two JS files, the page and its worker (CSP-compatible:
  // no inline scripts)
  await esbuild.build({
    entryPoints: ENTRIES,
    bundle: true,
    minify: !watch,
    sourcemap: watch ? 'inline' : false,
    format: 'iife',
    target: ['es2022'],
    outdir: outDir,
    logLevel: 'info',
  });

  // Copy static assets (index.html, styles.css, theme.js)
  await cp(path.join(root, 'public'), outDir, { recursive: true });

  console.log('[langide-web] built →', outDir);
}

if (watch) {
  const ctx = await esbuild.context({
    entryPoints: ENTRIES,
    bundle: true,
    sourcemap: 'inline',
    format: 'iife',
    target: ['es2022'],
    outdir: outDir,
    logLevel: 'info',
  });
  await ctx.watch();
  console.log('[langide-web] watching for changes…');
} else {
  await build();
}
