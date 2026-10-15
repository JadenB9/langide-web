// LangIDE web — entry point.
//
// Wires up the editor, output, example dropdown, the translated-code pane,
// and the language-definitions panel. Programs run in a web worker so a
// runaway loop can't freeze the page; everything stays in-browser — no
// network calls, no server-side execution. The program you're editing
// and your mappings persist in localStorage.

import { NaturalLanguageTranslator } from './translator';
import { runProgram, parseProgram, type RunResult } from './runtime';
import { generate, TARGET_LABELS, TARGET_EXTENSIONS, type Target } from './codegen';
import { EXAMPLES } from './examples';
import { KEYWORDS, KEYWORD_WORDS } from './keywords';
import { encodeShareHash, decodeShareHash } from './share';
import {
  DEFAULT_MAPPINGS,
  CATEGORY_LABELS,
  type LanguageMapping,
  type MappingCategory,
} from './mappings';

const USER_MAPPINGS_KEY = 'langide-web.userMappings.v1';
const USE_DEFAULTS_KEY  = 'langide-web.useDefaults';
const SOURCE_KEY        = 'langide-web.source.v1';
const SHOW_CODE_KEY     = 'langide-web.showCode';
const TARGET_KEY        = 'langide-web.target';
const THEME_KEY         = 'theme'; // shared with the rest of j4den.com

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';
const SHIFT = IS_MAC ? '⇧' : 'Shift+';

interface AppState {
  source: string;
  showCode: boolean;
  target: Target;
  useDefaults: boolean;
  userMappings: LanguageMapping[];
  filterCategory: MappingCategory | 'all';
  searchText: string;
  errorLine: number | null;
  running: boolean;
}

const state: AppState = {
  source: loadSource(),
  showCode: readStorage(SHOW_CODE_KEY) === 'true',
  target: loadTarget(),
  useDefaults: loadUseDefaults(),
  userMappings: loadUserMappings(),
  filterCategory: 'all',
  searchText: '',
  errorLine: null,
  running: false,
};

// ─────────────────────────────────────────────────────────────────────
// Persistence helpers — storage can throw (private mode, quota), and the
// app should keep working without it
// ─────────────────────────────────────────────────────────────────────

function readStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key: string, value: string): boolean {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

function loadUserMappings(): LanguageMapping[] {
  try {
    const raw = readStorage(USER_MAPPINGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LanguageMapping[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(m => m && typeof m.customSyntax === 'string' && typeof m.equivalentSyntax === 'string')
      .map(m => ({
        ...m,
        category: m.category in CATEGORY_LABELS ? m.category : 'other',
        description: typeof m.description === 'string' ? m.description : 'User-defined',
        isDefault: false,
      }));
  } catch {
    return [];
  }
}

function saveUserMappings(): void {
  writeStorage(USER_MAPPINGS_KEY, JSON.stringify(state.userMappings));
}

function loadUseDefaults(): boolean {
  const v = readStorage(USE_DEFAULTS_KEY);
  return v === null ? true : v === 'true';
}

function saveUseDefaults(): void {
  writeStorage(USE_DEFAULTS_KEY, String(state.useDefaults));
}

function loadSource(): string {
  return readStorage(SOURCE_KEY) ?? EXAMPLES[0].code;
}

function loadTarget(): Target {
  const v = readStorage(TARGET_KEY);
  return v && v in TARGET_LABELS ? v as Target : 'c';
}

let saveTimer: number | undefined;
let statusTimer: number | undefined;

function saveSource(announce: boolean): void {
  window.clearTimeout(saveTimer);
  const ok = writeStorage(SOURCE_KEY, state.source);
  if (announce) flash('#save-status', ok ? 'saved' : "can't save here (private window?)");
}

// Autosave shortly after typing stops
function queueSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveSource(false), 400);
}

// Short status text that clears itself
function flash(sel: string, text: string): void {
  const status = qs<HTMLElement>(sel);
  status.textContent = text;
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => { status.textContent = ''; }, 1600);
}

