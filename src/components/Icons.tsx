const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const Icon = {
  plus: () => (
    <svg viewBox="0 0 24 24" width="18" height="18"><path {...P} d="M12 5v14M5 12h14" /></svg>
  ),
  minus: () => (
    <svg viewBox="0 0 24 24" width="18" height="18"><path {...P} d="M5 12h14" /></svg>
  ),
  rotL: () => (
    <svg viewBox="0 0 24 24" width="18" height="18"><path {...P} d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" /></svg>
  ),
  rotR: () => (
    <svg viewBox="0 0 24 24" width="18" height="18"><path {...P} d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" /></svg>
  ),
  tilt: () => (
    <svg viewBox="0 0 24 24" width="18" height="18"><path {...P} d="M4 18l4-10h8l4 10zM8 8l-1 10M16 8l1 10M5.5 13h13" /></svg>
  ),
  reset: () => (
    <svg viewBox="0 0 24 24" width="18" height="18"><path {...P} d="M3 12l9-8 9 8M5 10v10h14V10" /></svg>
  ),
  target: () => (
    <svg viewBox="0 0 24 24" width="18" height="18"><path {...P} d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle {...P} cx="12" cy="9.5" r="2.5" /></svg>
  ),
  drop: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path {...P} d="M12 3.5c3.6 4.4 6 7.6 6 10.6a6 6 0 0 1-12 0c0-3 2.4-6.2 6-10.6Z" /></svg>
  ),
  flow: () => (
    <svg viewBox="0 0 24 24" width="18" height="18"><path {...P} d="M3 7c3 0 3 2 6 2s3-2 6-2 3 2 6 2M3 12c3 0 3 2 6 2s3-2 6-2 3 2 6 2M3 17c3 0 3 2 6 2s3-2 6-2" /></svg>
  ),
  layers: () => (
    <svg viewBox="0 0 24 24" width="18" height="18"><path {...P} d="M12 4l9 5-9 5-9-5zM3 14l9 5 9-5" /></svg>
  ),
  section: () => (
    <svg viewBox="0 0 24 24" width="18" height="18"><path {...P} d="M3 10h18M3 10v10h18V10M7 10V6l3-2 3 2v4M16 10V7" /><path {...P} d="M6 14h3M12 16h5M8 18h2" /></svg>
  ),
  tree: () => (
    <svg viewBox="0 0 24 24" width="18" height="18"><path {...P} d="M12 21v-6M12 15a5 5 0 1 0-4.6-7A4 4 0 0 0 8 16h8a4 4 0 0 0 .6-8" /></svg>
  ),
  thermo: () => (
    <svg viewBox="0 0 24 24" width="18" height="18"><path {...P} d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0z" /></svg>
  ),
  close: () => (
    <svg viewBox="0 0 24 24" width="16" height="16"><path {...P} d="M6 6l12 12M18 6L6 18" /></svg>
  ),
  ext: () => (
    <svg viewBox="0 0 24 24" width="12" height="12"><path {...P} d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" /></svg>
  ),
};
