import type { Ref } from 'react';
import { LAYERS, type LayerId } from './section/geometry';
import { FLOW_STEPS } from './section/flowPaths';

export type UgView = 'map' | 'flows';

interface Props {
  open: boolean;
  view: UgView;
  onView: (v: UgView) => void;
  focus: LayerId | null;
  onFocus: (id: LayerId | null) => void;
  /** picked step in the water-flows view */
  flowStep: string | null;
  onFlowStep: (id: string | null) => void;
  apart: boolean;
  onApart: (v: boolean) => void;
  water: boolean;
  onWater: () => void;
  onSection: () => void;
  onClose: () => void;
  /** SVG the cutaway scene projects the water paths onto */
  flowSvgRef: Ref<SVGSVGElement>;
}

export function UndergroundView(p: Props) {
  const flows = p.view === 'flows';
  const info = LAYERS.find((l) => l.id === p.focus);
  const step = FLOW_STEPS.find((s) => s.id === p.flowStep);
  const pickStep = (id: string) => {
    const next = p.flowStep === id ? null : id;
    p.onFlowStep(next);
    p.onFocus(next ? FLOW_STEPS.find((s) => s.id === next)!.layer : null);
  };

  return (
    <div className={`ug ${p.open ? 'is-open' : ''} ${flows ? 'is-flows' : ''}`} aria-hidden={!p.open} inert={!p.open}>
      {p.open && flows && <svg className="ug__flows" ref={p.flowSvgRef} aria-hidden="true">
        {FLOW_STEPS.map((s, i) => (
          <g
            key={s.id}
            data-flow={s.id}
            className={`${s.dashed ? 'is-dashed' : ''} ${p.flowStep === s.id ? 'is-on' : p.flowStep ? 'is-dim' : ''}`}
            style={{ color: s.color }}
          >
            <path className="ug__flow-glow" />
            <path className="ug__flow-line" />
            <g className="ug__badge" onClick={() => pickStep(s.id)}>
              <circle r="10" />
              <text textAnchor="middle" dy="4">{i + 1}</text>
            </g>
          </g>
        ))}
      </svg>}

      <aside className="glass ug__panel">
        <div className="segmented ug__views" role="tablist" aria-label="Underground view">
          <button role="tab" aria-selected={!flows} className={!flows ? 'on' : ''} onClick={() => p.onView('map')}>Map</button>
          <button role="tab" aria-selected={flows} className={flows ? 'on' : ''} onClick={() => p.onView('flows')}>Water flows</button>
        </div>

        <div className="ug__row">
          <div className="segmented small" role="radiogroup" aria-label="Layer arrangement">
            <button role="radio" aria-checked={!p.apart} className={!p.apart ? 'on' : ''} onClick={() => p.onApart(false)}>Together</button>
            <button role="radio" aria-checked={p.apart} className={p.apart ? 'on' : ''} onClick={() => p.onApart(true)}>Pulled apart</button>
          </div>
          <button className={`sx-chip ${p.water ? 'is-on' : ''}`} aria-label="Rain over the layers" aria-pressed={p.water} onClick={p.onWater}>{p.water ? 'Stop rain' : 'Make it rain'}</button>
        </div>

        {flows ? (
          <ol className="ug__list ug__steps" role="radiogroup" aria-label="Water paths">
            {FLOW_STEPS.map((s, i) => (
              <li key={s.id}>
                <button role="radio" aria-checked={p.flowStep === s.id} className={`sx-layer ${p.flowStep === s.id ? 'is-on' : ''}`} onClick={() => pickStep(s.id)}>
                  <b className="ug__n" style={{ background: s.color }}>{i + 1}</b>
                  {s.label}
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <ol className="ug__list" role="radiogroup" aria-label="Underground layers">
            {LAYERS.map((l) => (
              <li key={l.id}>
                <button role="radio" aria-checked={p.focus === l.id} className={`sx-layer ${p.focus === l.id ? 'is-on' : ''}`} onClick={() => p.onFocus(p.focus === l.id ? null : l.id)}>
                  <i className={`sx-swatch sx-swatch--${l.id}`} />
                  {l.label}
                </button>
              </li>
            ))}
          </ol>
        )}

        <p className="ug__text" aria-live="polite">
          {flows ? (
            step ? (
              <>
                <strong>{step.label}.</strong> {step.text}
              </>
            ) : (
              'Rain on a sponge-city street takes several paths at once. Most of it is kept near the tree; some still reaches the sewer.'
            )
          ) : info ? (
            <>
              <strong>{info.label}.</strong> {info.text}
            </>
          ) : (
            'Pick a layer to see it on its own. Blue drops show rain running off the street into the planted strip, being held in the tree substrate, and a little seeping deeper.'
          )}
        </p>

        <div className="ug__actions">
          <button className="sx-btn" onClick={p.onSection}>Street section</button>
          <button className="sx-btn" onClick={p.onClose}>Back to map</button>
        </div>
      </aside>
    </div>
  );
}