// ─────────────────────────────────────────────────────────────────────
// Preprocessing — apply user mappings as whole-word substitution
// ─────────────────────────────────────────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyUserPreprocessing(source: string): string {
  if (state.userMappings.length === 0) return source;
  let result = source;
  const sorted = [...state.userMappings].sort(
    (a, b) => b.customSyntax.length - a.customSyntax.length
  );
  for (const m of sorted) {
    if (!m.customSyntax) continue;
    if (m.customSyntax.includes('NAME') || m.customSyntax.includes('VALUE')) continue;
    // Whole words only, so a mapping for "hi" leaves "this" alone
    const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(m.customSyntax)}(?![A-Za-z0-9_])`, 'g');
    result = result.replace(re, () => m.equivalentSyntax);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Run — in a worker when the browser has one, so `stop` always works and
// the page stays responsive; inline otherwise
// ─────────────────────────────────────────────────────────────────────

let worker: Worker | null = null;
let workerBroken = false;
// A one-off note to show under the next run's output
let pendingNote: string | null = null;

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker('langide-worker.js?v=2');
    } catch {
      workerBroken = true;
      return null;
    }
  }
  return worker;
}

function setRunning(on: boolean): void {
  state.running = on;
  qs<HTMLButtonElement>('#stop-btn').hidden = !on;
  qs<HTMLButtonElement>('#run-btn').classList.toggle('is-running', on);
  qs<HTMLSpanElement>('#run-status').textContent = on ? 'running… (Esc stops)' : '';
}

function run(): void {
  stopRun(false);
  closeAutocomplete();
  const outputEl = qs<HTMLPreElement>('#output-pane');
  outputEl.textContent = '';
  state.errorLine = null;
  renderGutter();
  renderCode();

  const preprocessed = applyUserPreprocessing(state.source);
  const w = getWorker();
  if (!w) {
    finishRun(runProgram(preprocessed));
    return;
  }
  setRunning(true);
  w.onmessage = (e: MessageEvent<{ type: 'output'; text: string } | { type: 'done'; result: RunResult }>) => {
    if (e.data.type === 'output') {
      outputEl.append(e.data.text);
      outputEl.scrollTop = outputEl.scrollHeight;
    } else {
      finishRun(e.data.result);
    }
  };
  // The worker file failed to load (or crashed) — run inline instead
  w.onerror = () => {
    w.terminate();
    worker = null;
    workerBroken = true;
    setRunning(false);
    finishRun(runProgram(preprocessed));
  };
  w.postMessage({ source: preprocessed });
}

function stopRun(announce: boolean): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  if (!state.running) return;
  setRunning(false);
  if (announce) {
    const outputEl = qs<HTMLPreElement>('#output-pane');
    outputEl.append(el('span', { class: 'out-note' }, '(stopped)\n'));
    outputEl.scrollTop = outputEl.scrollHeight;
  }
}

function finishRun(result: RunResult): void {
  setRunning(false);
  const outputEl = qs<HTMLPreElement>('#output-pane');
  // Streamed chunks are replaced by the complete output (same text)
  outputEl.textContent = '';
  outputEl.append(result.output);

  if (!result.success) {
    const msg = result.error ?? 'something went wrong';
    const text = msg.charAt(0).toUpperCase() + msg.slice(1);
    outputEl.append(el('span', { class: 'out-error' },
      result.line ? `Error on line ${result.line}: ${text}` : `Error: ${text}`));
    if (result.line) {
      const line = result.line;
      const jump = el('button', { type: 'button', class: 'jump-btn' }, `go to line ${line}`);
      jump.addEventListener('click', () => goToLine(line));
      outputEl.append(' ', jump);
    }
    outputEl.append('\n');
  } else if (!result.output) {
    // Say so rather than leave a silent pane
    outputEl.append(el('span', { class: 'out-note' }, '(program ran — no output)\n'));
  }
  if (pendingNote) {
    outputEl.append(el('span', { class: 'out-note' }, pendingNote + '\n'));
    pendingNote = null;
  }
  outputEl.scrollTop = outputEl.scrollHeight;

  state.errorLine = result.success ? null : result.line ?? null;
  renderGutter();
}

// ─────────────────────────────────────────────────────────────────────
// Translated-code pane — the program as C, Python or JavaScript, kept
// current as you type
// ─────────────────────────────────────────────────────────────────────

let codeTimer: number | undefined;

function queueCode(): void {
  if (!state.showCode) return;
  window.clearTimeout(codeTimer);
  codeTimer = window.setTimeout(renderCode, 150);
}

function renderCode(): void {
  if (!state.showCode) return;
  window.clearTimeout(codeTimer);
  const body = qs<HTMLPreElement>('#code-pane-body');
  const src = applyUserPreprocessing(state.source);
  body.textContent = '';
  try {
    body.append(generate(parseProgram(src), state.target));
  } catch (e) {
    // A program that doesn't parse can't be translated properly. Say
    // where it stops, and for C show the old word-for-word translation
    // so there's still something to look at mid-edit.
    const err = e as { message?: string; line?: number };
    const where = err.line ? `line ${err.line}: ` : '';
    body.append(el('span', { class: 'out-error' }, `can't translate yet — ${where}${err.message ?? e}\n`));
    if (state.target === 'c') {
      body.append(
        el('span', { class: 'out-note' }, '\nrough word-for-word translation:\n\n'),
        new NaturalLanguageTranslator(src).translate(),
      );
    }
  }
}

