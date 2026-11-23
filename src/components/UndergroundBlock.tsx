import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode, type RefObject, type SVGProps } from 'react';
import type { RainLevel } from './RainIntensity';
import type { LayerId } from './section/geometry';
import type { CameraCommand } from './beneath/StreetScene';
import type { LayerKey } from './beneath/data';
import './beneath/beneath.css';

export const loadStreetScene = () => import('./beneath/StreetScene');
const StreetScene = lazy(loadStreetScene);

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

const CHAPTERS = [
  { title: 'The old ground', layer: 'deep', verse: 'Far below, gravel and loam hold the memory of a place before the street.' },
  { title: 'Where roots reach', layer: 'roots', verse: 'In the dark, roots thread through the soil, reaching for the water it keeps.' },
  { title: 'Room for rain', layer: 'substrate', verse: 'Between stones, small spaces hold the rain for a little longer.' },
  { title: 'What carries us', layer: 'foundation', verse: 'A firm bed carries every footstep and wheel that passes above.' },
  { title: 'The street we know', layer: 'surface', verse: 'Asphalt, paving and a strip of green meet the rain at the surface.' },
  { title: 'The way down', layer: null, verse: 'Rain finds the curb, the open joints and the soil. Some stays close to the roots.' },
] as const;
const CHAPTER_MS = 4200;

const CAMERA_KEYS: Record<string, CameraCommand> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', '+': 'near', '=': 'near', '-': 'far',
};

/* the panel lists six layers; the block has five (the planted strip is part of the street surface) */
const toSlab = (id: LayerId | null): LayerKey | null =>
  id === null ? null : id === 'planted' ? 'surface' : id === 'rootzone' ? 'roots' : (id as LayerKey);
const toLayer = (k: LayerKey | null): LayerId | null => (k === null || k === 'water' ? null : k === 'roots' ? 'rootzone' : (k as LayerId));

interface Props {
  showFlows: boolean;
  flowStep: string | null;
  flowSvgRef: RefObject<SVGSVGElement | null>;
  apart: boolean;
  onApart: (v: boolean) => void;
  raining: boolean;
  rainIntensity: RainLevel;
  onRain: () => void;
  focus: LayerId | null;
  onFocus: (id: LayerId | null) => void;
}

/** The shared cutaway stays mounted when switching between Map and Water flows. */
export function UndergroundBlock({ showFlows, flowStep, flowSvgRef, apart, onApart, raining, rainIntensity, onRain, focus, onFocus }: Props) {
  const reducedAtStart = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [labels, setLabels] = useState(true);
  const [hovered, setHovered] = useState<LayerKey | null>(null);
  const [reset, setReset] = useState(0);
  const [chapter, setChapter] = useState<number | null>(0);
  const [playing, setPlaying] = useState(true);
  const [sceneReady, setSceneReady] = useState(false);
  const revealing = chapter !== null;
  const chapterIndex = chapter ?? 0;
  const current = revealing ? CHAPTERS[chapterIndex] : null;
  const [reduced, setReduced] = useState(reducedAtStart);
  const cameraCommand = useRef<((command: CameraCommand) => void) | null>(null);

  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    preference.addEventListener('change', handleChange);
    return () => preference.removeEventListener('change', handleChange);
  }, []);

  const endStory = () => {
    setChapter(null);
    setPlaying(false);
  };

  useEffect(() => {
    if (flowStep || focus || apart) {
      setChapter(null);
      setPlaying(false);
    }
  }, [flowStep, focus, apart]);

  useEffect(() => {
    if (!revealing || !playing || !sceneReady) return;
    const timer = window.setTimeout(() => {
      if (chapter + 1 < CHAPTERS.length) setChapter(chapter + 1);
      else endStory();
    }, CHAPTER_MS);
    return () => window.clearTimeout(timer);
  }, [chapter, playing, revealing, sceneReady]);

  const chooseChapter = (index: number) => {
    onApart(false);
    onFocus(null);
    setHovered(null);
    setChapter(index);
    setPlaying(false);
  };

  const replayStory = () => {
    chooseChapter(0);
    setPlaying(true);
  };

  return (
    <div
      className={`beneath ugb ${revealing ? 'is-revealing' : ''}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        if (revealing) {
          event.stopPropagation();
          endStory();
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
            <StreetScene revealed={revealing ? Math.min(chapterIndex + 1, 5) : 5} showFlows={showFlows} flowSvgRef={flowSvgRef}
              spinning={revealing && playing && !showFlows} onReady={() => setSceneReady(true)}
              apart={apart} raining={raining || (revealing && chapter === CHAPTERS.length - 1)} rainIntensity={rainIntensity}
              labels={labels && !revealing} reduced={reduced}
              selected={current ? current.layer : toSlab(focus)} hovered={hovered} reset={reset} cameraCommand={cameraCommand}
              onSelect={(k) => onFocus(toLayer(k))} onHover={setHovered} />
          </Suspense>
        </SceneBoundary>
      </div>

      <section className="glass ug__head layer-story" aria-labelledby="layer-story-title">
        <p className="layer-story__eyebrow">
          {current ? `${chapterIndex + 1} / ${CHAPTERS.length} · Therwilerstrasse` : 'Underground · Therwilerstrasse'}
        </p>
        <div aria-live="polite" aria-atomic="true">
          <h2 id="layer-story-title">{current?.title ?? (showFlows ? 'Where the rain goes' : 'Beneath the street')}</h2>
          <p className="layer-story__verse">{current?.verse ?? (showFlows
            ? 'Follow seven paths through the ground, from the first runoff to the water held by roots.'
            : 'Explore the cutaway layer by layer, from the street surface to the old ground.')}</p>
        </div>
        <div className="layer-story__actions">
          {current ? (
            <>
              <button type="button" onClick={() => chooseChapter(chapterIndex - 1)} disabled={chapter === 0}>Previous</button>
              <button type="button" className="layer-story__primary" onClick={() => {
                if (chapter === CHAPTERS.length - 1) endStory();
                else chooseChapter(chapterIndex + 1);
              }}>{chapter === CHAPTERS.length - 1 ? 'Explore layers' : 'Next layer'}</button>
              <button type="button" onClick={() => setPlaying((value) => !value)}>{playing ? 'Pause' : 'Play'}</button>
              <button type="button" onClick={endStory}>Skip</button>
            </>
          ) : (
            <button type="button" className="layer-story__primary" onClick={replayStory} disabled={!sceneReady}>Replay layer story</button>
          )}
        </div>
        {current && (
          <nav className="layer-story__chapters" aria-label="Layer chapters">
            <span>Layer chapters</span>
            <div>
              {CHAPTERS.map((entry, index) => (
                <button key={entry.title} type="button" title={entry.title} aria-label={entry.title}
                  aria-current={index === chapter ? 'step' : undefined} onClick={() => chooseChapter(index)} />
              ))}
            </div>
          </nav>
        )}
      </section>

      <footer className="beneath__footer" inert={revealing}>
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
