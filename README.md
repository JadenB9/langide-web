# langide-web

Web build of [LangIDE](../LangIDE) — the natural-English programming language
IDE. Runs entirely in the browser, no server execution, ships as a
static site.

## Quick start

```bash
npm install
npm run build         # → dist/
npm run deploy:j4den  # → ../j4den/frontend/public/langide/
```

Open `dist/index.html` directly in a browser, or deploy the folder to any
static host. On j4den.com it lives at `/langide/`.

## What's in the box

- **Translator** — the natural-English-to-C translator from the macOS app,
  ported to TypeScript. Shows live in debug mode so you can see the
  transformation your sentence goes through.
- **In-browser runtime** — a small interpreter that executes the common
  language subset: variables, arithmetic, `if/otherwise`, `repeat while`,
  `repeat for`, `repeat N times`, `count from`, `task`/`call`/`give back`,
  bitwise ops, and the friendly print/remember aliases. Out of scope on
  the web: `sqrt`, `pow`, `abs`, `sleep`, `scanf`, arrays — use the
  [desktop macOS build](../LangIDE) for those.
- **Definitions panel** — the same language-mappings panel from the
  desktop app. Toggle defaults on/off, add your own mappings, or reset
  to defaults. User mappings persist in `localStorage` and are applied
  as a preprocessing pass before the interpreter runs.
- **Examples** — the same canonical example programs as LangIDE.app.

## Security notes

- Every script is loaded from `'self'` — the app enforces a
  `default-src 'self'; script-src 'self'` CSP.
- The runtime does not use `eval`, `new Function`, or web workers.
- User programs are parsed and walked by a hand-written interpreter, so
  there's no path from source code to arbitrary JavaScript execution.
- Persistence uses `localStorage` only. No network calls.

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
│   └── styles.css       # Terminal-themed CSS
├── scripts/
│   └── deploy-to-j4den.mjs
├── build.mjs            # esbuild bundler → dist/
├── package.json
└── tsconfig.json
```