function setShowCode(on: boolean): void {
  state.showCode = on;
  writeStorage(SHOW_CODE_KEY, String(on));
  qs<HTMLInputElement>('#code-toggle').checked = on;
  qs<HTMLElement>('#code-pane').hidden = !on;
  document.body.classList.toggle('code-open', on);
  renderCode();
}

function setTarget(target: Target): void {
  state.target = target;
  writeStorage(TARGET_KEY, target);
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.seg-btn')) {
    const active = btn.dataset.target === target;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  }
  renderCode();
}

// ─────────────────────────────────────────────────────────────────────
// Editor — line-number gutter, error line, jump to line, indentation keys
// ─────────────────────────────────────────────────────────────────────

let gutterLines = 0;

function lineHeightOf(editor: HTMLTextAreaElement): number {
  return parseFloat(getComputedStyle(editor).lineHeight) || 20;
}

function renderGutter(): void {
  const gutter = qs<HTMLDivElement>('#gutter');
  const editor = qs<HTMLTextAreaElement>('#editor');
  const count = state.source.split('\n').length;
  if (count !== gutterLines) {
    gutter.textContent = '';
    for (let i = 1; i <= count; i++) gutter.append(el('div', {}, String(i)));
    gutterLines = count;
  }
  gutter.querySelector('.err')?.classList.remove('err');
  const hl = qs<HTMLDivElement>('#line-hl');
  if (state.errorLine && state.errorLine <= count) {
    gutter.children[state.errorLine - 1].classList.add('err');
    hl.hidden = false;
    hl.style.height = lineHeightOf(editor) + 'px';
  } else {
    hl.hidden = true;
  }
  syncEditorScroll();
}

// The gutter and the error highlight follow the textarea's scroll
function syncEditorScroll(): void {
  const editor = qs<HTMLTextAreaElement>('#editor');
  qs<HTMLDivElement>('#gutter').scrollTop = editor.scrollTop;
  const hl = qs<HTMLDivElement>('#line-hl');
  if (!hl.hidden && state.errorLine) {
    const top = parseFloat(getComputedStyle(editor).paddingTop) + (state.errorLine - 1) * lineHeightOf(editor);
    hl.style.top = (top - editor.scrollTop) + 'px';
  }
}

function goToLine(line: number): void {
  const editor = qs<HTMLTextAreaElement>('#editor');
  const lines = editor.value.split('\n');
  let start = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) start += lines[i].length + 1;
  const end = start + (lines[line - 1]?.length ?? 0);
  editor.focus();
  editor.setSelectionRange(start, end);
  // Bring the line into view, roughly centered
  editor.scrollTop = Math.max(0, (line - 1) * lineHeightOf(editor) - editor.clientHeight / 2);
}

// execCommand keeps the browser's undo history intact; setRangeText is
// the fallback where it's unavailable
function insertText(editor: HTMLTextAreaElement, text: string): void {
  if (!document.execCommand('insertText', false, text)) {
    editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, 'end');
    editor.dispatchEvent(new Event('input'));
  }
}

// Escape lets the next Tab leave the editor instead of indenting, so
// keyboard users are never trapped in it
let tabReleased = false;

