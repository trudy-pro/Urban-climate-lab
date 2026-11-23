import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode, type SVGProps } from 'react';
import type { LayerId } from './section/geometry';
import type { CameraCommand } from './beneath/StreetScene';
import type { LayerKey } from './beneath/data';
import './beneath/beneath.css';

const StreetScene = lazy(() => import('./beneath/StreetScene'));

type IconName = 'layers' | 'rain' | 'reset' | 'tag' | 'orbit';
const ICONS: Record<IconName, ReactNode> = {
  layers: <><path d="m3 9 9-5 9 5-9 5z" /><path d="m3 13 9 5 9-5M3 17l9 5 9-5" /></>,
  rain: <><path d="M7.2 13.5a4 4 0 0 1-.7-7.94 5.5 5.5 0 0 1 10.34.78 3.6 3.6 0 0 1-.55 7.16h-1M9 14.5l-1.5 3.2m4.6-1.2-1.5 3.2m6-4.2L15 19" /></>,
  reset: <><path d="M3.5 11a8.5 8.5 0 1 1 2.2 6.8M3.5 5v6h6" /></>,
  tag: <><path d="M3.5 5.5v6.2l8.4 8.4a1.4 1.4 0 0 0 2 0l6.2-6.2a1.4 1.4 0 0 0 0-2l-8.4-8.4H5.5a2 2 0 0 0-2 2Z" /><circle cx="8" cy="8" r="1" /></>,
  orbit: <><ellipse cx="12" cy="14" rx="8.5" ry="3.6" /><path d="M8 9.4C8.8 5.5 10.3 3 12 3c2.4 0 4.4 4.6 4.4 10.2S14.4 22 12 22c-1.1 0-2.2-1.1-3-3" /></>,
};
function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {ICONS[name]}
    </svg>
  );
}

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p className="beneath__unavailable">This browser could not open the 3D view.</p> : this.props.children;
  }
}

/** the opening: the block builds itself from the deepest layer up, one line at a time */
const VERSES = [
  'Far below lies the old ground, gravel and loam laid down long before the street.',
  'Above it, the root zone, where the trees reach into the dark for water.',
  'Then a porous substrate: stone and soil, full of small spaces that can hold the rain.',
  'Over it, the firm foundation that carries the street.',
  'And on top, the street you know: asphalt, paving, and a strip of green.',
  'When it rains, the water finds its own way down.',
];
const STEP_MS = 2300;

const CAMERA_KEYS: Record<string, CameraCommand> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', '+': 'near', '=': 'near', '-': 'far',
};

/* the panel lists six layers; the block has five (the planted strip is part of the street surface) */
const toSlab = (id: LayerId | null): LayerKey | null =>
  id === null ? null : id === 'planted' ? 'surface' : id === 'rootzone' ? 'roots' : (id as LayerKey);
const toLayer = (k: LayerKey | null): LayerId | null => (k === null || k === 'water' ? null : k === 'roots' ? 'rootzone' : (k as LayerId));

interface Props {
  apart: boolean;
  onApart: (v: boolean) => void;
  raining: boolean;
  onRain: () => void;
  focus: LayerId | null;
  onFocus: (id: LayerId | null) => void;
}

/**
 * The Map tab of the underground view: the street block as a 3D model to turn, pull apart and rain on.
 * It sits under the existing heading and Map / Water flows panel, which keep working as before.
 */
