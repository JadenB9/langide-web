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

// Defaults to the sibling j4den checkout (../j4den). Pass
// `--target <dir>` to copy somewhere else, e.g. a j4den worktree:
//   node scripts/deploy-to-j4den.mjs --target ../j4den-wt/x/frontend/public/langide
const targetArg = process.argv.indexOf('--target');
const TARGETS = targetArg !== -1 && process.argv[targetArg + 1]
  ? [path.resolve(process.argv[targetArg + 1])]
  : [path.resolve(root, '..', 'j4den', 'frontend', 'public', 'langide')];

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