function handleEditorKeys(e: KeyboardEvent): void {
  const editor = e.currentTarget as HTMLTextAreaElement;

  // The suggestion list takes the arrow and accept keys while it's open
  if (ac.open) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveAutocomplete(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      acceptAutocomplete(editor);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeAutocomplete();
      return;
    }
  }

  if (e.key === 'Escape') { tabReleased = true; return; }
  if (e.key === 'Tab' && !tabReleased && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    if (e.shiftKey) outdentLine(editor);
    else insertText(editor, '  ');
    return;
  }
  tabReleased = false;

  // Cmd/Ctrl+/ comments the current line (or every selected line) out
  if (e.key === '/' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    toggleComment(editor);
    return;
  }

  // Enter keeps the current line's indentation
  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.isComposing) {
    const before = editor.value.slice(0, editor.selectionStart);
    const indent = before.slice(before.lastIndexOf('\n') + 1).match(/^[ \t]*/)![0];
    if (indent) {
      e.preventDefault();
      insertText(editor, '\n' + indent);
    }
  }
}

// Shift+Tab removes up to two leading spaces from the caret's line
function outdentLine(editor: HTMLTextAreaElement): void {
  const caret = editor.selectionStart;
  const lineStart = editor.value.lastIndexOf('\n', caret - 1) + 1;
  const spaces = editor.value.slice(lineStart, lineStart + 2).match(/^ */)![0].length;
  if (!spaces) return;
  editor.setSelectionRange(lineStart, lineStart + spaces);
  if (!document.execCommand('delete')) {
    editor.setRangeText('');
    editor.dispatchEvent(new Event('input'));
  }
  const back = Math.max(lineStart, caret - spaces);
  editor.setSelectionRange(back, back);
}

// Adds `note: ` after the indentation of every selected line, or removes
// it when they all have one already
function toggleComment(editor: HTMLTextAreaElement): void {
  const value = editor.value;
  const selStart = editor.selectionStart;
  const selEnd = editor.selectionEnd;
  const start = value.lastIndexOf('\n', selStart - 1) + 1;
  let end = value.indexOf('\n', Math.max(selEnd - 1, selStart));
  if (end === -1) end = value.length;
  const lines = value.slice(start, end).split('\n');
  const allNotes = lines.every(l => l.trim() === '' || /^\s*note:/i.test(l));
  const changed = lines.map(l => {
    if (allNotes) return l.replace(/^(\s*)note:\s?/i, '$1');
    if (l.trim() === '') return l;
    return l.replace(/^(\s*)/, '$1note: ');
  });
  editor.setSelectionRange(start, end);
  insertText(editor, changed.join('\n'));
  editor.setSelectionRange(start, start + changed.join('\n').length);
}

function setSource(code: string): void {
  state.source = code;
  qs<HTMLTextAreaElement>('#editor').value = code;
  state.errorLine = null;
  renderGutter();
  saveSource(false);
  renderCode();
}

// Only ask before replacing when the editor holds the user's own work
function confirmReplace(what: string): boolean {
  const ownWork = state.source.trim() !== '' && !EXAMPLES.some(e => e.code === state.source);
  return !ownWork || confirm(`Replace your program with ${what}?`);
}

// ─────────────────────────────────────────────────────────────────────
// Autocomplete — the language's English phrases plus names from the
// program, offered as you type
// ─────────────────────────────────────────────────────────────────────

interface Suggestion { text: string; hint: string; start: number; }

const ac = { open: false, items: [] as Suggestion[], index: 0 };
let charWidthCache: { font: string; width: number } | null = null;

function charWidth(editor: HTMLTextAreaElement): number {
  const font = getComputedStyle(editor).font;
  if (charWidthCache?.font === font) return charWidthCache.width;
  const ctx = document.createElement('canvas').getContext('2d');
  let width = 7.8;
  if (ctx) { ctx.font = font; width = ctx.measureText('M').width; }
  charWidthCache = { font, width };
  return width;
}

// Names the user has defined (anything that isn't a language word)
function namesInSource(exclude: string): string[] {
  const seen = new Set<string>();
  for (const w of state.source.match(/[A-Za-z_][A-Za-z0-9_]+/g) ?? []) {
    if (w !== exclude && !KEYWORD_WORDS.has(w.toLowerCase())) seen.add(w);
  }
  return [...seen];
}

