import { RainIntensity, type RainLevel } from './RainIntensity';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BUILDING,
  DOWNPIPE_X,
  FOUNDATION_BOTTOM,
  HERO_ROOT,
  HERO_SLOT,
  INLET_X,
  JOURNEY_STEPS,
  LAYERS,
  PAVERS,
  PLANTED,
  ROOTS,
  ROOTZONE,
  SECTION_DISCLAIMER,
  SEWER,
  SIDEWALK,
  SLOTS,
  STONES,
  AGGREGATE,
  SEEPAGE,
  STREET,
  SUBSTRATE,
  TREE,
  grains,
  substrateBottom,
  substrateTop,
  surfaceY,
  type LayerId,
} from './section/geometry';
import { WaterSim } from './section/waterSim';

type Mode = 'above' | 'below' | 'both';
type JourneyState = 'idle' | 'playing' | 'paused' | 'done';


const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* polygon helpers for the drawing */
function band(x0: number, x1: number, top: (x: number) => number, bottom: (x: number) => number, step = 6) {
  const xs: number[] = [];
  for (let x = x0; x < x1; x += step) xs.push(x);
  xs.push(x1);
  const up = xs.map((x) => `${x.toFixed(1)} ${top(x).toFixed(1)}`);
  const down = [...xs].reverse().map((x) => `${x.toFixed(1)} ${bottom(x).toFixed(1)}`);
  return `M${up.join(' L')} L${down.join(' L')} Z`;
}
function line(x0: number, x1: number, f: (x: number) => number, step = 6) {
  const pts: string[] = [];
  for (let x = x0; x <= x1; x += step) pts.push(`${x.toFixed(1)} ${f(x).toFixed(1)}`);
  pts.push(`${x1} ${f(x1).toFixed(1)}`);
  return 'M' + pts.join(' L');
}

interface Props {
  open: boolean;
  raining: boolean;
  intensity: RainLevel;
  onIntensity: (i: RainLevel) => void;
  onRain: () => void;
  flows: boolean;
  onFlows: () => void;
  onClose: () => void;
  /** Set when the section is opened from the guided journey, after following a drop on the map. */
  fromStreet?: { kind: 'tree' | 'green' | null } | null;
}

/**
 * Explanatory street section (stylised, not to scale, not an engineering model): how rain moves over
 * and into a sponge-city street. Particles show the behaviour; arrows are secondary cues.
 */