export function UndergroundBlock({ apart, onApart, raining, onRain, focus, onFocus }: Props) {
  const reducedAtStart = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [labels, setLabels] = useState(true);
  const [hovered, setHovered] = useState<LayerKey | null>(null);
  const [reset, setReset] = useState(0);
  // 0..5 layers revealed, 6 = the rain verse, 7 = done
  const [step, setStep] = useState(() => (reducedAtStart ? 7 : 0));
  const revealing = step < 7;
  const [shower, setShower] = useState(false);
  // the opening waits for the 3D scene, so each line arrives with its layer
  const [sceneReady, setSceneReady] = useState(false);
  const [reduced, setReduced] = useState(reducedAtStart);
  const cameraCommand = useRef<((command: CameraCommand) => void) | null>(null);

  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    preference.addEventListener('change', handleChange);
    return () => preference.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!revealing || !sceneReady) return;
    // a brief first shower once the street is in place, then hand over the controls
    if (step === 6) setShower(true);
    const t = setTimeout(() => {
      setStep((n) => n + 1);
      if (step === 6) setShower(false);
    }, step === 0 ? 900 : step === 6 ? STEP_MS * 2 : STEP_MS);
    return () => clearTimeout(t);
  }, [revealing, step, sceneReady]);

  const skipReveal = () => {
    setStep(7);
    setShower(false);
  };

  return (
    <div
      className={`beneath ugb ${revealing ? 'is-revealing' : ''}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        if (revealing) {
          event.stopPropagation();
          skipReveal();
        }
      }}
    >
      <div className="beneath__stage" tabIndex={0} role="region" aria-label="Interactive 3D street block"
        aria-describedby="ugb-gestures" onKeyDown={(event) => {
          const command = CAMERA_KEYS[event.key];
          if (!command || event.target !== event.currentTarget) return;
          event.preventDefault();
          cameraCommand.current?.(command);
        }} onPointerLeave={() => setHovered(null)}>
        <SceneBoundary>
          <Suspense fallback={<p className="beneath__unavailable" role="status">Loading the 3D street block…</p>}>
            <StreetScene revealed={Math.min(step, 5)} spinning={revealing} onReady={() => setSceneReady(true)}
              apart={apart} raining={raining || shower} labels={labels && !revealing} reduced={reduced}
              selected={toSlab(focus)} hovered={hovered} reset={reset} cameraCommand={cameraCommand}
              onSelect={(k) => onFocus(toLayer(k))} onHover={setHovered} />
          </Suspense>
        </SceneBoundary>
      </div>

      {revealing && (
        <div className="beneath__verse" aria-live="polite">
          {step > 0 && <p key={step}>{VERSES[Math.min(step, 6) - 1]}</p>}
          <button type="button" onClick={skipReveal}>Skip</button>
        </div>
      )}

      <footer className="beneath__footer">
        <div className="beneath__controls" role="group" aria-label="3D view controls">
          <button type="button" className="beneath__primary" aria-pressed={apart} onClick={() => onApart(!apart)}>
            <Icon name="layers" /> {apart ? 'Reassemble Layers' : 'Explode Layers'}
          </button>
          <button type="button" className="beneath__rain" aria-pressed={raining} onClick={onRain}>
            <Icon name="rain" /> {raining ? 'Stop Rain' : 'Make It Rain'}
          </button>
          <button type="button" onClick={() => {
            onApart(false);
            onFocus(null);
            setHovered(null);
            setReset((n) => n + 1);
          }}><Icon name="reset" /> Reset View</button>
          <button type="button" aria-pressed={labels} aria-label={`Layer Labels ${labels ? 'On' : 'Off'}`} onClick={() => setLabels(!labels)}>
            <Icon name="tag" /> Layer Labels <span className="beneath__toggle" aria-hidden="true" />
          </button>
        </div>
        <div className="beneath__footnote">
          <p id="ugb-gestures">
            <Icon name="orbit" />
            <span className="beneath__desktop-tip">{apart ? 'Drag a layer handle to move it' : 'Drag to rotate · Scroll to zoom'}</span>
            <span className="beneath__touch-tip">{apart ? 'Drag a layer handle to move it' : 'Drag to rotate · Pinch to zoom'}</span>
            <span className="beneath__sr"> Use the arrow keys to rotate and the plus and minus keys to zoom.</span>
          </p>
          <p>Conceptual cutaway · Not to scale</p>
        </div>
      </footer>
    </div>
  );
}