function updateAutocomplete(): void {
  const editor = qs<HTMLTextAreaElement>('#editor');
  const caret = editor.selectionStart;
  if (caret !== editor.selectionEnd) return closeAutocomplete();
  const lineStart = editor.value.lastIndexOf('\n', caret - 1) + 1;
  const before = editor.value.slice(lineStart, caret);
  const after = editor.value[caret];
  if (after && /[A-Za-z0-9_]/.test(after)) return closeAutocomplete();
  // The run of words ending at the caret — a phrase can be several
  const m = /((?:[A-Za-z_][A-Za-z0-9_]* )*[A-Za-z_][A-Za-z0-9_]*)$/.exec(before);
  if (!m) return closeAutocomplete();
  const words = m[1].split(' ');

  const items: Suggestion[] = [];
  const seen = new Set<string>();
  // Longest prefix first: "square r" beats "r"
  for (let k = Math.min(words.length, 4); k >= 1; k--) {
    const prefix = words.slice(-k).join(' ');
    if (k === 1 && prefix.length < 2) break;
    const start = caret - prefix.length;
    const lower = prefix.toLowerCase();
    for (const kw of KEYWORDS) {
      if (kw.phrase.length > prefix.length && kw.phrase.toLowerCase().startsWith(lower) && !seen.has(kw.phrase)) {
        seen.add(kw.phrase);
        items.push({ text: kw.phrase, hint: kw.hint, start });
      }
    }
    if (k === 1) {
      for (const name of namesInSource(prefix)) {
        if (name.toLowerCase().startsWith(lower) && !seen.has(name)) {
          seen.add(name);
          items.push({ text: name, hint: 'name in this program', start });
        }
      }
    }
  }
  if (items.length === 0) return closeAutocomplete();

  ac.items = items.slice(0, 8);
  ac.index = 0;
  ac.open = true;
  renderAutocomplete();

  // Sit under the caret
  const list = qs<HTMLDivElement>('#autocomplete');
  const lineIdx = editor.value.slice(0, caret).split('\n').length - 1;
  const col = caret - lineStart;
  const padTop = parseFloat(getComputedStyle(editor).paddingTop);
  const padLeft = parseFloat(getComputedStyle(editor).paddingLeft);
  const top = padTop + (lineIdx + 1) * lineHeightOf(editor) - editor.scrollTop;
  const left = padLeft + col * charWidth(editor) - editor.scrollLeft;
  const maxLeft = Math.max(0, editor.clientWidth - list.offsetWidth - 4);
  list.style.top = top + 'px';
  list.style.left = Math.min(left, maxLeft) + 'px';
}

function renderAutocomplete(): void {
  const list = qs<HTMLDivElement>('#autocomplete');
  const editor = qs<HTMLTextAreaElement>('#editor');
  list.textContent = '';
  ac.items.forEach((s, i) => {
    const row = el('div', {
      class: 'ac-item' + (i === ac.index ? ' active' : ''),
      role: 'option',
      'aria-selected': String(i === ac.index),
    }, el('span', { class: 'ac-text' }, s.text), el('span', { class: 'ac-hint' }, s.hint));
    // mousedown, so the editor keeps focus
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      ac.index = i;
      acceptAutocomplete(editor);
    });
    list.append(row);
  });
  list.hidden = false;
}

