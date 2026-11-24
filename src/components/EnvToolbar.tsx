import { RainIntensity, type RainLevel } from './RainIntensity';
import { Icon } from './Icons';

interface Props {
  visible: boolean;
  unlocked: boolean;
  rain: boolean;
  intensity: RainLevel;
  onIntensity: (i: RainLevel) => void;
  flows: boolean;
  surface: boolean;
  flowStats: { lines: number; sinks: number } | null;
  flowHint: string | null;
  onRain: () => void;
  onFlows: () => void;
  onSurface: () => void;
  onFlyTarget: () => void;
  /** home page: start the guided journey */
  onStart?: () => void;
  opening?: boolean;
  ready: boolean;
}

export function EnvToolbar(p: Props) {
  return (
    <div className={`env ${p.visible ? 'is-visible' : ''} ${p.opening ? 'env--opening' : ''}`} inert={!p.visible}>
      {p.opening ? (
        <>
          <div className="glass env__bar env__home" role="toolbar" aria-label="Start">
            <button className="env__btn env__start" onClick={p.onStart} disabled={!p.ready}>
              <span>Explore Basel</span>
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button className="env__btn env__outline" onClick={p.onFlyTarget} disabled={!p.ready}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M21 3 3 10.5l7.5 3 3 7.5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
              <span>Fly to Therwilerstrasse</span>
            </button>
            <button className={`env__btn env__outline ${p.rain ? 'is-on' : ''}`} onClick={p.onRain} aria-pressed={p.rain} disabled={!p.ready}>
              <Icon.drop />
              <span>{p.rain ? 'Stop inflow' : 'Stimulate water'}</span>
            </button>
            <button className={`env__btn env__outline ${p.flows ? 'is-on' : ''}`} onClick={p.onFlows} aria-pressed={p.flows} disabled={!p.ready}>
              <Icon.flow />
              <span>Water Flows</span>
            </button>
          </div>
          {p.rain && <RainIntensity intensity={p.intensity} onIntensity={p.onIntensity} />}
        </>
      ) : p.unlocked ? (
        <>
          <div className="env__caption">
            <span className="pulse-dot" /> Urban Climate Lab · experimental layers
          </div>
          <div className="glass env__bar" role="toolbar" aria-label="Environmental layers">
            <button className={`env__btn ${p.rain ? 'on blue' : ''}`} onClick={p.onRain} aria-pressed={p.rain}>
              <Icon.drop />
              <span>{p.rain ? 'Stop inflow' : 'Stimulate water'}</span>
            </button>
            <button className={`env__btn ${p.flows ? 'on cyan' : ''}`} onClick={p.onFlows} aria-pressed={p.flows}>
              <Icon.flow />
              <span>Reveal Water Flows</span>
            </button>
            <button className={`env__btn ${p.surface ? 'on green' : ''}`} onClick={p.onSurface} aria-pressed={p.surface}>
              <Icon.section />
              <span>Above / Below Surface</span>
            </button>
          </div>
          {p.rain && <RainIntensity intensity={p.intensity} onIntensity={p.onIntensity} />}
          {(p.flows || p.flowHint) && (
            <div className="env__legend glass">
              {p.flowHint ? (
                <>
                  <span>{p.flowHint}</span>
                  <em>Terrain model, ignores sewers</em>
                </>
              ) : (
                <>
                  <span className="grad" />
                  <span>
                    Sealed roofs & streets → tree pits & green areas
                    {p.flowStats ? ` · ${p.flowStats.lines} paths, ${p.flowStats.sinks} infiltration points` : ''}
                  </span>
                  <em>Conceptual, not simulated</em>
                </>
              )}
            </div>
          )}
        </>
      ) : (
        <button className="glass env__locked" onClick={p.onFlyTarget} disabled={!p.ready}>
          <Icon.target /><span>Fly to Therwilerstrasse to explore water flow and surface layers</span>
        </button>
      )}
    </div>
  );
}
