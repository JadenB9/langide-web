// Tests for the langide-web runtime: canonical programs, error messages
// (text + line), every dropdown example, and a few translator outputs.
// Run with `npm test`.

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Bundle runtime.ts (and the examples) to ESM files we can import here.
const tmp = await mkdtemp(path.join(tmpdir(), 'langide-test-'));

await build({
  entryPoints: ['runtime', 'examples', 'translator'].map(f => path.join(root, 'src', f + '.ts')),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outdir: tmp,
  logLevel: 'silent',
});

const { runProgram } = await import(pathToFileURL(path.join(tmp, 'runtime.js')).href);
const { EXAMPLES } = await import(pathToFileURL(path.join(tmp, 'examples.js')).href);
const { NaturalLanguageTranslator } = await import(pathToFileURL(path.join(tmp, 'translator.js')).href);

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
  {
    name: 'sqrt-builtin',
    src: `task main does
  decimal r is square root of 16
  show r
done`,
    expect: '4',
  },
  {
    name: 'pow-builtin',
    src: `task main does
  decimal r is 2 to the power of 8
  show r
done`,
    expect: '256',
  },
  {
    name: 'abs-builtin',
    src: `task main does
  number r is absolute value of -42
  show r
done`,
    expect: '42',
  },
  {
    name: 'rounded-funcs',
    src: `task main does
  show rounded 3.7
  show rounded up 3.2
  show rounded down 3.9
done`,
    expect: '4\n4\n3',
  },
  {
    name: 'max-min-builtins',
    src: `task main does
  show maximum of 5 and 9
  show minimum of 5 and 9
  show bigger of 12 and 7
  show smaller of 12 and 7
done`,
    expect: '9\n5\n12\n7',
  },
  {
    name: 'negative-literal',
    src: `task main does
  number x is -5
  show x plus 2
  show absolute value of -42
done`,
    expect: '-3\n42',
  },
  {
    name: 'number-truncates-like-c',
    src: `task main does
  number half is 7 divided by 2
  decimal exact is 7 divided by 2
  show half
  show exact
done`,
    expect: '3\n3.5',
  },
  {
    name: 'decimal-prints-like-%g',
    src: `task main does
  decimal a is 0.1 plus 0.2
  show a
  show 1 divided by 3
done`,
    expect: '0.3\n0.333333',
  },
  {
    name: 'parentheses',
    src: `task main does
  show (2 plus 3) times 4
  show 2 plus 3 times 4
done`,
    expect: '20\n14',
  },
  {
    name: 'double-quoted-string',
    src: `task main does
  number n is 3
  print "Hi Jaden"
  show "n is " plus n
done`,
    expect: 'Hi Jaden\nn is 3',
  },
  {
    name: 'stop-everything-keeps-earlier-output',
    src: `task main does
  show quotes before ends quote
  stop everything
  show quotes after ends quote
done`,
    expect: 'before',
  },
  {
    name: 'quit-inside-loop',
    src: `task main does
  repeat for i from 0 to 10 do
    if i equals 2 then
      quit
    done
    show i
  done
done`,
    expect: '0\n1',
  },
  {
    name: 'identifier-starting-with-quotes',
    src: `task main does
  number quotesSeen is 4
  show quotesSeen
done`,
    expect: '4',
  },
  {
    name: 'globals-visible-in-tasks',
    src: `number limit is 3
task main does
  show limit
done`,
    expect: '3',
  },
  {
    name: 'loop-control',
    src: `task main does
  number i is 0
  loop forever do
    increase i
    if i equals 2 then
      skip to next
    done
    if i greater than 4 then
      stop loop
    done
    show i
  done
done`,
    expect: '1\n3\n4',
  },
  {
    name: 'or-if-chain',
    src: `task main does
  number age is 15
  if age at least 18 then
    show quotes adult ends quote
  or if age at least 13 then
    show quotes teen ends quote
  otherwise
    show quotes child ends quote
  done
done`,
    expect: 'teen',
  },
  // Errors: message substring + the line the UI should jump to
  {
    name: 'err-unknown-variable-suggests',
    src: `task main does
  number score is 1
  show scroe
done`,
    error: "Unknown variable 'scroe' — did you mean 'score'?",
    line: 3,
  },
  {
    name: 'err-partial-output-kept',
    src: `task main does
  show quotes first ends quote
  show 1 divided by 0
done`,
    expect: 'first',
    error: 'Division by zero',
    line: 3,
  },
  {
    name: 'err-missing-done',
    src: `task main does
  repeat 3 times do
    show quotes hi ends quote
done`,
    error: "'task main' (line 1) is missing its closing 'done'",
    line: 1,
  },
  {
    name: 'err-unterminated-quote',
    src: `task main does
  show quotes hello
done`,
    error: "missing 'ends quote'",
    line: 2,
  },
  {
    name: 'err-symbol-operator',
    src: `task main does
  number x is 2 + 3
done`,
    error: "use 'plus' instead of '+'",
    line: 2,
  },
  {
    name: 'err-misspelled-command',
    src: `task main does
  shwo quotes hi ends quote
done`,
    error: "did you mean 'show'?",
    line: 2,
  },
  {
    name: 'err-assign-without-make',
    src: `task main does
  number x is 1
  x is 5
done`,
    error: "make x be",
    line: 3,
  },
  {
    name: 'err-wrong-arg-count',
    src: `task add taking number a and number b gives number does
  give back a plus b
done
task main does
  show call add with 1
done`,
    error: "'add' takes 2 values but got 1",
    line: 5,
  },
  {
    name: 'err-runaway-recursion',
    src: `task forever taking number n gives number does
  give back call forever with n plus 1
done
task main does
  show call forever with 0
done`,
    error: 'recursion',
  },
  {
    name: 'err-no-main',
    src: `task helper does
  show quotes hi ends quote
done`,
    error: "task main does",
  },
];

