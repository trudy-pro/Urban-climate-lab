import { ThemeToggle } from './ThemeToggle';
import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode, type SVGProps } from 'react';
import { LAYERS, SLABS, type LayerKey } from './beneath/data';
import type { CameraCommand } from './beneath/StreetScene';

const StreetScene = lazy(() => import('./beneath/StreetScene'));

type IconName = 'layers' | 'reset' | 'tag' | 'close' | 'back' | 'pin' | 'orbit' | 'section' | 'drop';

const ICONS: Record<IconName, ReactNode> = {
  layers: <><path d="m3 9 9-5 9 5-9 5z" /><path d="m3 13 9 5 9-5M3 17l9 5 9-5" /></>,
  reset: <><path d="M3.5 11a8.5 8.5 0 1 1 2.2 6.8M3.5 5v6h6" /></>,
  tag: <><path d="M3.5 5.5v6.2l8.4 8.4a1.4 1.4 0 0 0 2 0l6.2-6.2a1.4 1.4 0 0 0 0-2l-8.4-8.4H5.5a2 2 0 0 0-2 2Z" /><circle cx="8" cy="8" r="1" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  back: <path d="M20 12H4m6-6-6 6 6 6" />,
  pin: <><path d="M18.5 10c0 4.3-6.5 9-6.5 9s-6.5-4.7-6.5-9a6.5 6.5 0 0 1 13 0Z" /><circle cx="12" cy="10" r="2" /></>,
  orbit: <><ellipse cx="12" cy="14" rx="8.5" ry="3.6" /><path d="M8 9.4C8.8 5.5 10.3 3 12 3c2.4 0 4.4 4.6 4.4 10.2S14.4 22 12 22c-1.1 0-2.2-1.1-3-3" /></>,
  section: <><path d="M3.5 5.5h17v13h-17zM3.5 10h17M3.5 14h17M8 5.5V10m8-4.5V10" /></>,
  drop: <path d="M12 3.5c3.6 4.4 6 7.6 6 10.6a6 6 0 0 1-12 0c0-3 2.4-6.2 6-10.6Z" />,
};

function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {ICONS[name]}
    </svg>
  );
}

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean; message?: string }> {
  state = { failed: false, message: undefined as string | undefined };
  static getDerivedStateFromError(error: Error) {
    return { failed: true, message: error.stack };
  }
  render() {
    return this.state.failed
      ? <p className="beneath__unavailable">This browser could not open the 3D view. Select a layer to read about it. <span>{this.state.message}</span></p>
      : this.props.children;
  }
}