function moveAutocomplete(delta: number): void {
  ac.index = (ac.index + delta + ac.items.length) % ac.items.length;
  renderAutocomplete();
  qs<HTMLDivElement>('#autocomplete').querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

function acceptAutocomplete(editor: HTMLTextAreaElement): void {
  const s = ac.items[ac.index];
  closeAutocomplete();
  if (!s) return;
  editor.setSelectionRange(s.start, editor.selectionEnd);
  insertText(editor, s.text + ' ');
}

function closeAutocomplete(): void {
  if (!ac.open) return;
  ac.open = false;
  ac.items = [];
  qs<HTMLDivElement>('#autocomplete').hidden = true;
}

// ─────────────────────────────────────────────────────────────────────
// Share, download, open
// ─────────────────────────────────────────────────────────────────────

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function share(): Promise<void> {
  const hash = await encodeShareHash(state.source);
  const url = location.origin + location.pathname + hash;
  history.replaceState(null, '', hash);
  const dialog = qs<HTMLDialogElement>('#share-dialog');
  const input = qs<HTMLInputElement>('#share-url');
  const status = qs<HTMLElement>('#share-status');
  input.value = url;
  status.textContent = (await copyText(url)) ? 'copied to your clipboard' : '';
  dialog.showModal();
  input.select();
}

function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The desktop app saves programs as .txt, so that's what we hand out
function downloadProgram(): void {
  downloadText('program.txt', state.source);
  flash('#save-status', 'downloaded program.txt');
}

async function openFile(file: File): Promise<void> {
  if (file.size > 1_000_000) {
    alert('That file is bigger than 1 MB — it doesn\'t look like a program.');
    return;
  }
  const text = await file.text();
  if (!confirmReplace(`"${file.name}"`)) return;
  setSource(text);
  flash('#save-status', `opened ${file.name}`);
  run();
}

// ─────────────────────────────────────────────────────────────────────
// Theme — same localStorage key and attribute as the rest of the site
// ─────────────────────────────────────────────────────────────────────

function isLight(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'light';
}

function renderThemeButton(): void {
  const btn = qs<HTMLButtonElement>('#theme-btn');
  // Names the theme you'd switch to, like the site's toggle
  const label = isLight() ? 'Switch to dark theme' : 'Switch to light theme';
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

function toggleTheme(): void {
  const next = isLight() ? 'dark' : 'light';
  if (next === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'light' ? '#e9ebed' : '#1a1a1a');
  writeStorage(THEME_KEY, next);
  renderThemeButton();
}

// ─────────────────────────────────────────────────────────────────────
// DOM helpers
// ─────────────────────────────────────────────────────────────────────

function qs<T extends Element>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, string>, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else e.setAttribute(k, v);
    }
  }
  for (const c of children) e.append(c);
  return e;
}

// ─────────────────────────────────────────────────────────────────────
// Definitions panel
// ─────────────────────────────────────────────────────────────────────

function getActiveMappings(): LanguageMapping[] {
  const defaults = state.useDefaults ? DEFAULT_MAPPINGS : [];
  return [...defaults, ...state.userMappings];
}

function getFilteredMappings(): LanguageMapping[] {
  let list = getActiveMappings();
  if (state.filterCategory !== 'all') {
    list = list.filter(m => m.category === state.filterCategory);
  }
  const q = state.searchText.trim().toLowerCase();
  if (q) {
    list = list.filter(m =>
      m.customSyntax.toLowerCase().includes(q) ||
      m.equivalentSyntax.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q)
    );
  }
  return list;
}

function renderDefinitions(): void {
  const listEl = qs<HTMLDivElement>('#definitions-list');
  listEl.textContent = '';

  const mappings = getFilteredMappings();
  const count = qs<HTMLSpanElement>('#def-count');
  count.textContent = `${mappings.length}`;

  if (mappings.length === 0) {
    listEl.append(el('div', { class: 'def-empty' }, 'No mappings match.'));
    return;
  }

  for (const m of mappings) {
    const row = el('div', { class: 'def-row' + (m.isDefault ? '' : ' user') });
    row.append(
      el('div', { class: 'def-head' },
        el('span', { class: 'def-category' }, CATEGORY_LABELS[m.category]),
        el('span', { class: 'def-badge' }, m.isDefault ? 'default' : 'user')
      ),
      el('div', { class: 'def-custom' }, m.customSyntax),
      el('div', { class: 'def-arrow', 'aria-hidden': 'true' }, '→'),
      el('div', { class: 'def-equiv' }, m.equivalentSyntax),
    );
    if (m.description) {
      row.append(el('div', { class: 'def-desc' }, m.description));
    }
    if (!m.isDefault) {
      const actions = el('div', { class: 'def-actions' });
      const del = el('button', {
        class: 'def-delete',
        type: 'button',
        'aria-label': `Delete mapping "${m.customSyntax}"`,
      }, '✕');
      del.addEventListener('click', () => {
        state.userMappings = state.userMappings.filter(u => u.id !== m.id);
        saveUserMappings();
        renderDefinitions();
        renderCode();
      });
      actions.append(del);
      row.append(actions);
    }
    listEl.append(row);
  }
}

