import type { CameraView } from './config';
import type { LngLatTuple } from './map/geo';

/**
 * Guided journey: Basel → neighbourhood → Therwilerstrasse → follow the water → underground.
 *
 * Street geometry: OpenStreetMap contributors (ODbL), ways 26959988 (Therwilerstrasse) and
 * 23817106 (Paulusgasse). The same coordinates are used for the camera, the study-area outline
 * and the focus of the conceptual water paths, so nothing is moved off the real site.
 */

export const THERWILERSTRASSE: LngLatTuple[] = [
  [7.5767105, 47.5499784], [7.5772051, 47.5505628], [7.5772394, 47.5506033], [7.5772906, 47.5506668],
  [7.5777917, 47.5512636], [7.5778223, 47.5513209], [7.5778398, 47.5513542], [7.5778557, 47.5514008],
];
export const PAULUSGASSE: LngLatTuple[] = [
  [7.5775002, 47.5514247], [7.5775025, 47.5514666], [7.5775082, 47.5515001], [7.5775364, 47.551564],
  [7.5776032, 47.5516508], [7.5777165, 47.5517813], [7.5778966, 47.5519951], [7.5779964, 47.552104],
  [7.5780318, 47.5521383], [7.5780647, 47.552167], [7.5781065, 47.5522], [7.5781536, 47.552241],
];

/** Midpoint of the study streets (between Therwilerstrasse and the start of Paulusgasse). */
export const STUDY_CENTER: LngLatTuple = [7.57745, 47.55095];

/** Basel city centre (Marktplatz), used for the "Basel, Switzerland" label. */
export const BASEL_LABEL_AT: LngLatTuple = [7.588, 47.5581];

/** Compass bearing from a to b in degrees. */
function bearingOf(a: LngLatTuple, b: LngLatTuple): number {
  const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180);
  const dy = b[1] - a[1];
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/** Therwilerstrasse runs SSW→NNE (≈ 28–29°): look along it. */
export const STREET_BEARING = Math.round(bearingOf(THERWILERSTRASSE[0], THERWILERSTRASSE[THERWILERSTRASSE.length - 1]));

/* Camera presets. Zoom values are tuned for the OpenMapTiles building data at these places. */

/** Front-page opening (borrowed from the localhost:5180 prototype): starts far out and low… */
export const openingView: CameraView = {
  center: [7.5985, 47.5655],
  zoom: 11.9,
  pitch: 32,
  bearing: -26,
};

/** …and drifts into this tilted overview of Basel and the Rhine. */
export const cityView: CameraView = {
  center: [7.5885, 47.5585],
  zoom: 13.05,
  pitch: 50,
  bearing: -14,
};

/** Very slow turn while the front page is open (≈ 28° per 70 s). */
export const ORBIT_DEG_PER_SEC = 0.4;

export const neighborhoodView: CameraView = {
  center: [7.5786, 47.5521],
  zoom: 15.25,
  pitch: 54,
  bearing: 14,
};

/** Oblique view along the street: high enough to read both building rows, never inside them. */
export const streetView: CameraView = {
  center: STUDY_CENTER,
  zoom: 17.55,
  pitch: 63,
  bearing: STREET_BEARING,
};

/** Close view over a chosen infiltration point (the centre is replaced by that point). */
export function waterFocusView(at: LngLatTuple): CameraView {
  return { center: at, zoom: 18.3, pitch: 58, bearing: STREET_BEARING };
}

export type JourneyStage = 'city' | 'neighbourhood' | 'street' | 'water' | 'below';

export const JOURNEY: { key: JourneyStage; label: string }[] = [
  { key: 'city', label: 'City' },
  { key: 'neighbourhood', label: 'Neighborhood' },
  { key: 'street', label: 'Street' },
  { key: 'water', label: 'Water' },
  { key: 'below', label: 'Below' },
];

export const stageIndex = (s: JourneyStage) => JOURNEY.findIndex((j) => j.key === s);

export const DISCLOSURE =
  'Conceptual water movement visualization. Geographic buildings and streets use map data; water pathways are illustrative.';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