function LayerInspector({ selected, hovered, onSelect, onHover }: {
  selected: LayerKey | null; hovered: LayerKey | null;
  onSelect: (layer: LayerKey | null) => void;
  onHover: (layer: LayerKey | null) => void;
}) {
  const info = LAYERS.find(({ key }) => key === selected);
  return (
    <aside className="beneath__inspector" aria-label="Explore layers">
      <div className="beneath__legend">
        <h2>Ground layers</h2>
        <ul>
          {LAYERS.map(({ key, name, swatch }) => (
            <li key={key}>
              <button type="button" className={hovered === key ? 'is-hovered' : ''} aria-pressed={selected === key}
                onPointerEnter={(event) => { if (event.pointerType !== 'touch') onHover(key); }}
                onPointerLeave={() => onHover(null)}
                onClick={() => onSelect(selected === key ? null : key)}>
                <span className="beneath__swatch" style={{ backgroundColor: swatch }} aria-hidden="true" />
                {name}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="beneath__selection" aria-live="polite">
        {info && (
          <section key={info.key} className="beneath__detail" aria-label={info.name}>
            <button className="beneath__close" type="button" aria-label="Close layer details" onClick={() => onSelect(null)}><Icon name="close" /></button>
            <h2>{info.name}</h2>
            <p className="beneath__material">{info.material}</p>
            <p>{info.text}</p>
          </section>
        )}
      </div>
    </aside>
  );
}

const VERSES = [
  'The street you know. Paving, rooftops and a strip of green.',
  'Just below, pipes and footings carry the hidden workings of the city.',
  'Then stone and soil, full of small spaces that can hold rain.',
  'Deeper down, roots thread through the soil in search of water.',
  'Far below lies the old ground, gravel and loam laid down long before the street.',
  'Water crosses the road, finds the drains, and seeps into the soil.',
];
const STEP_MS = 2300;
const WATER_STEP = SLABS.length;
const INTRO_DONE = WATER_STEP + 1;

interface Props {
  onSection: () => void;
  onClose: () => void;
  /** true while the view sinks back into the street before returning to the map */
  leaving?: boolean;
}

const CAMERA_KEYS: Record<string, CameraCommand> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', '+': 'near', '=': 'near', '-': 'far',
};

export function UndergroundView({ onSection, onClose, leaving = false }: Props) {
  const [apart, setApart] = useState(false);
  const [flowing, setFlowing] = useState(false);
  const [labels, setLabels] = useState(true);
  const [selected, setSelected] = useState<LayerKey | null>(null);
  const [hovered, setHovered] = useState<LayerKey | null>(null);
  const [reset, setReset] = useState(0);
  const [step, setStep] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches ? INTRO_DONE : 0);
  const [sceneReady, setSceneReady] = useState(false);
  const revealing = step < INTRO_DONE;
  const revealed = Math.min(step + 1, SLABS.length);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const cameraCommand = useRef<((command: CameraCommand) => void) | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    preference.addEventListener('change', handleChange);
    const initialFocus = document.activeElement;
    heading.current?.focus({ preventScroll: true });
    return () => {
      preference.removeEventListener('change', handleChange);
      if (initialFocus instanceof HTMLElement && initialFocus !== document.body) {
        requestAnimationFrame(() => initialFocus.focus({ preventScroll: true }));
      }
    };
  }, []);

  useEffect(() => {
    if (!revealing || !sceneReady || leaving) return;
    if (step === WATER_STEP) setFlowing(true);
    const t = setTimeout(() => {
      setStep((n) => n + 1);
      if (step === WATER_STEP) setFlowing(false);
    }, step === WATER_STEP ? STEP_MS * 2 : STEP_MS);
    return () => clearTimeout(t);
  }, [leaving, revealing, sceneReady, step]);

  const skipReveal = () => {
    setStep(INTRO_DONE);
    setFlowing(false);
  };

  return (
    <main className={`beneath ${revealing ? 'is-revealing' : ''} ${leaving ? 'is-leaving' : ''}`} aria-labelledby="beneath-title" onKeyDown={(event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (revealing) skipReveal();
      else if (selected) setSelected(null);
      else onClose();
    }}>
      <div className="beneath__top">
        <div className="beneath__brand">
          <span><Icon name="drop" /></span>
          <span className="beneath__brand-t"><b>Urban Climate Lab</b><span>Basel · Beneath the Surface</span></span>
        </div>
        <div className="dark-cutaway-actions">
          <nav aria-label="Street exploration">
            <button type="button" aria-label="Street Section" onClick={onSection}><Icon name="section" /> <span>Street Section</span></button>
            <button type="button" onClick={onClose}><Icon name="back" /> <span>Back to Map</span></button>
          </nav>
          <ThemeToggle />
        </div>
      </div>

      <header className="beneath__head">
        <p className="beneath__place"><Icon name="pin" /> Basel, Switzerland</p>
        <h1 id="beneath-title" ref={heading} tabIndex={-1}>Beneath the Street</h1>
        <p>Explore the hidden layers of Therwilerstrasse.</p>
      </header>

      <div className="beneath__stage" ref={stage} tabIndex={0} role="region" aria-label="Interactive 3D street cutaway"
        aria-describedby="beneath-gestures" onKeyDown={(event) => {
          const command = CAMERA_KEYS[event.key];
          if (!command || event.target !== event.currentTarget) return;
          event.preventDefault();
          cameraCommand.current?.(command);
        }} onPointerLeave={() => setHovered(null)}>
        <SceneBoundary>
          <Suspense fallback={<p className="beneath__unavailable" role="status">Loading the 3D cutaway…</p>}>
            <StreetScene labelHost={stage} onReady={() => setSceneReady(true)} revealed={revealed} apart={apart} flowing={flowing} labels={labels && !revealing} reduced={reduced} selected={selected} hovered={hovered}
              reset={reset} cameraCommand={cameraCommand} onSelect={setSelected} onHover={setHovered} />
          </Suspense>
        </SceneBoundary>
      </div>

      <div inert={revealing}>
        <LayerInspector selected={selected} hovered={hovered} onSelect={setSelected} onHover={setHovered} />
      </div>

      {revealing && (
        <div className="beneath__verse" aria-live="polite">
          {sceneReady && <p key={step}>{VERSES[step]}</p>}
          <button type="button" onClick={skipReveal}>Skip</button>
        </div>
      )}

      <footer className="beneath__footer" inert={revealing}>
        <div className="beneath__controls" role="group" aria-label="3D view controls">
          <button type="button" className="beneath__primary" aria-pressed={apart} onClick={() => setApart(!apart)}>
            <Icon name="layers" /> {apart ? 'Reassemble Layers' : 'Explode Layers'}
          </button>
          <button type="button" className="beneath__water" aria-pressed={flowing} onClick={() => setFlowing(!flowing)}>
            <Icon name="drop" /> {flowing ? 'Stop inflow' : 'Stimulate water'}
          </button>
          <button type="button" onClick={() => {
            setApart(false);
            setSelected(null);
            setHovered(null);
            setReset((n) => n + 1);
          }}><Icon name="reset" /> Reset View</button>
          <button type="button" aria-pressed={labels} aria-label={`Layer Labels ${labels ? 'On' : 'Off'}`} onClick={() => setLabels(!labels)}>
            <Icon name="tag" /> Layer Labels <span className="beneath__toggle" aria-hidden="true" />
          </button>
        </div>
        <div className="beneath__footnote">
          <p id="beneath-gestures">
            <Icon name="orbit" />
            <span className="beneath__desktop-tip">{apart ? 'Drag a layer handle to move it' : 'Drag to rotate · Scroll to zoom'}</span>
            <span className="beneath__touch-tip">{apart ? 'Drag a layer handle to move it' : 'Drag to rotate · Pinch to zoom'}</span>
            <span className="beneath__sr"> Use the arrow keys to rotate and the plus and minus keys to zoom.</span>
          </p>
          <p>Conceptual cutaway · Not to scale</p>
        </div>
      </footer>
    </main>
  );
}
