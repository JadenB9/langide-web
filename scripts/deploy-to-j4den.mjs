// Copies the built dist/ directory into j4den.com's frontend/public/langide/.
// Run via `npm run deploy:j4den` from the langide-web root.
//
// Idempotent: wipes the target langide/ directory and re-copies fresh.

import { cp, rm, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

// Absolute path to j4den's frontend/public — this is the sibling project
// in ~/Projects/j4den. Adjust if your layout differs.
const TARGETS = [
  path.resolve(root, '..', 'j4den', 'frontend', 'public', 'langide'),
];

async function main() {
  if (!existsSync(dist)) {
    console.error('[deploy] dist/ not found — run `npm run build` first.');
    process.exit(1);
  }

  for (const target of TARGETS) {
    // Sanity: make sure the parent exists before we touch anything.
    const parent = path.dirname(target);
    try {
      await stat(parent);
    } catch {
      console.warn(`[deploy] skipping ${target} — parent ${parent} does not exist`);
      continue;
    }

    if (existsSync(target)) {
      await rm(target, { recursive: true, force: true });
    }
    await mkdir(target, { recursive: true });
    await cp(dist, target, { recursive: true });
    console.log(`[deploy] copied dist/ → ${target}`);
  }
}

main().catch((e) => {
  console.error('[deploy] failed:', e);
  process.exit(1);
});
