import { useSyncExternalStore } from 'react';
import darkMain from './styles.css?inline';
import paperMain from './styles.light.css?inline';
import cutaway from './components/beneath/beneath.css?inline';
import paperMarker from './components/paper/therwilerstrasseMarker.css?inline';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'basel-theme';
const styles = {
  light: [paperMain, paperMarker, cutaway].join('\n'),
  dark: [darkMain, cutaway].join('\n'),
};

let theme: Theme = 'dark';
try {
  if (localStorage.getItem(STORAGE_KEY) === 'light') theme = 'light';
} catch {
  // Storage may be unavailable in private or embedded contexts.
}
const listeners = new Set<() => void>();
export const getTheme = () => theme;

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useTheme = () => useSyncExternalStore(subscribeTheme, getTheme);

export function applyDocumentTheme() {
  let sheet = document.getElementById('basel-theme') as HTMLStyleElement | null;
  if (!sheet) {
    sheet = document.createElement('style');
    sheet.id = 'basel-theme';
    document.head.prepend(sheet);
  }
  sheet.textContent = styles[theme];
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#e4e5dc' : '#060a12');
}

export function toggleTheme() {
  theme = theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* preference lasts for this page */ }
  applyDocumentTheme();
  listeners.forEach((listener) => listener());
}
