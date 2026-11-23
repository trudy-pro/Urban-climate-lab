import { useEffect, useRef } from 'react';
import { DISCLOSURE, JOURNEY, stageIndex, type JourneyStage } from '../journey';

type MapStage = 'city' | 'neighbourhood' | 'street';

const MAP_STAGES: { key: MapStage; label: string }[] = [
  { key: 'city', label: 'City' },
  { key: 'neighbourhood', label: 'Neighbourhood' },
  { key: 'street', label: 'Therwilerstrasse' },
];

export function MapStages({ stage, ready, onGo }: {
  stage: MapStage; ready: boolean; onGo: (s: MapStage) => void;
}) {
  return (
    <nav className="map-stages glass" aria-label="Map stages">
      {MAP_STAGES.map(({ key, label }, index) => (
        <button key={key} aria-current={key === stage ? 'step' : undefined} disabled={!ready} onClick={() => onGo(key)}>
          <span className="map-stages__number" aria-hidden="true">{index + 1}</span>{label}
        </button>
      ))}
    </nav>
  );
}

/* ------------------------------------------------------------------ step navigator (bottom) */

interface NavProps {
  stage: JourneyStage;
  reached: number;
  flying: boolean;
  onGo: (s: JourneyStage) => void;
  onPause: () => void;
  onBasel: () => void;
  onExplore: () => void;
}

