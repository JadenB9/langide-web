# langide-web

Web build of [LangIDE](https://github.com/JadenB9/LangIDE) — the natural-English
programming language. Programs run entirely in the browser (in a web
worker), and the same program can be viewed as C, Python or JavaScript.
Ships as a static site; on j4den.com it lives at `/langide/`.

## Quick start

```bash
npm install
npm run build         # → dist/
npm test              # runtime, code generator and translator tests
npm run deploy:j4den  # → ../j4den/frontend/public/langide/
npm run deploy:j4den -- --target <dir>   # copy somewhere else instead
```

Serve `dist/` from any static host (opening `index.html` straight from
disk works for everything except the worker, which some browsers refuse
on `file://` — the program then runs on the main thread instead).

## What's in the box

- **In-browser runtime** — a lexer, parser and tree-walking interpreter
  for the language: variables, arithmetic (with parentheses and negative
  numbers), `if/or if/otherwise`, `repeat while/until/for`, `repeat N
  times`, `count from`, `loop forever`, `task`/`call`/`give back`
  (recursion included), bitwise ops, math builtins (`square root of`, `to
  the power of`, `rounded`, `maximum of A and B`, …), and the friendly
  print/remember aliases. `number` variables behave like a C `int`. Not
  on the web: input (`ask for`), `wait for`, and arrays — use the desktop
  macOS build for those.
- **Runs in a worker** — the program executes off the main thread, output
  streams in while a loop is still going, and `stop` (or Esc) ends it at
  any time. A program that never ends is cut off after 20 seconds anyway.
- **Translated code pane** — the `code` switch shows the program as C,
  Python or JavaScript, generated from the parsed program and updated as
  you type. Copy it or download it as `program.c` / `.py` / `.js`. The
  tests compile and run the generated code for every example with `cc`,
  `python3` and `node` and check it prints what the interpreter prints.
- **Errors that point somewhere** — every error names its line, the line
  is highlighted in the editor and marked in the gutter, and "go to line"
  jumps there. Typos get a "did you mean" suggestion, and output printed
  before the error is kept.
- **Autocomplete** — the language's English phrases (with a one-line hint
  each) and the names in your program are suggested as you type. Arrow
  keys to pick, Enter or Tab to accept, Esc to dismiss.
- **Share links** — the program is deflated into the URL hash
  (`#code=…`), so a link carries the whole program and nothing is
  uploaded anywhere.
- **Files** — download the program as `program.txt` (what the desktop app
  reads), open one with the folder button, ⌘O, or by dropping it on the
  editor.
- **Editor** — line numbers, Tab / Shift+Tab indent, Enter keeps the
  indentation, ⌘/ comments a line out with `note:`, ⌘↵ runs, ⌘S saves,
  ⌘⇧S downloads. The `?` button lists every shortcut. Your program is
  autosaved to `localStorage` and comes back on reload.
- **Definitions panel** — the same language-mappings panel from the
  desktop app. Toggle defaults on/off, add your own mappings, or reset
  to defaults. User mappings persist in `localStorage` and are applied
  as a whole-word preprocessing pass before the interpreter runs.
- **Light and dark** — follows j4den.com's theme (the shared `theme`
  key in `localStorage`, else the device setting), with a sun/moon
  toggle and no flash on load.
- **Examples** — the same canonical example programs as LangIDE.app.

## Security notes

- Every script is loaded from `'self'` — the page enforces a
  `default-src 'self'; script-src 'self'` CSP. The worker is a same-origin
  file, so it's covered by the same policy.
- The runtime does not use `eval` or `new Function`. User programs are
  parsed and walked by a hand-written interpreter, so there's no path
  from source code to JavaScript execution — the "JavaScript" the code
  pane shows is text, never run.
- Output, translations, suggestions and mappings are rendered with
  `textContent`, never `innerHTML`.
- Persistence uses `localStorage` only. Share links keep the program in
  the URL fragment, which browsers don't send to the server. No network
  calls.

## Structure

```
langide-web/
├── src/
│   ├── main.ts          # UI: editor, runner, code pane, autocomplete, share
│   ├── runtime.ts       # Lexer + parser + tree-walking interpreter
│   ├── codegen.ts       # Parsed program → C / Python / JavaScript
│   ├── worker.ts        # Runs the program off the main thread
│   ├── translator.ts    # Old word-for-word C translation (fallback when a program doesn't parse)
│   ├── keywords.ts      # Phrases + hints for autocomplete
│   ├── share.ts         # URL-hash encode/decode for share links
│   ├── mappings.ts      # Default language-definitions catalog
│   └── examples.ts      # Canonical example programs
├── public/
│   ├── index.html       # Shell HTML (CSP-compliant)
│   ├── styles.css       # Terminal-themed CSS, light + dark
│   └── theme.js         # Applies the saved theme before first paint
├── scripts/
│   ├── deploy-to-j4den.mjs
│   └── test-runtime.mjs # npm test
├── build.mjs            # esbuild bundler → dist/
├── package.json
└── tsconfig.json
```