export function SurfaceSection({ open, raining, intensity, onIntensity, onRain, flows, onFlows, onClose, fromStreet = null }: Props) {
  const [mode, setMode] = useState<Mode>('above');
  const [layersOpen, setLayersOpen] = useState(false);
  const [focus, setFocus] = useState<LayerId | null>(null);
  const [journey, setJourney] = useState<JourneyState>('idle');
  const [step, setStep] = useState(0);
  const reduced = useMemo(reducedMotion, []);

  const particlesRef = useRef<SVGGElement>(null);
  const slotsRef = useRef<SVGGElement>(null);
  const moistureRef = useRef<SVGEllipseElement>(null);
  const topsoilWetRef = useRef<SVGPathElement>(null);
  const heroRef = useRef<SVGGElement>(null);
  const trailRef = useRef<SVGPathElement>(null);
  const rootsRef = useRef<SVGGElement>(null);
  const simRef = useRef<WaterSim | null>(null);

  /* ---------------------------------------------------------------- simulation lifecycle */
  useEffect(() => {
    if (!particlesRef.current || !slotsRef.current || !heroRef.current || !trailRef.current) return;
    const sim = new WaterSim(
      {
        particles: particlesRef.current,
        slots: Array.from(slotsRef.current.querySelectorAll('circle')),
        moisture: moistureRef.current,
        topsoilWet: topsoilWetRef.current,
        hero: heroRef.current,
        heroTrail: trailRef.current,
        roots: rootsRef.current ? Array.from(rootsRef.current.querySelectorAll('path')) : [],
      },
      {
        onStep: (i) => setStep(i),
        onEnd: () => setJourney('done'),
      },
      reduced,
    );
    sim.rain = raining;
    sim.intensity = intensity;
    simRef.current = sim;
    return () => {
      sim.destroy();
      simRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    if (open) sim.start();
    else sim.stop();
  }, [open]);

  useEffect(() => {
    if (simRef.current) simRef.current.rain = raining;
  }, [raining]);
  useEffect(() => {
    if (simRef.current) simRef.current.intensity = intensity;
  }, [intensity]);

  /* ---------------------------------------------------------------- journey controls */
  const startJourney = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    setMode('both');
    setFocus(null);
    setLayersOpen(false);
    setStep(0);
    setJourney('playing');
    sim.playJourney();
  }, []);
  const togglePause = () => {
    const sim = simRef.current;
    if (!sim) return;
    sim.paused = !sim.paused;
    setJourney(sim.paused ? 'paused' : 'playing');
  };
  const skip = () => simRef.current?.skip();
  const endJourney = useCallback(() => {
    simRef.current?.stopJourney();
    if (simRef.current) simRef.current.paused = false;
    setJourney('idle');
  }, []);

  // reveal: open on the surface, then peel down into the ground; from the map journey, start the drop
  useEffect(() => {
    if (!open) {
      endJourney();
      setFocus(null);
      setLayersOpen(false);
      return;
    }
    setMode('above');
    const t = setTimeout(() => setMode('both'), 900);
    const t2 = fromStreet ? setTimeout(startJourney, 2300) : 0;
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const exploreLayers = () => {
    endJourney();
    setMode('both');
    setLayersOpen(true);
    setFocus('surface');
  };

  const showAbove = mode !== 'below';
  const showBelow = mode !== 'above';
  const journeyOn = journey === 'playing' || journey === 'paused';
  const activeLayer: LayerId | null = journeyOn ? JOURNEY_STEPS[step].layer : focus;
  const layerInfo = LAYERS.find((l) => l.id === focus);

  /* static drawing data */
  const topsoilGrains = useMemo(() => grains(5, PLANTED.x0, PLANTED.x1, (x) => surfaceY(x) + 2, (x) => surfaceY(x) + 20, 7), []);
  const deepTop = (x: number) => (x < SUBSTRATE.x0 ? FOUNDATION_BOTTOM : x > SUBSTRATE.x1 ? 196 : substrateBottom(x));
  const substrateGrains = useMemo(() => grains(13, SUBSTRATE.x0, SUBSTRATE.x1, (x) => substrateTop(x) + 1, (x) => substrateBottom(x) - 1, 5), []);
  const deepGrains = useMemo(() => grains(9, 0, 1000, (x) => deepTop(x) + 4, () => 380, 14), []);

  return (
    <section className={`surface ${open ? 'is-open' : ''}`} aria-hidden={!open} aria-label="Above and below the surface">
      <header className="surface__head">
        <div>
          {fromStreet ? (
            <>
              <p className="eyebrow">
                <span className="jcard__step">5 / 5</span> Beneath the street · Therwilerstrasse
              </p>
              <h2>Under the {fromStreet.kind === 'green' ? 'planted area' : 'tree pit'} your drop reached</h2>
            </>
          ) : (
            <>
              <p className="eyebrow">Above / Below Surface · Therwilerstrasse</p>
              <h2>Where rain goes on a sponge-city street</h2>
            </>
          )}
        </div>
        <div className="surface__actions">
          <div className="segmented" role="tablist" aria-label="Section view">
            {(['above', 'both', 'below'] as Mode[]).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                {m === 'above' ? 'Above' : m === 'below' ? 'Below' : 'Both'}
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close section">
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </div>
      </header>

      {/* controls: primary (left) and compact secondary (right) */}
      {(
        <div className="sx-controls">
          <div className="sx-primary">
            {journeyOn ? (
              <>
                {!reduced && (
                  <button className="sx-btn" onClick={togglePause}>
                    {journey === 'paused' ? <Play /> : <Pause />}
                    {journey === 'paused' ? 'Resume' : 'Pause'}
                  </button>
                )}
                <button className="sx-btn" onClick={skip}>
                  {reduced ? 'Next step' : 'Skip'} <Chevron />
                </button>
                <button className="sx-btn" onClick={startJourney}>
                  <Replay /> Replay
                </button>
                <button className="sx-btn sx-btn--quiet" onClick={endJourney}>End</button>
              </>
            ) : (
              <button className="cta cta--xs" onClick={startJourney}>
                <Drop /> {journey === 'done' ? 'Replay Journey' : 'Follow One Raindrop'}
              </button>
            )}
            <button className={`sx-btn ${raining ? 'is-on' : ''}`} aria-pressed={raining} onClick={onRain}>
              <RainIcon /> {raining ? 'Raining' : 'Make It Rain'}
            </button>
          </div>
          <div className="sx-secondary">
            <RainIntensity intensity={intensity} onIntensity={onIntensity} />
            <button className={`sx-chip ${flows ? 'is-on' : ''}`} aria-pressed={flows} onClick={onFlows}>Water flows on map</button>
            <button
              className={`sx-chip ${layersOpen ? 'is-on' : ''}`}
              aria-pressed={layersOpen}
              onClick={() => {
                if (layersOpen) {
                  setLayersOpen(false);
                  setFocus(null);
                } else exploreLayers();
              }}
            >
              Underground layers
            </button>
            <button className="sx-chip" onClick={onClose}>Return to map</button>
          </div>
        </div>
      )}
      {layersOpen && !journeyOn && (
        <div className="sx-layers" role="radiogroup" aria-label="Underground layers">
          {LAYERS.map((l) => (
            <button key={l.id} role="radio" aria-checked={focus === l.id} className={`sx-layer ${focus === l.id ? 'is-on' : ''}`} onClick={() => setFocus(focus === l.id ? null : l.id)}>
              <i className={`sx-swatch sx-swatch--${l.id}`} />
              {l.label}
            </button>
          ))}
        </div>
      )}

      <div className="surface__canvas sx-canvas">
        {/* one short explanation at a time: journey step, or the selected layer */}
        {journeyOn && (
          <div className="sx-caption" aria-live="polite">
            <div className="sx-steps" aria-label={`Step ${step + 1} of ${JOURNEY_STEPS.length}`}>
              {JOURNEY_STEPS.map((_, i) => (
                <span key={i} className={i < step ? 'done' : i === step ? 'on' : ''} />
              ))}
            </div>
            <p key={step}>
              <b>{step + 1}</b> {JOURNEY_STEPS[step].text}
            </p>
          </div>
        )}
        {journey === 'done' && (
          <div className="sx-caption sx-caption--end" aria-live="polite">
            <p>You followed one raindrop from the street into the soil. Rain also takes other paths: some runs to the sewer, some is held for a while, some seeps deeper.</p>
            <div className="sx-end">
              <button className="sx-btn" onClick={startJourney}><Replay /> Replay Journey</button>
              <button className="sx-btn" onClick={exploreLayers}>Explore Layers</button>
              <button className="sx-btn" onClick={onClose}>Return to Street</button>
            </div>
          </div>
        )}
        {!journeyOn && journey !== 'done' && layerInfo && (
          <div className="sx-caption" aria-live="polite">
            <p key={layerInfo.id}>
              <i className={`sx-swatch sx-swatch--${layerInfo.id}`} /> <strong>{layerInfo.label}.</strong> {layerInfo.text}
            </p>
          </div>
        )}

        <svg
          viewBox="0 0 1000 380"
          preserveAspectRatio="xMidYMid meet"
          className={`xsec mode-${mode} ${raining ? 'raining' : ''} ${activeLayer ? `has-focus focus-${activeLayer}` : ''} ${journeyOn ? `journey-on step-${step}` : ''}`}
          role="img"
          aria-label="Stylised street section: building, sealed street, planted infiltration depression with a tree, permeable parking paving, and the ground beneath"
        >
          <defs>
            <linearGradient id="sx-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#0b1424" />
              <stop offset="1" stopColor="#13213a" />
            </linearGradient>
            <linearGradient id="sx-deep" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#15110e" />
              <stop offset="1" stopColor="#090706" />
            </linearGradient>
            <linearGradient id="sx-substrate" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3a2e23" />
              <stop offset="1" stopColor="#2e251c" />
            </linearGradient>
            <linearGradient id="sx-topsoil" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3b2d20" />
              <stop offset="1" stopColor="#2f2419" />
            </linearGradient>
            <linearGradient id="sx-foundation" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#34322e" />
              <stop offset="1" stopColor="#2a2724" />
            </linearGradient>
            <radialGradient id="sx-moist">
              <stop offset="0" stopColor="#4fb6ff" stopOpacity="0.5" />
              <stop offset="0.6" stopColor="#4fb6ff" stopOpacity="0.18" />
              <stop offset="1" stopColor="#4fb6ff" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="sx-entry">
              <stop offset="0" stopColor="#7fe9ff" stopOpacity="0.75" />
              <stop offset="1" stopColor="#7fe9ff" stopOpacity="0" />
            </radialGradient>
            <pattern id="sx-asphalt" width="6" height="6" patternUnits="userSpaceOnUse">
              <rect width="6" height="6" fill="#3a404b" />
              <circle cx="1.5" cy="2" r="0.6" fill="#4a515e" />
              <circle cx="4.5" cy="4.5" r="0.5" fill="#2f343d" />
            </pattern>
            <pattern id="sx-slabs" width="24" height="6" patternUnits="userSpaceOnUse">
              <rect width="24" height="6" fill="#262b33" />
              <rect x="0.8" y="0" width="22.4" height="6" fill="#4a5466" />
            </pattern>
            <pattern id="sx-pavers" width="18" height="7" patternUnits="userSpaceOnUse">
              <rect width="18" height="7" fill="#2a4a39" />
              <rect x="1.2" y="0.5" width="15.6" height="6" fill="#4d5a70" />
            </pattern>
            <marker id="sx-arr" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="#8fb8e6" />
            </marker>
          </defs>

          {/* ---------- deeper ground: darker, distinct, below the root zone ---------- */}
          <g data-layer="deep">
            <path d={band(0, 1000, deepTop, () => 440)} fill="url(#sx-deep)" />
            {deepGrains.map((g, i) => (
              <circle key={i} cx={g.x} cy={g.y} r={0.5 + g.s * 0.8} fill={g.s > 0.55 ? '#241d17' : '#0f0c0a'} />
            ))}
            {/* soft boundary to the layers above (not a water table) */}
            <path d={line(0, 1000, deepTop, 8)} fill="none" stroke="#5a4a3a" strokeOpacity="0.45" strokeWidth="1" strokeDasharray="1 4" />
            {/* schematic, uncertain seepage */}
            <g className="seepage">
              {SEEPAGE.map(([x, y], i) => (
                <g key={i} transform={`translate(${x} ${y})`}>
                  <path d="M0 0 V22" />
                  <text x="5" y="20">?</text>
                </g>
              ))}
            </g>
            <path className="edge" d={band(0, 1000, deepTop, () => 439)} />
          </g>

          {/* ---------- road foundation: compacted gravel aggregate ---------- */}
          <g data-layer="foundation">
            <path d={band(SIDEWALK.x0, SUBSTRATE.x0, (x) => surfaceY(x) + 6, () => FOUNDATION_BOTTOM)} fill="url(#sx-foundation)" />
            {AGGREGATE.map((s, i) => (
              <ellipse
                key={i}
                cx={s.x}
                cy={s.y}
                rx={s.rx}
                ry={s.ry}
                transform={`rotate(${s.rot.toFixed(0)} ${s.x.toFixed(1)} ${s.y.toFixed(1)})`}
                fill={s.shade > 0.7 ? '#5a554d' : s.shade > 0.4 ? '#48443e' : '#3c3833'}
              />
            ))}
            <rect x={BUILDING.x0} y="176" width={BUILDING.x1 - BUILDING.x0} height="58" fill="#161c27" />
            <path className="edge" d={band(SIDEWALK.x0, SUBSTRATE.x0, (x) => surfaceY(x) + 6, () => FOUNDATION_BOTTOM)} />
          </g>

          {/* ---------- existing drainage: inlet and sewer ---------- */}
          <g className="infra">
            <rect x={INLET_X - 4} y="180" width="8" height="56" fill="#10151d" stroke="#46505f" strokeWidth="1" />
            <path d={`M${INLET_X} 236 Q${INLET_X - 40} 250 ${SEWER.x + SEWER.r} ${SEWER.y - 4}`} fill="none" stroke="#3a4352" strokeWidth="7" strokeLinecap="round" />
            <circle cx={SEWER.x} cy={SEWER.y} r={SEWER.r} fill="#121720" stroke="#46505f" strokeWidth="3" />
          </g>

          {/* ---------- tree substrate: stones, soil particles and open pores ---------- */}
          <g data-layer="substrate">
            <path d={band(SUBSTRATE.x0, SUBSTRATE.x1, substrateTop, substrateBottom)} fill="url(#sx-substrate)" />
            {substrateGrains.map((g, i) => (
              <circle key={`g${i}`} cx={g.x} cy={g.y} r={0.4 + g.s * 0.6} fill={g.s > 0.5 ? '#54453a' : '#241c15'} />
            ))}
            {STONES.map((s, i) => (
              <ellipse
                key={i}
                cx={s.x}
                cy={s.y}
                rx={s.rx}
                ry={s.ry}
                transform={`rotate(${s.rot.toFixed(0)} ${s.x.toFixed(1)} ${s.y.toFixed(1)})`}
                fill={s.shade > 0.75 ? '#6c5a47' : s.shade > 0.5 ? '#5b4b3b' : s.shade > 0.25 ? '#4c3f32' : '#41362b'}
              />
            ))}
            {/* pore spaces between the stones */}
            {SLOTS.map((s, i) => (
              <ellipse key={`p${i}`} cx={s.x} cy={s.y} rx="3" ry="2.4" fill="#171009" />
            ))}
            <path className="edge" d={band(SUBSTRATE.x0, SUBSTRATE.x1, substrateTop, substrateBottom)} />
          </g>

          {/* ---------- root zone: moisture + branching roots ---------- */}
          <g data-layer="rootzone">
            <ellipse ref={moistureRef} cx={ROOTZONE.cx} cy={ROOTZONE.cy} rx={ROOTZONE.rx} ry={ROOTZONE.ry} fill="url(#sx-moist)" opacity="0" />
            <g ref={rootsRef} className="roots" fill="none" strokeLinecap="round">
              {ROOTS.map((r, i) => (
                <path key={i} d={r.d} strokeWidth={r.w} className={`root-l${r.level}`} />
              ))}
            </g>
            <ellipse className="edge" cx={ROOTZONE.cx} cy={ROOTZONE.cy} rx={ROOTZONE.rx} ry={ROOTZONE.ry} />
          </g>

          {/* pores: water held for a while (driven by the simulation) */}
          <g ref={slotsRef} className="slots">
            {SLOTS.map((s, i) => (
              <circle key={i} cx={s.x} cy={s.y} r="1.2" opacity="0.12" />
            ))}
          </g>

          {/* ---------- planted infiltration depression ---------- */}
          <g data-layer="planted">
            <path d={band(PLANTED.x0, PLANTED.x1, (x) => surfaceY(x), (x) => surfaceY(x) + 22, 4)} fill="url(#sx-topsoil)" />
            {topsoilGrains.map((g, i) => (
              <circle key={i} cx={g.x} cy={g.y} r={0.5 + g.s * 0.8} fill={g.s > 0.6 ? '#5a4634' : '#271d14'} />
            ))}
            <path ref={topsoilWetRef} d={band(PLANTED.x0, PLANTED.x1, (x) => surfaceY(x), (x) => surfaceY(x) + 22, 4)} fill="#2f6aa8" opacity="0" />
            {/* mulch / top of the planted soil */}
            <path d={line(PLANTED.x0 + 2, PLANTED.x1 - 2, (x) => surfaceY(x) + 1, 4)} fill="none" stroke="#5b4630" strokeWidth="2.4" />
            <path d={line(PLANTED.x0 + 4, PLANTED.x1 - 4, (x) => surfaceY(x) - 0.5)} fill="none" stroke="#2f6d4e" strokeWidth="1.6" />
            {/* low planting: grasses and a few perennial clumps */}
            {Array.from({ length: 16 }).map((_, i) => {
              const x = PLANTED.x0 + 12 + i * 11.2;
              if (Math.abs(x - TREE.x) < 12) return null;
              const y = surfaceY(x);
              return <path key={i} d={`M${x} ${y} q-3 -5 -4 -9 M${x} ${y} q0 -6 1 -11 M${x} ${y} q3 -4 5 -8`} stroke="#4c9b70" strokeWidth="1.1" fill="none" />;
            })}
            {[650, 768].map((x) => (
              <g key={x}>
                <ellipse cx={x} cy={surfaceY(x) - 6} rx="10" ry="7" fill="#2a6b4b" />
                <ellipse cx={x + 6} cy={surfaceY(x) - 9} rx="6" ry="5" fill="#33805a" />
              </g>
            ))}
            <path className="edge" d={band(PLANTED.x0, PLANTED.x1, (x) => surfaceY(x), (x) => surfaceY(x) + 22, 4)} />
          </g>

          {/* ---------- street surface: sealed, distinct from what lies beneath ---------- */}
          <g data-layer="surface">
            {/* sidewalk slabs */}
            <rect x={SIDEWALK.x0} y="170" width={SIDEWALK.x1 - SIDEWALK.x0} height="6" fill="url(#sx-slabs)" />
            <rect x={SIDEWALK.x0} y="176" width={SIDEWALK.x1 - SIDEWALK.x0} height="3" fill="#2a2e35" />
            {/* curb between sidewalk and street */}
            <rect x={SIDEWALK.x1 - 3} y="167" width="7" height="16" rx="1" fill="#6b7489" />
            {/* asphalt, falling gently toward the planted strip, with a thin binder course below */}
            <path d={band(STREET.x0, STREET.x1, (x) => surfaceY(x), (x) => surfaceY(x) + 7)} fill="url(#sx-asphalt)" />
            <path d={line(STREET.x0, STREET.x1, (x) => surfaceY(x) + 0.4)} fill="none" stroke="#7d889c" strokeWidth="0.9" strokeOpacity="0.8" />
            <path d={band(STREET.x0, STREET.x1, (x) => surfaceY(x) + 7, (x) => surfaceY(x) + 9)} fill="#22252b" />
            {/* street inlet grate */}
            <rect x={INLET_X - 7} y={surfaceY(INLET_X) - 0.5} width="14" height="3" fill="#8794ab" />
            {/* low curb with an opening: runoff enters the planted area here */}
            <rect x={STREET.x1 - 6} y={surfaceY(STREET.x1 - 6) + 3} width="8" height="12" rx="1" fill="#6b7489" />
            <circle className="entry-glow" cx={STREET.x1 + 2} cy={surfaceY(STREET.x1) + 1} r="11" fill="url(#sx-entry)" />
            <path className="entry-mark" d={`M${STREET.x1 - 10} ${surfaceY(STREET.x1) - 7} q8 -1 12 6`} />
            {/* permeable parking paving (open joints) + bedding */}
            <rect x={PAVERS.x0} y="176" width={PAVERS.x1 - PAVERS.x0} height="7" fill="url(#sx-pavers)" />
            <rect x={PAVERS.x0} y="183" width={PAVERS.x1 - PAVERS.x0} height="11" fill="#3a332b" />
            <rect x={PAVERS.x0 - 3} y="172" width="6" height="12" rx="1" fill="#6b7489" />
            <path className="edge" d={`${band(SIDEWALK.x0, STREET.x1, (x) => surfaceY(x), (x) => surfaceY(x) + 7)} M${PAVERS.x0} 176 H${PAVERS.x1} V194 H${PAVERS.x0} Z`} />
          </g>

          {/* ---------- above ground ---------- */}
          <g className={`layer-above ${showAbove ? '' : 'dim'}`}>
            <rect x="0" y="0" width="1000" height="168" fill="url(#sx-sky)" />
            <path d={`M0 168 H${SIDEWALK.x0} V176 H0 Z`} fill="url(#sx-sky)" />
            <rect x={BUILDING.x0} y={BUILDING.roof} width={BUILDING.x1 - BUILDING.x0} height={176 - BUILDING.roof} fill="#1a2538" />
            <rect x={BUILDING.x0 - 6} y={BUILDING.roof - 6} width={BUILDING.x1 - BUILDING.x0 + 12} height="7" fill="#253552" />
            {Array.from({ length: 4 }).map((_, r) =>
              Array.from({ length: 3 }).map((__, c) => <rect key={`${r}-${c}`} x={38 + c * 44} y={54 + r * 28} width="22" height="15" fill="#22324d" />),
            )}
            <path d={`M${BUILDING.x1 + 2} ${BUILDING.roof + 2} H${DOWNPIPE_X} V168`} fill="none" stroke="#4a5a76" strokeWidth="4" />
            <rect x={TREE.x - 4} y="86" width="9" height={TREE.base - 86} fill="#3c2c22" />
            <g className="canopy">
              <circle cx={TREE.x + 4} cy="74" r="44" fill="#1d5a40" />
              <circle cx={TREE.x - 30} cy="92" r="28" fill="#21664a" />
              <circle cx={TREE.x + 38} cy="90" r="30" fill="#1b5139" />
              <circle cx={TREE.x + 6} cy="52" r="26" fill="#247353" />
            </g>
          </g>

          {/* secondary cues (arrows): the particles carry the story */}
          <g className="cues" fill="none" strokeWidth="1.3" strokeDasharray="3 5" markerEnd="url(#sx-arr)">
            <path d={`M360 ${surfaceY(360) - 8} H${INLET_X - 30}`} />
            <path d={`M${PLANTED.x0 + 30} ${surfaceY(PLANTED.x0 + 30) + 4} L${PLANTED.x0 + 34} ${substrateTop(PLANTED.x0 + 34) + 16}`} />
            <path d={`M${INLET_X + 9} 200 V226`} className="cue-grey" />
          </g>

          {/* water particles (simulation) */}
          <g ref={particlesRef} className="particles" />

          {/* the followed raindrop */}
          <path ref={trailRef} className="hero-trail" d="" />
          <circle className="hero-slot" cx={HERO_SLOT.x} cy={HERO_SLOT.y} r="16" />
          <circle className="hero-root" cx={HERO_ROOT[0]} cy={HERO_ROOT[1]} r="7" />
          <g ref={heroRef} className="hero" opacity="0">
            <circle r="11" className="hero-glow" />
            <circle r="4.2" className="hero-dot" />
          </g>

          {/* covers the ground in "Above" mode */}
          <rect className={`below-cover ${showBelow ? 'revealed' : ''}`} x="0" y="177" width="1000" height="270" />
          <line x1="0" y1="176.5" x2="1000" y2="176.5" stroke="#8fa3c4" strokeOpacity="0.25" strokeDasharray="2 4" />

          {/* the map connection: the drop followed on Therwilerstrasse arrives in this planted area */}
          {fromStreet && (
            <g className="from-street" aria-hidden="true">
              <ellipse cx={PLANTED.low} cy={surfaceY(PLANTED.low) - 2} rx="92" ry="12" />
            </g>
          )}

          {/* a few quiet labels; the selected layer's label is emphasised */}
          <g className="labels">
            <text className="lbl key" data-for="surface" x="330" y="160">Sealed street</text>
            <text className="lbl key" data-for="planted" x={PLANTED.x0 - 70} y="150">Planted depression</text>
            <text className="lbl" data-for="foundation" x="200" y="216">Road foundation</text>
            <text className="lbl key" data-for="substrate" x={SUBSTRATE.x1 - 6} y="236" textAnchor="end">Tree substrate</text>
            <text className="lbl" data-for="rootzone" x={ROOTZONE.cx + ROOTZONE.rx - 4} y={ROOTZONE.cy + ROOTZONE.ry + 16} textAnchor="end">Root zone</text>
            <text className="lbl" data-for="deep" x="24" y="366">Deeper ground</text>
            <text className="lbl lbl--uncertain" x={SEEPAGE[SEEPAGE.length - 1][0] + 14} y={SEEPAGE[SEEPAGE.length - 1][1] + 30} textAnchor="end">Deeper seepage: uncertain</text>
            <text className="lbl key" data-for="surface" x={PAVERS.x1 - 6} y="160" textAnchor="end">Permeable paving</text>
            <text className="lbl lbl--grey" x={SEWER.x - 40} y={SEWER.y + 38}>Existing sewer</text>
          </g>
        </svg>
      </div>

      <footer className="surface__foot">
        {(
          <>
            <span className="legend-dot rain" /> Rain
            <span className="legend-dot cyan" /> Surface runoff
            <span className="legend-dot blue" /> Water in the soil
            <span className="legend-dot green" /> Root uptake
            <span className="legend-dot grey" /> To the sewer
            <span className="badge-illustrative">Illustrative</span>
            <span className="disclaimer">
              {SECTION_DISCLAIMER}
              {intensity === 2 && ' Heavy rain changes the animation only; it is not a flood or overflow prediction.'}
            </span>
          </>
        )}
      </footer>
    </section>
  );
}

/* small inline icons */
const icon = (d: string) =>
  function SxIcon() {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  };
const Pause = icon('M9 6v12M15 6v12');
const Play = icon('M8 5l11 7-11 7z');
const Chevron = icon('M10 6l6 6-6 6');
const Replay = icon('M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4');
const Drop = icon('M12 3.5c3.6 4.4 6 7.6 6 10.6a6 6 0 0 1-12 0c0-3 2.4-6.2 6-10.6Z');
const RainIcon = icon('M7 15a4 4 0 1 1 1-7.9A5 5 0 0 1 17.6 9 3.5 3.5 0 0 1 17 16H7M9 19l-1 2M13 19l-1 2M17 19l-1 2');
