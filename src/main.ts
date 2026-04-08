// LangIDE web — entry point.
//
// Wires up the editor, output, example dropdown, debug toggle, and the
// language-definitions panel. Everything runs in-browser — no network
// calls, no server-side execution. User mappings persist in
// localStorage.

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

interface AppState {
  source: string;
  debugMode: boolean;
  useDefaults: boolean;
  userMappings: LanguageMapping[];
  filterCategory: MappingCategory | 'all';
  searchText: string;
}

const state: AppState = {
  source: EXAMPLES[0].code,
  debugMode: false,
  useDefaults: loadUseDefaults(),
  userMappings: loadUserMappings(),
  filterCategory: 'all',
  searchText: '',
};

// ─────────────────────────────────────────────────────────────────────
// Persistence helpers
// ─────────────────────────────────────────────────────────────────────

function loadUserMappings(): LanguageMapping[] {
  try {
    const raw = localStorage.getItem(USER_MAPPINGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LanguageMapping[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(m => m && typeof m.customSyntax === 'string' && typeof m.equivalentSyntax === 'string');
  } catch {
    return [];
  }
}

function saveUserMappings(): void {
  localStorage.setItem(USER_MAPPINGS_KEY, JSON.stringify(state.userMappings));
}

function loadUseDefaults(): boolean {
  const v = localStorage.getItem(USE_DEFAULTS_KEY);
  return v === null ? true : v === 'true';
}

function saveUseDefaults(): void {
  localStorage.setItem(USE_DEFAULTS_KEY, String(state.useDefaults));
}

// ─────────────────────────────────────────────────────────────────────
// Preprocessing — apply user mappings as simple string substitution
// ─────────────────────────────────────────────────────────────────────

function applyUserPreprocessing(source: string): string {
  if (state.userMappings.length === 0) return source;
  let result = source;
  const sorted = [...state.userMappings].sort(
    (a, b) => b.customSyntax.length - a.customSyntax.length
  );
  for (const m of sorted) {
    if (!m.customSyntax) continue;
    if (m.customSyntax.includes('NAME') || m.customSyntax.includes('VALUE')) continue;
    result = result.split(m.customSyntax).join(m.equivalentSyntax);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Run / compile
// ─────────────────────────────────────────────────────────────────────

function run(): void {
  const outputEl = qs<HTMLPreElement>('#output-pane');
  const preprocessed = applyUserPreprocessing(state.source);

  // Translator always runs — it's the "show the transformation" feature.
  const translator = new NaturalLanguageTranslator(preprocessed);
  const translated = translator.translate();

  // Interpret the original (preprocessed) English source.
  const result = runProgram(preprocessed);

  let text = '';
  if (state.debugMode) {
    text += '— translated intermediate C —\n';
    text += translated + '\n';
    text += '\n— execution —\n';
  }
  if (result.success) {
    text += result.output;
  } else {
    text += `Error: ${result.error}\n`;
    if (state.debugMode && result.output) {
      text += '\n(partial output before error)\n' + result.output;
    }
  }

  // If output is empty and the program parsed, let the user know nothing
  // was printed (rather than a silent pane).
  if (result.success && !result.output && !state.debugMode) {
    text = '(program ran — no output)\n';
  }

  outputEl.textContent = text;
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
  listEl.innerHTML = '';

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
      el('div', { class: 'def-arrow' }, '→'),
      el('div', { class: 'def-equiv' }, m.equivalentSyntax),
    );
    if (m.description) {
      row.append(el('div', { class: 'def-desc' }, m.description));
    }
    if (!m.isDefault) {
      const actions = el('div', { class: 'def-actions' });
      const del = el('button', { class: 'def-delete', type: 'button' }, '✕');
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
  const cust = qs<HTMLInputElement>('#new-custom').value.trim();
  const equiv = qs<HTMLInputElement>('#new-equiv').value.trim();
  const cat = qs<HTMLSelectElement>('#new-category').value as MappingCategory;
  if (!cust || !equiv) {
    alert('Both "your phrase" and "becomes" are required.');
    return;
  }
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
  qs<HTMLInputElement>('#new-custom').value = '';
  qs<HTMLInputElement>('#new-equiv').value = '';
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
    if (ex) {
      state.source = ex.code;
      qs<HTMLTextAreaElement>('#editor').value = ex.code;
    }
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
  editor.addEventListener('input', () => { state.source = editor.value; });

  // Run button
  qs<HTMLButtonElement>('#run-btn').addEventListener('click', run);

  // Clear button
  qs<HTMLButtonElement>('#clear-btn').addEventListener('click', () => {
    qs<HTMLPreElement>('#output-pane').textContent = '';
  });

  // Debug toggle
  const debugToggle = qs<HTMLInputElement>('#debug-toggle');
  debugToggle.checked = state.debugMode;
  debugToggle.addEventListener('change', () => {
    state.debugMode = debugToggle.checked;
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

  // Add mapping button
  qs<HTMLButtonElement>('#add-mapping-btn').addEventListener('click', addUserMapping);

  // Search
  const searchInput = qs<HTMLInputElement>('#search-input');
  searchInput.addEventListener('input', () => {
    state.searchText = searchInput.value;
    renderDefinitions();
  });

  // Keyboard: Cmd/Ctrl+Enter runs the program
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
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
