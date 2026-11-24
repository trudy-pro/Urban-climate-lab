import { useEffect, useRef, useState } from 'react';
import { JOURNEY, type JourneyStage } from '../../journey';
import { Icon } from './Icons';
import { Icon as MapIcon } from '../Icons';
import { RainIntensity, type RainLevel } from '../RainIntensity';

const DESCRIPTION = 'Travel from Basel to Therwilerstrasse and discover what happens to rainwater above and beneath the street during heavy rain.';

interface Props {
  ready: boolean;
  reached: number;
  onExplore: () => void;
  onGo: (stage: JourneyStage) => void;
}

export function CityOverview(p: Props) {
  const [speaking, setSpeaking] = useState(false);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const canSpeak = typeof window.speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';

  useEffect(() => () => {
    if (utterance.current) {
      utterance.current.onend = null;
      utterance.current.onerror = null;
      window.speechSynthesis.cancel();
    }
  }, []);

  const toggleNarration = () => {
    if (utterance.current) {
      const current = utterance.current;
      current.onend = null;
      current.onerror = null;
      window.speechSynthesis.cancel();
      utterance.current = null;
      setSpeaking(false);
      return;
    }
    const intro = new SpeechSynthesisUtterance(`How does a sponge-city street work? ${DESCRIPTION}`);
    intro.lang = 'en';
    const finish = () => {
      utterance.current = null;
      setSpeaking(false);
    };
    intro.onend = finish;
    intro.onerror = finish;
    utterance.current = intro;
    setSpeaking(true);
    window.speechSynthesis.speak(intro);
  };

  return (
    <section className="city-card glass" aria-labelledby="city-title">
      <p className="city-card__place"><span>1 / {JOURNEY.length}</span> · Basel, Switzerland</p>
      <h1 id="city-title">How Does a <em>Sponge-City</em> Street Work?</h1>
      <p className="city-card__summary">{DESCRIPTION}</p>

      <div className="city-card__actions">
        <button type="button" className="city-card__explore" disabled={!p.ready} onClick={() => p.onGo('street')}>
          Explore Basel <Icon.arrowRight />
        </button>
        {canSpeak && (
          <button type="button" className="city-card__sound" aria-label={speaking ? 'Stop narration' : 'Read the introduction aloud'} aria-pressed={speaking} onClick={toggleNarration}>
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
              <path fill="currentColor" d="M3 9h4l5-4v14l-5-4H3z" />
              <path d="M15 9a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      <div className="city-card__extras">
        <button type="button" disabled={!p.ready} onClick={p.onExplore}>Explore Freely</button>
      </div>

      <nav className="city-card__chapters" aria-label="Chapter navigation">
        <span>Chapter navigation</span>
        <div>
          {JOURNEY.map((chapter, index) => (
            <button key={chapter.key} type="button" aria-label={chapter.label} title={chapter.label}
              aria-current={index === 0 ? 'step' : undefined}
              disabled={index === 0 || !p.ready || (index > 2 && index > p.reached)}
              onClick={() => p.onGo(chapter.key)} />
          ))}
        </div>
      </nav>
    </section>
  );
}

interface MapActionsProps {
  ready: boolean;
  rain: boolean;
  flows: boolean;
  intensity: RainLevel;
  onIntensity: (level: RainLevel) => void;
  onRain: () => void;
  onFlows: () => void;
  onFly: () => void;
}

export function CityMapActions({ ready, rain, flows, intensity, onIntensity, onRain, onFlows, onFly }: MapActionsProps) {
  return (
    <div className="city-actions">
      {rain && <RainIntensity intensity={intensity} onIntensity={onIntensity} />}
      <div className="glass city-actions__bar" role="group" aria-label="Basel map actions">
        <button className="city-actions__primary" type="button" onClick={onFly} disabled={!ready}>
          <span>Explore Basel</span><Icon.arrowRight />
        </button>
        <button className="city-actions__fly" type="button" onClick={onFly} disabled={!ready}>
          <Icon.navigation /><span>Fly to Therwilerstrasse</span>
        </button>
        <button className="city-actions__rain" type="button" onClick={onRain} disabled={!ready} aria-pressed={rain}>
          <MapIcon.drop /><span>{rain ? 'Stop inflow' : 'Stimulate water'}</span>
        </button>
        <button className="city-actions__flow" type="button" onClick={onFlows} disabled={!ready} aria-pressed={flows}>
          <MapIcon.flow /><span>Water Flows</span>
        </button>
      </div>
    </div>
  );
}
