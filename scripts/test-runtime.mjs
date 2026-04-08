// Quick smoke tests for the langide-web runtime against canonical examples.
// Runs the esbuild bundle-compatible code directly as a module.

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Bundle runtime.ts to an ESM blob we can import here.
const tmp = await mkdtemp(path.join(tmpdir(), 'langide-test-'));
const outFile = path.join(tmp, 'runtime.mjs');

await build({
  entryPoints: [path.join(root, 'src', 'runtime.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outfile: outFile,
  logLevel: 'silent',
});

const { runProgram } = await import(pathToFileURL(outFile).href);

const cases = [
  {
    name: 'hello-world',
    src: `task main does
  show quotes Hello, World ends quote
done`,
    expect: 'Hello, World',
  },
  {
    name: 'variables',
    src: `task main does
  number x is 10
  number y is 20
  number sum is x plus y
  show sum
done`,
    expect: '30',
  },
  {
    name: 'if-else',
    src: `task main does
  number age is 25
  if age greater than 18 then
    show quotes adult ends quote
  otherwise
    show quotes minor ends quote
  done
done`,
    expect: 'adult',
  },
  {
    name: 'while-loop',
    src: `task main does
  number i is 0
  repeat while i less than 3 do
    show i
    make i be i plus 1
  done
done`,
    expect: '0\n1\n2',
  },
  {
    name: 'for-loop',
    src: `task main does
  repeat for i from 0 to 3 do
    show i
  done
done`,
    expect: '0\n1\n2',
  },
  {
    name: 'repeat-n-times',
    src: `task main does
  repeat 3 times do
    show quotes hi ends quote
  done
done`,
    expect: 'hi\nhi\nhi',
  },
  {
    name: 'count-from',
    src: `task main does
  count from 0 to 3 do
    show quotes tick ends quote
  done
done`,
    expect: 'tick\ntick\ntick',
  },
  {
    name: 'function',
    src: `task add taking number a and number b gives number does
  give back a plus b
done
task main does
  number answer is call add with 5 and 10
  show answer
done`,
    expect: '15',
  },
  {
    name: 'remember-alias',
    src: `task main does
  remember score as 42
  tell me score
  display quotes done ends quote
done`,
    expect: '42\ndone',
  },
  {
    name: 'recursion',
    src: `task factorial taking number n gives number does
  if n at most 1 then
    give back 1
  otherwise
    number smaller is call factorial with n minus 1
    give back n times smaller
  done
done
task main does
  number answer is call factorial with 5
  show answer
done`,
    expect: '120',
  },
  {
    name: 'bitwise',
    src: `task main does
  number a is 12
  number b is 5
  number r is a bitwise and b
  show r
done`,
    expect: '4',
  },
];

let passed = 0;
let failed = 0;
for (const c of cases) {
  const result = runProgram(c.src);
  const actual = (result.output || '').trimEnd();
  if (result.success && actual === c.expect) {
    console.log('OK  ' + c.name);
    passed++;
  } else {
    console.log('X   ' + c.name);
    console.log('    expected: ' + JSON.stringify(c.expect));
    console.log('    actual:   ' + JSON.stringify(actual));
    if (!result.success) console.log('    error:    ' + result.error);
    failed++;
  }
}

console.log(`\n${passed}/${passed + failed} passed`);
await rm(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
