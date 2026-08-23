import i18n from './i18n';
import { APP_TEXT } from './app-text';
import { PLATFORM_TEXT } from './platform/platform-text';
import { UI_COPY } from './ui-copy';

type Lang = 'ja' | 'en';

type PairMap = Map<string, { ja: string; en: string }>;

const SKIP_SELECTOR = [
  'input', 'textarea', 'select', 'option', 'pre', 'code', '[contenteditable="true"]',
  '.result-card p', '.result-sources', '.history-record strong', '.project-list-button strong',
  '.project-result-row strong', '.platform-recent-list a span', '[data-user-content]',
].join(',');

const UI_TEXT_HOST_SELECTOR = [
  'button', 'a', 'summary', 'label', 'legend', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  '.platform-page-head p', '.platform-eyebrow', '.platform-state', '.platform-side-section-title',
  '.platform-recent-state', '.result-schema-warning', '.result-deleted-banner', '.history-pagination',
  '.platform-panel > header', '.platform-field > span', '.settings-surface-host', '[data-ui-copy]',
].join(',');

function currentLanguage(): Lang {
  return i18n.resolvedLanguage?.toLowerCase().startsWith('en') ? 'en' : 'ja';
}

function flatten(value: unknown, prefix = '', output: Record<string, string> = {}): Record<string, string> {
  if (!value || typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') output[path] = child;
    else flatten(child, path, output);
  }
  return output;
}

function appendPairs(target: PairMap, ja: Record<string, string>, en: Record<string, string>) {
  const keys = new Set([...Object.keys(ja), ...Object.keys(en)]);
  for (const key of keys) {
    const jaValue = ja[key];
    const enValue = en[key];
    if (!jaValue || !enValue) continue;
    const pair = { ja: jaValue, en: enValue };
    target.set(jaValue, pair);
    target.set(enValue, pair);
  }
}

function buildPairs(): PairMap {
  const pairs: PairMap = new Map();
  appendPairs(pairs, APP_TEXT.ja as Record<string, string>, APP_TEXT.en as Record<string, string>);
  appendPairs(pairs, PLATFORM_TEXT.ja as Record<string, string>, PLATFORM_TEXT.en as Record<string, string>);
  appendPairs(pairs, UI_COPY.ja as Record<string, string>, UI_COPY.en as Record<string, string>);

  const store = i18n.store.data as Record<string, { translation?: unknown }>;
  appendPairs(pairs, flatten(store.ja?.translation), flatten(store.en?.translation));
  return pairs;
}

function translateExact(value: string, pairs: PairMap, language: Lang): string {
  const pair = pairs.get(value.trim());
  if (!pair) return value;
  const translated = pair[language];
  if (value === value.trim()) return translated;
  const start = value.match(/^\s*/)?.[0] ?? '';
  const end = value.match(/\s*$/)?.[0] ?? '';
  return `${start}${translated}${end}`;
}

function shouldProcessTextNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent || parent.closest(SKIP_SELECTOR)) return false;
  return Boolean(parent.closest(UI_TEXT_HOST_SELECTOR));
}

function applyText(root: ParentNode, pairs: PairMap, language: Lang) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text && shouldProcessTextNode(current)) nodes.push(current);
    current = walker.nextNode();
  }
  for (const node of nodes) {
    const next = translateExact(node.nodeValue ?? '', pairs, language);
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  const elements = root instanceof Element ? [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))] : Array.from(root.querySelectorAll<HTMLElement>('*'));
  for (const element of elements) {
    if (!(element instanceof HTMLElement) || element.closest(SKIP_SELECTOR)) continue;
    for (const attribute of ['aria-label', 'title', 'placeholder'] as const) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const next = translateExact(value, pairs, language);
      if (next !== value) element.setAttribute(attribute, next);
    }
  }
}

export function initializeUiTextRuntime() {
  let pairs = buildPairs();
  let language = currentLanguage();
  let applying = false;

  const apply = (root: ParentNode = document.body) => {
    if (applying || !root) return;
    applying = true;
    try { applyText(root, pairs, language); }
    finally { applying = false; }
  };

  const observer = new MutationObserver((mutations) => {
    if (applying) return;
    for (const mutation of mutations) {
      if (mutation.type === 'characterData' && mutation.target.parentNode) apply(mutation.target.parentNode);
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof Element) apply(node);
      }
    }
  });

  const start = () => {
    apply(document.body);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  };

  if (document.body) start();
  else window.addEventListener('DOMContentLoaded', start, { once: true });

  i18n.on('languageChanged', () => {
    language = currentLanguage();
    pairs = buildPairs();
    apply(document.body);
  });

  return () => {
    observer.disconnect();
    i18n.off('languageChanged');
  };
}
