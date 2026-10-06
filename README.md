# langide-web

Web build of [LangIDE](../LangIDE) — the natural-English programming language
IDE. Runs entirely in the browser, no server execution, ships as a
static site.

## Quick start

```bash
npm install
npm run build         # → dist/
npm test              # runtime + translator tests
npm run deploy:j4den  # → ../j4den/frontend/public/langide/
npm run deploy:j4den -- --target <dir>   # copy somewhere else instead
```

Open `dist/index.html` directly in a browser, or deploy the folder to any
static host. On j4den.com it lives at `/langide/`.

## What's in the box

- **Translator** — the natural-English-to-C translator from the macOS app,
  ported to TypeScript. Shows live in debug mode so you can see the
  transformation your sentence goes through.
- **In-browser runtime** — a small interpreter that executes the language:
  variables, arithmetic (with parentheses and negative numbers),
  `if/or if/otherwise`, `repeat while/until/for`, `repeat N times`,
  `count from`, `loop forever`, `task`/`call`/`give back` (recursion
  included), bitwise ops, math builtins (`square root of`, `to the power
  of`, `rounded`, `maximum of A and B`, …), and the friendly
  print/remember aliases. `number` variables behave like a C `int`.
  Not on the web: input (`ask for`), `wait for`, and arrays — use the
  [desktop macOS build](../LangIDE) for those.
- **Errors that point somewhere** — every error names its line, the
  gutter marks it, and "go to line" jumps there. Typos get a "did you
  mean" suggestion, and output printed before the error is kept.
- **Editor** — line numbers, Tab / Shift+Tab indent, Enter keeps the
  indentation, ⌘/Ctrl+Enter runs, ⌘/Ctrl+S saves. Your program is
  autosaved to `localStorage` and comes back on reload. (Escape then Tab
  moves focus out of the editor.)
- **Definitions panel** — the same language-mappings panel from the
  desktop app. Toggle defaults on/off, add your own mappings, or reset
  to defaults. User mappings persist in `localStorage` and are applied
  as a whole-word preprocessing pass before the interpreter runs.
- **Light and dark** — follows j4den.com's theme (the shared `theme`
  key in `localStorage`, else the device setting), with a toggle.
- **Examples** — the same canonical example programs as LangIDE.app.

## Security notes

- Every script is loaded from `'self'` — the app enforces a
  `default-src 'self'; script-src 'self'` CSP.
- The runtime does not use `eval`, `new Function`, or web workers.
- User programs are parsed and walked by a hand-written interpreter, so
  there's no path from source code to arbitrary JavaScript execution.
- Persistence uses `localStorage` only. No network calls.
- Output and mappings are rendered with `textContent`, never `innerHTML`.

## Structure

```
langide-web/
├── src/
│   ├── main.ts          # UI bootstrap, state, event handlers
│   ├── translator.ts    # Natural English → C (display only)
│   ├── runtime.ts       # Lexer + parser + tree-walking interpreter
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
