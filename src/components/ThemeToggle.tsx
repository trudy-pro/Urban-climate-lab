import { toggleTheme, useTheme } from '../theme';

export function ThemeToggle({ named = false }: { named?: boolean }) {
  const dark = useTheme() === 'dark';
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  const name = dark ? 'Light mode' : 'Dark mode';

  return (
    <button type="button" className="basel-theme-toggle" onClick={toggleTheme} aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {dark
          ? <><circle cx="12" cy="12" r="4" /><path d="M12 3v2m0 14v2M3 12h2m14 0h2M6 6l1.5 1.5m9 9L18 18M6 18l1.5-1.5m9-9L18 6" /></>
          : <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />}
      </svg>
      {named && <span>{name}</span>}
    </button>
  );
}