function addUserMapping(): void {
  const custInput = qs<HTMLInputElement>('#new-custom');
  const equivInput = qs<HTMLInputElement>('#new-equiv');
  const msg = qs<HTMLSpanElement>('#def-add-msg');
  const cust = custInput.value.trim();
  const equiv = equivInput.value.trim();
  const cat = qs<HTMLSelectElement>('#new-category').value as MappingCategory;
  if (!cust || !equiv) {
    msg.textContent = 'Fill in both "your phrase" and "becomes".';
    (cust ? equivInput : custInput).focus();
    return;
  }
  msg.textContent = '';
  const mapping: LanguageMapping = {
    id: 'user-' + Math.random().toString(36).slice(2, 10),
    customSyntax: cust,
    equivalentSyntax: equiv,
    category: cat,
    description: 'User-defined',
    isDefault: false,
  };
  state.userMappings.push(mapping);
  saveUserMappings();
  custInput.value = '';
  equivInput.value = '';
  custInput.focus();
  renderDefinitions();
  renderCode();
}

// ─────────────────────────────────────────────────────────────────────
// Initial mount
// ─────────────────────────────────────────────────────────────────────

const SHORTCUTS: [string, string][] = [
  [`${MOD}↵`,       'run the program'],
  ['Esc',           'stop a running program'],
  [`${MOD}S`,       'save (it autosaves too)'],
  [`${MOD}${SHIFT}S`, 'download as program.txt'],
  [`${MOD}O`,       'open a program file'],
  [`${MOD}/`,       'comment the line out (note:) or back in'],
  ['Tab / ⇧Tab',    'indent / outdent'],
  ['↑ ↓ ↵',         'pick a suggestion while typing'],
  ['Esc then Tab',  'leave the editor'],
];