export function JourneyNav(p: NavProps) {
  const idx = stageIndex(p.stage);
  return (
    <nav className="journey" aria-label="Guided journey">
      <div className="glass env__bar journey__bar">
        <button
          className="journey__back"
          onClick={() => p.onGo(JOURNEY[idx - 1].key)}
          disabled={idx === 0}
          aria-label="Previous stage"
          title="Previous stage"
        >
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M14 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <ol className="journey__steps">
          {JOURNEY.slice(3).map((j, offset) => {
            const i = offset + 3;
            const state = i === idx ? 'is-on' : i < idx ? 'is-done' : '';
            return (
              <li key={j.key}>
                <button
                  className={`journey__step ${state}`}
                  onClick={() => p.onGo(j.key)}
                  disabled={i > p.reached}
                  aria-current={i === idx ? 'step' : undefined}
                  title={i > p.reached ? 'Reach the previous stage first' : undefined}
                >
                  <span className="journey__n">{i + 1}</span>
                  <span className="journey__label">{j.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
        {p.flying && (
          <button className="journey__pause" onClick={p.onPause} aria-label="Pause camera movement" title="Pause camera movement">
            <svg viewBox="0 0 24 24" width="14" height="14"><path d="M8 5v14M16 5v14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
          </button>
        )}
      </div>
      <div className="journey__aux">
        {idx > 0 && <button onClick={p.onBasel}>Back to Basel</button>}
        <button onClick={p.onExplore}>Explore freely</button>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ flight caption (centre) */

const CAPTIONS: Record<'city' | 'neighbourhood' | 'street', [string, string]> = {
  city: ['Basel', 'The city on the Rhine'],
  neighbourhood: ['Bachletten', 'Approaching the neighbourhood'],
  street: ['Therwilerstrasse', 'Paulusgasse · Basel-Stadt'],
};

/** Names the scale the camera is passing through while it flies. */
export function FlightCaption({ show, stage }: { show: boolean; stage: MapStage }) {
  const [title, subtitle] = CAPTIONS[stage];
  return (
    <>
      <div className="fcaption" aria-hidden="true">
        {MAP_STAGES.map(({ key }) => (
          <div className={show && stage === key ? 'is-on' : ''} key={key}>
            <b>{CAPTIONS[key][0]}</b>
            <span>{CAPTIONS[key][1]}</span>
          </div>
        ))}
      </div>
      <span className="sr-only" aria-live="polite">{show ? `${title}. ${subtitle}` : ''}</span>
    </>
  );
}

/* ------------------------------------------------------------------ stage card (left) */

interface CardProps {
  stage: JourneyStage;
  flying: boolean;
  offCourse: boolean;
  raining: boolean;
  following: boolean;
  arrived: boolean;
  heroKind: 'tree' | 'green' | null;
  pathsReady: boolean;
  onNext: () => void;
  onRain: () => void;
  onFollow: () => void;
  onBelow: () => void;
  onRecenter: () => void;
}

export function JourneyCard(p: CardProps) {
  if (p.stage === 'city' || p.stage === 'below') return null;
  const idx = stageIndex(p.stage);

  let eyebrow = '';
  let title = '';
  let body = '';
  let action: { label: string; onClick: () => void; disabled?: boolean } | null = null;

  if (p.stage === 'neighbourhood') {
    eyebrow = 'Bachletten · Basel';
    title = 'A Neighborhood Adapting to Rain';
    body = 'In an established urban neighborhood, streets must accommodate buildings, paved surfaces, vegetation and underground infrastructure.';
    action = { label: 'Explore the Street', onClick: p.onNext };
  } else if (p.stage === 'street') {
    eyebrow = 'Study street · Bachletten';
    title = 'Paulusgasse / Therwilerstrasse';
    body = 'What happens to rain when it reaches this street?';
    action = p.raining ? { label: 'Follow the runoff', onClick: p.onNext } : { label: 'Make It Rain', onClick: p.onRain };
  } else if (p.stage === 'water') {
    eyebrow = 'Follow the water';
    title = p.arrived ? 'The water has soaked in' : 'Where does the rain go?';
    const sink = p.heroKind === 'tree' ? 'a street tree from Basel’s tree register' : 'a planted area';
    body = p.arrived
      ? `The highlighted drop has reached ${sink}. Below the surface, soil and roots take over.`
      : `Rain runs off roofs and paving toward planted areas where it can soak in. One path is highlighted. It ends at ${sink}.`;
    action = p.arrived
      ? { label: 'Look Beneath the Street', onClick: p.onBelow }
      : p.following
        ? { label: 'Following the water…', onClick: () => {}, disabled: true }
        : { label: 'Follow the Water', onClick: p.onFollow, disabled: !p.pathsReady };
  }

  return (
    <section className={`jcard glass ${p.flying ? 'is-flying' : ''}`} inert={p.flying} aria-live="polite" key={p.stage}>
      <p className="eyebrow">
        <span className="jcard__step">{idx + 1} / {JOURNEY.length}</span> {eyebrow}
      </p>
      <h2>{title}</h2>
      <p className="jcard__body">{body}</p>
      {action && (
        <div className="jcard__actions">
          <button className="cta cta--sm" onClick={action.onClick} disabled={action.disabled || p.flying}>
            <span>{action.label}</span>
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          {p.offCourse && !p.flying && !p.following && (
            <button className="ghost ghost--sm" onClick={p.onRecenter}>
              Return to view
            </button>
          )}
        </div>
      )}
      {p.stage === 'water' && !p.pathsReady && <p className="jcard__note">Tracing water paths from roofs and streets…</p>}
      {p.stage === 'water' && <p className="jcard__disclosure">{DISCLOSURE}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ map ↔ section connector */

/**
 * A thin line from the highlighted infiltration point on the map down to the planted area in the
 * street section, so the explanation stays tied to the real place.
 */
export function SectionConnector({ active, project }: { active: boolean; project: () => { x: number; y: number } | null }) {
  const pathRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const endRef = useRef<SVGCircleElement>(null);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      const a = project();
      const svg = document.querySelector('.surface.is-open .sx-canvas svg') as SVGSVGElement | null;
      const path = pathRef.current;
      if (a && svg && path) {
        const r = svg.getBoundingClientRect();
        // the section drawing is letterboxed (meet): find where its planted depression sits on screen
        const k = Math.min(r.width / 1000, r.height / 380);
        const bx = r.left + (r.width - 1000 * k) / 2 + 706 * k;
        // end at the panel's top edge, above the planted area of the drawing
        const panel = svg.closest('.surface')?.getBoundingClientRect();
        const by = (panel?.top ?? r.top) + 1;
        const midY = (a.y + by) / 2;
        const visible = a.y < by - 12;
        path.setAttribute('d', visible ? `M${a.x.toFixed(1)} ${a.y.toFixed(1)} C${a.x.toFixed(1)} ${midY.toFixed(1)} ${bx.toFixed(1)} ${midY.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}` : '');
        dotRef.current?.setAttribute('transform', visible ? `translate(${a.x.toFixed(1)} ${a.y.toFixed(1)})` : 'translate(-99 -99)');
        endRef.current?.setAttribute('transform', visible ? `translate(${bx.toFixed(1)} ${by.toFixed(1)})` : 'translate(-99 -99)');
      } else if (path) path.setAttribute('d', '');
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, project]);
  return (
    <svg className={`connector ${active ? 'is-on' : ''}`} aria-hidden="true">
      <path ref={pathRef} d="" />
      <circle ref={dotRef} r="5" className="connector__a" transform="translate(-99 -99)" />
      <circle ref={endRef} r="3" className="connector__b" transform="translate(-99 -99)" />
    </svg>
  );
}
