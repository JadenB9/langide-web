// Build script for langide-web.
//
// Bundles src/main.ts → dist/langide.js, copies public/index.html and
// public/styles.css into dist/. Designed to produce a self-contained static
// site that can be dropped into any public/ directory (including the
// j4den.com Cloudflare-hosted frontend).

import esbuild from 'esbuild';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const outDir = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

async function build() {
  // Fresh dist
  if (existsSync(outDir)) {
    await rm(outDir, { recursive: true, force: true });
  }
  await mkdir(outDir, { recursive: true });

  // Bundle TS → single JS file (CSP-compatible: no inline scripts)
  await esbuild.build({
    entryPoints: [path.join(root, 'src', 'main.ts')],
    bundle: true,
    minify: !watch,
    sourcemap: watch ? 'inline' : false,
    format: 'iife',
    target: ['es2022'],
    outfile: path.join(outDir, 'langide.js'),
    logLevel: 'info',
  });

  // Copy static assets
  const html = await readFile(path.join(root, 'public', 'index.html'), 'utf8');
  await writeFile(path.join(outDir, 'index.html'), html);

  const css = await readFile(path.join(root, 'public', 'styles.css'), 'utf8');
  await writeFile(path.join(outDir, 'styles.css'), css);

  console.log('[langide-web] built →', outDir);
}

if (watch) {
  const ctx = await esbuild.context({
    entryPoints: [path.join(root, 'src', 'main.ts')],
    bundle: true,
    sourcemap: 'inline',
    format: 'iife',
    target: ['es2022'],
    outfile: path.join(outDir, 'langide.js'),
    logLevel: 'info',
  });
  await ctx.watch();
  console.log('[langide-web] watching for changes…');
} else {
  await build();
}