async function mount(): Promise<void> {
  // A shared link carries the program in its hash
  const shared = await decodeShareHash(location.hash);
  if (shared !== null) state.source = shared;
  else if (location.hash.length > 1) {
    pendingNote = "(couldn't read the program in this link, so this is your last saved one)";
  }

  // Populate example dropdown
  const dropdown = qs<HTMLSelectElement>('#example-select');
  for (const ex of EXAMPLES) {
    const opt = el('option', { value: ex.name }, ex.name);
    dropdown.append(opt);
  }
  dropdown.addEventListener('change', () => {
    const ex = EXAMPLES.find(e => e.name === dropdown.value);
    // Back to the placeholder so the same example can be picked again
    dropdown.selectedIndex = 0;
    if (!ex) return;
    if (!confirmReplace(`the "${ex.name}" example`)) return;
    setSource(ex.code);
    run();
  });

  // Populate category dropdowns
  const catSelect = qs<HTMLSelectElement>('#category-filter');
  for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
    catSelect.append(el('option', { value: key }, label));
  }
  catSelect.addEventListener('change', () => {
    state.filterCategory = catSelect.value as MappingCategory | 'all';
    renderDefinitions();
  });

  const newCatSelect = qs<HTMLSelectElement>('#new-category');
  for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
    newCatSelect.append(el('option', { value: key }, label));
  }

  // Editor
  const editor = qs<HTMLTextAreaElement>('#editor');
  editor.value = state.source;
  editor.addEventListener('input', () => {
    state.source = editor.value;
    renderGutter();
    queueSave();
    queueCode();
    updateAutocomplete();
  });
  editor.addEventListener('scroll', () => {
    syncEditorScroll();
    closeAutocomplete();
  });
  editor.addEventListener('keydown', handleEditorKeys);
  editor.addEventListener('blur', closeAutocomplete);
  editor.addEventListener('click', closeAutocomplete);
  // Don't lose a pending autosave when the tab closes
  window.addEventListener('pagehide', () => saveSource(false));

  // Drop a .txt program onto the editor to open it
  const editorPane = qs<HTMLElement>('.editor-pane');
  editorPane.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    editorPane.classList.add('drop-target');
  });
  editorPane.addEventListener('dragleave', () => editorPane.classList.remove('drop-target'));
  editorPane.addEventListener('drop', (e) => {
    editorPane.classList.remove('drop-target');
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    e.preventDefault();
    openFile(file);
  });

  qs<HTMLSpanElement>('#key-hint').textContent = `${MOD}↵ run · ${MOD}S save`;

  // Run / stop / clear
  const runBtn = qs<HTMLButtonElement>('#run-btn');
  runBtn.title = `Run (${MOD}Enter)`;
  runBtn.addEventListener('click', run);
  qs<HTMLButtonElement>('#stop-btn').addEventListener('click', () => stopRun(true));
  qs<HTMLButtonElement>('#clear-btn').addEventListener('click', () => {
    stopRun(false);
    qs<HTMLPreElement>('#output-pane').textContent = '';
    state.errorLine = null;
    renderGutter();
  });

  // Share / download / open / shortcuts
  qs<HTMLButtonElement>('#share-btn').addEventListener('click', share);
  qs<HTMLButtonElement>('#share-copy-btn').addEventListener('click', async () => {
    const ok = await copyText(qs<HTMLInputElement>('#share-url').value);
    qs<HTMLElement>('#share-status').textContent = ok ? 'copied to your clipboard' : 'select the link and copy it';
  });
  qs<HTMLButtonElement>('#download-btn').addEventListener('click', downloadProgram);
  const fileInput = qs<HTMLInputElement>('#file-input');
  qs<HTMLButtonElement>('#upload-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) openFile(file);
  });
  const keysList = qs<HTMLDListElement>('#keys-list');
  for (const [keys, what] of SHORTCUTS) {
    keysList.append(el('dt', {}, el('kbd', {}, keys)), el('dd', {}, what));
  }
  qs<HTMLButtonElement>('#help-btn').addEventListener('click', () => qs<HTMLDialogElement>('#help-dialog').showModal());

  // Theme button
  renderThemeButton();
  qs<HTMLButtonElement>('#theme-btn').addEventListener('click', toggleTheme);

  // Translated-code pane
  const codeToggle = qs<HTMLInputElement>('#code-toggle');
  codeToggle.addEventListener('change', () => setShowCode(codeToggle.checked));
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.seg-btn')) {
    btn.addEventListener('click', () => setTarget(btn.dataset.target as Target));
  }
  qs<HTMLButtonElement>('#copy-code-btn').addEventListener('click', async () => {
    const ok = await copyText(qs<HTMLPreElement>('#code-pane-body').textContent ?? '');
    flash('#code-status', ok ? 'copied' : "couldn't copy");
  });
  qs<HTMLButtonElement>('#download-code-btn').addEventListener('click', () => {
    downloadText('program.' + TARGET_EXTENSIONS[state.target], qs<HTMLPreElement>('#code-pane-body').textContent ?? '');
    flash('#code-status', 'downloaded');
  });
  setTarget(state.target);
  setShowCode(state.showCode);

  // Defaults toggle
  const defaultsToggle = qs<HTMLInputElement>('#defaults-toggle');
  defaultsToggle.checked = state.useDefaults;
  defaultsToggle.addEventListener('change', () => {
    state.useDefaults = defaultsToggle.checked;
    saveUseDefaults();
    renderDefinitions();
  });

  // Reset button
  qs<HTMLButtonElement>('#reset-mappings-btn').addEventListener('click', () => {
    if (!confirm('Reset: remove all your custom mappings and re-enable defaults?')) return;
    state.userMappings = [];
    state.useDefaults = true;
    saveUserMappings();
    saveUseDefaults();
    defaultsToggle.checked = true;
    renderDefinitions();
    renderCode();
  });

  // Add mapping (a form, so Enter in either field adds it too)
  qs<HTMLFormElement>('#def-add').addEventListener('submit', (e) => {
    e.preventDefault();
    addUserMapping();
  });

  // Search
  const searchInput = qs<HTMLInputElement>('#search-input');
  searchInput.addEventListener('input', () => {
    state.searchText = searchInput.value;
    renderDefinitions();
  });

  // Keyboard: Cmd/Ctrl+Enter runs, Cmd/Ctrl+S saves, Esc stops, and so on
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.running) {
      stopRun(true);
      return;
    }
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    if (e.key === 'Enter') {
      e.preventDefault();
      run();
    } else if (key === 's' && !e.altKey) {
      e.preventDefault();
      if (e.shiftKey) downloadProgram();
      else saveSource(true);
    } else if (key === 'o' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      fileInput.click();
    }
  });

  // Pasting a different share link into the same tab loads it
  window.addEventListener('hashchange', async () => {
    const code = await decodeShareHash(location.hash);
    if (code === null) {
      if (location.hash.length > 1) {
        qs<HTMLPreElement>('#output-pane').append(
          el('span', { class: 'out-note' }, "(couldn't read the program in this link)\n"));
      }
      return;
    }
    if (code === state.source) return;
    if (!confirmReplace('the program from this link')) return;
    setSource(code);
    run();
  });

  renderDefinitions();
  renderGutter();
  run();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { mount(); });
} else {
  mount();
}
