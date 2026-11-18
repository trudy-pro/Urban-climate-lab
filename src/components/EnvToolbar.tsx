import { Icon } from './Icons';

interface Props {
  visible: boolean;
  unlocked: boolean;
  rain: boolean;
  flows: boolean;
  surface: boolean;
  flowStats: { lines: number; sinks: number } | null;
  flowHint: string | null;
  onRain: () => void;
  onFlows: () => void;
  onSurface: () => void;
  onFlyTarget: () => void;
}

export function EnvToolbar(p: Props) {
  return (
    <div className={`env ${p.visible ? 'is-visible' : ''}`}>
      {p.unlocked ? (
        <>
          <div className="env__caption">
            <span className="pulse-dot" /> Urban Climate Lab · experimental layers
          </div>
          <div className="glass env__bar" role="toolbar" aria-label="Environmental layers">
            <button className={`env__btn ${p.rain ? 'on blue' : ''}`} onClick={p.onRain} aria-pressed={p.rain}>
              <Icon.rain />
              <span>Make it Rain</span>
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
          {(p.flows || p.flowHint) && (
            <div className="env__legend glass">
              {p.flowHint ? (
                <span>{p.flowHint}</span>
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
        <button className="glass env__locked" onClick={p.onFlyTarget}>
          <Icon.target />
          <span>Fly to Therwilerstrasse to unlock rain, water-flow & surface layers</span>
        </button>
      )}
    </div>
  );
}
