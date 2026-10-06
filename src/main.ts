// LangIDE web — entry point.
//
// Wires up the editor, output, example dropdown, debug toggle, and the
// language-definitions panel. Everything runs in-browser — no network
// calls, no server-side execution. The program you're editing and your
// mappings persist in localStorage.

import { NaturalLanguageTranslator } from './translator';
import { runProgram } from './runtime';
import { EXAMPLES } from './examples';
import {
  DEFAULT_MAPPINGS,
  CATEGORY_LABELS,
  type LanguageMapping,
  type MappingCategory,
} from './mappings';

const USER_MAPPINGS_KEY = 'langide-web.userMappings.v1';
const USE_DEFAULTS_KEY  = 'langide-web.useDefaults';
const SOURCE_KEY        = 'langide-web.source.v1';
const THEME_KEY         = 'theme'; // shared with the rest of j4den.com

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';

interface AppState {
  source: string;
  debugMode: boolean;
  useDefaults: boolean;
  userMappings: LanguageMapping[];
  filterCategory: MappingCategory | 'all';
  searchText: string;
  errorLine: number | null;
}

const state: AppState = {
  source: loadSource(),
  debugMode: false,
  useDefaults: loadUseDefaults(),
  userMappings: loadUserMappings(),
  filterCategory: 'all',
  searchText: '',
  errorLine: null,
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

let saveTimer: number | undefined;
let statusTimer: number | undefined;

function saveSource(announce: boolean): void {
  window.clearTimeout(saveTimer);
  const ok = writeStorage(SOURCE_KEY, state.source);
  if (announce) {
    const status = qs<HTMLSpanElement>('#save-status');
    status.textContent = ok ? 'saved' : "can't save here (private window?)";
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => { status.textContent = ''; }, 1600);
  }
}

// Autosave shortly after typing stops
function queueSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveSource(false), 400);
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
// Run / compile
// ─────────────────────────────────────────────────────────────────────

function run(): void {
  const outputEl = qs<HTMLPreElement>('#output-pane');
  const preprocessed = applyUserPreprocessing(state.source);
  const result = runProgram(preprocessed);

  outputEl.textContent = '';
  if (state.debugMode) {
    // The translator is the "show the transformation" feature
    const translated = new NaturalLanguageTranslator(preprocessed).translate();
    outputEl.append(
      el('span', { class: 'out-note' }, '— translated intermediate C —\n'),
      translated + '\n',
      el('span', { class: 'out-note' }, '\n— execution —\n'),
    );
  }

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
  } else if (!result.output && !state.debugMode) {
    // Say so rather than leave a silent pane
    outputEl.append(el('span', { class: 'out-note' }, '(program ran — no output)\n'));
  }

  state.errorLine = result.success ? null : result.line ?? null;
  renderGutter();
}

// ─────────────────────────────────────────────────────────────────────
// Editor — line-number gutter, jump to line, indentation keys
// ─────────────────────────────────────────────────────────────────────

let gutterLines = 0;

function renderGutter(): void {
  const gutter = qs<HTMLDivElement>('#gutter');
  const count = state.source.split('\n').length;
  if (count !== gutterLines) {
    gutter.textContent = '';
    for (let i = 1; i <= count; i++) gutter.append(el('div', {}, String(i)));
    gutterLines = count;
  }
  gutter.querySelector('.err')?.classList.remove('err');
  if (state.errorLine && state.errorLine <= count) {
    gutter.children[state.errorLine - 1].classList.add('err');
  }
  gutter.scrollTop = qs<HTMLTextAreaElement>('#editor').scrollTop;
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
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 20;
  editor.scrollTop = Math.max(0, (line - 1) * lineHeight - editor.clientHeight / 2);
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
  if (e.key === 'Escape') { tabReleased = true; return; }
  if (e.key === 'Tab' && !tabReleased && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    if (e.shiftKey) outdentLine(editor);
    else insertText(editor, '  ');
    return;
  }
  tabReleased = false;

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

function setSource(code: string): void {
  state.source = code;
  qs<HTMLTextAreaElement>('#editor').value = code;
  state.errorLine = null;
  renderGutter();
  saveSource(false);
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
  btn.textContent = isLight() ? 'dark' : 'light';
  const label = isLight() ? 'Switch to dark theme' : 'Switch to light theme';
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

function toggleTheme(): void {
  const next = isLight() ? 'dark' : 'light';
  if (next === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
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
}

// ─────────────────────────────────────────────────────────────────────
// Initial mount
// ─────────────────────────────────────────────────────────────────────

function mount(): void {
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
    // Only ask when the editor holds the user's own work
    const ownWork = state.source.trim() !== '' && !EXAMPLES.some(e => e.code === state.source);
    if (ownWork && !confirm(`Replace your program with the "${ex.name}" example?`)) return;
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
  });
  editor.addEventListener('scroll', () => {
    qs<HTMLDivElement>('#gutter').scrollTop = editor.scrollTop;
  });
  editor.addEventListener('keydown', handleEditorKeys);
  // Don't lose a pending autosave when the tab closes
  window.addEventListener('pagehide', () => saveSource(false));

  qs<HTMLSpanElement>('#key-hint').textContent = `${MOD}↵ run · ${MOD}S save`;

  // Run button
  const runBtn = qs<HTMLButtonElement>('#run-btn');
  runBtn.title = `Run (${MOD}Enter)`;
  runBtn.addEventListener('click', run);

  // Clear button
  qs<HTMLButtonElement>('#clear-btn').addEventListener('click', () => {
    qs<HTMLPreElement>('#output-pane').textContent = '';
    state.errorLine = null;
    renderGutter();
  });

  // Theme button
  renderThemeButton();
  qs<HTMLButtonElement>('#theme-btn').addEventListener('click', toggleTheme);

  // Debug toggle — re-run so the translation shows (or hides) right away
  const debugToggle = qs<HTMLInputElement>('#debug-toggle');
  debugToggle.checked = state.debugMode;
  debugToggle.addEventListener('change', () => {
    state.debugMode = debugToggle.checked;
    run();
  });

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

  // Keyboard: Cmd/Ctrl+Enter runs, Cmd/Ctrl+S saves
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      run();
    } else if (e.key.toLowerCase() === 's' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      saveSource(true);
    }
  });

  renderDefinitions();
  run();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
