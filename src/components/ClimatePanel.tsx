import { useEffect, useState } from 'react';
import { CLIMATE_LAYERS, MAPBS_LINK, wmsLegendJsonUrl, type ClimateLayer } from '../config';
import { Icon } from './Icons';

interface Props {
  open: boolean;
  onToggleOpen: () => void;
  activeId: string | null;
  onSelect: (id: string | null) => void;
  year: 'today' | '2030';
  onYear: (y: 'today' | '2030') => void;
  opacity: number;
  onOpacity: (v: number) => void;
  trees: boolean;
  onTrees: () => void;
  treeStatus: string;
  loadingTiles: boolean;
}

interface LegendItem {
  title: string;
  icon?: string;
}

const legendCache = new Map<string, LegendItem[] | null>();

function useWmsLegend(layer: string | null) {
  const [items, setItems] = useState<LegendItem[] | null>(null);
  useEffect(() => {
    if (!layer) return setItems(null);
    if (legendCache.has(layer)) return setItems(legendCache.get(layer)!);
    const ctl = new AbortController();
    fetch(wmsLegendJsonUrl(layer), { signal: ctl.signal })
      .then((r) => r.json())
      .then((j: { nodes?: { symbols?: LegendItem[] }[] }) => {
        const syms = (j.nodes ?? []).flatMap((n) => n.symbols ?? []).filter((s) => s.title && s.icon);
        const v = syms.length ? syms : null;
        legendCache.set(layer, v);
        setItems(v);
      })
      .catch(() => setItems(null));
    return () => ctl.abort();
  }, [layer]);
  return items;
}

export function ClimatePanel(p: Props) {
  const active: ClimateLayer | undefined = CLIMATE_LAYERS.find((l) => l.id === p.activeId);
  const wmsName = active ? (p.year === '2030' && active.wms2030 ? active.wms2030 : active.wms) : null;
  const legend = useWmsLegend(wmsName);

  return (
    <div className={`climate ${p.open ? 'is-open' : ''}`}>
      <button className="glass climate__toggle" onClick={p.onToggleOpen} aria-expanded={p.open}>
        <Icon.layers />
        <span>Basel climate data</span>
        {(p.activeId || p.trees) && <span className="badge">{(p.activeId ? 1 : 0) + (p.trees ? 1 : 0)}</span>}
      </button>

      <div className="glass climate__panel" aria-hidden={!p.open}>
        <p className="eyebrow">Official data · Kanton Basel-Stadt</p>

        <button className={`layer-row ${p.trees ? 'on' : ''}`} onClick={p.onTrees} aria-pressed={p.trees}>
          <span className="layer-row__icon green"><Icon.tree /></span>
          <span className="layer-row__txt">
            <strong>Street & park trees</strong>
            <small>{p.treeStatus}</small>
          </span>
          <span className="switch" />
        </button>

        <div className="climate__sep">
          <span>Klimaanalyse</span>
          <div className="segmented small">
            <button className={p.year === 'today' ? 'on' : ''} onClick={() => p.onYear('today')}>Today</button>
            <button className={p.year === '2030' ? 'on' : ''} onClick={() => p.onYear('2030')}>2030</button>
          </div>
        </div>

        <div className="climate__list">
          {CLIMATE_LAYERS.map((l) => {
            const on = p.activeId === l.id;
            const no2030 = p.year === '2030' && !l.wms2030 && l.id !== 'areal';
            return (
              <button
                key={l.id}
                className={`layer-row ${on ? 'on' : ''}`}
                onClick={() => p.onSelect(on ? null : l.id)}
                aria-pressed={on}
              >
                <span className="layer-row__icon warm"><Icon.thermo /></span>
                <span className="layer-row__txt">
                  <strong>{l.label}</strong>
                  <small>
                    {l.time}
                    {l.unit ? ` · ${l.unit}` : ''}
                    {no2030 ? ' · no 2030 scenario' : ''}
                  </small>
                </span>
                <span className="radio" />
              </button>
            );
          })}
        </div>

        {active && (
          <div className="climate__detail">
            <p>{active.description}</p>
            {legend ? (
              <ul className="wms-legend">
                {legend.map((s) => (
                  <li key={s.title}>
                    <img src={`data:image/png;base64,${s.icon}`} alt="" />
                    {s.title}
                  </li>
                ))}
              </ul>
            ) : active.ramp ? (
              <div className="ramp">
                <span style={{ background: `linear-gradient(90deg, ${active.ramp.join(',')})` }} />
                <div><small>weaker</small><small>stronger</small></div>
              </div>
            ) : null}
            {!legend && (
              <p className="muted">
                Class values for this raster aren't published through the WMS legend. Exact values are in{' '}
                <a href={MAPBS_LINK} target="_blank" rel="noreferrer">MapBS <Icon.ext /></a>.
              </p>
            )}
            <label className="opacity">
              <span>Opacity</span>
              <input
                type="range"
                min={0.15}
                max={1}
                step={0.05}
                value={p.opacity}
                onChange={(e) => p.onOpacity(parseFloat(e.target.value))}
              />
            </label>
            {p.loadingTiles && <p className="muted shimmer">Loading tiles from geo.bs.ch…</p>}
          </div>
        )}

        <p className="climate__src">
          Sources: Geodaten Kanton Basel-Stadt (wms.geo.bs.ch) · Stadtklimakonzept / Klimaanalyse · Open Data
          Basel-Stadt Baumkataster.{' '}
          <a href={MAPBS_LINK} target="_blank" rel="noreferrer">Open in MapBS <Icon.ext /></a>
        </p>
      </div>
    </div>
  );
}