let passed = 0;
let failed = 0;
for (const c of cases) {
  const result = runProgram(c.src);
  const actual = (result.output || '').trimEnd();
  const problems = [];
  if (c.error) {
    if (result.success) problems.push('expected an error, program succeeded');
    else if (!result.error.includes(c.error)) problems.push('error was: ' + result.error);
    if (c.line !== undefined && result.line !== c.line) problems.push(`error line ${result.line}, wanted ${c.line}`);
  } else if (!result.success) {
    problems.push('error: ' + result.error);
  }
  if (c.expect !== undefined && actual !== c.expect) {
    problems.push(`expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(actual)}`);
  }
  if (problems.length === 0) {
    console.log('OK  ' + c.name);
    passed++;
  } else {
    console.log('X   ' + c.name);
    for (const p of problems) console.log('    ' + p);
    failed++;
  }
}

// Every example in the dropdown has to run cleanly
for (const ex of EXAMPLES) {
  const result = runProgram(ex.code);
  if (result.success && result.output) {
    console.log('OK  example: ' + ex.name);
    passed++;
  } else {
    console.log('X   example: ' + ex.name + ' — ' + (result.error || 'no output'));
    failed++;
  }
}

// The debug view's C translation
const translations = [
  ['repeat for i from 0 to n do', 'for (int i = 0; i < n; i = i + 1) {'],
  ['count from 1 to 5 do', 'for (int _c = 1; _c < 5; _c = _c + 1) {'],
  ['show quotes Hi there ends quote', 'print "Hi there"'],
  ['make sand be sandy plus 1', 'sand = sandy+ 1'],
];
for (const [src, want] of translations) {
  const got = new NaturalLanguageTranslator(src).translate().trim();
  if (got === want) {
    console.log('OK  translate: ' + src);
    passed++;
  } else {
    console.log('X   translate: ' + src);
    console.log(`    expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    failed++;
  }
}

console.log(`\n${passed}/${passed + failed} passed`);
await rm(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
