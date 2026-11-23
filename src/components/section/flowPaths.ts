import { INLET_X, SEWER, surfaceY, type LayerId } from './geometry';

export interface FlowStep {
  id: string;
  label: string;
  text: string;
  /** layer to highlight when the step is picked */
  layer: LayerId | null;
  color: string;
  dashed?: boolean;
  /** path on the cut face, section coordinates */
  pts: [number, number][];
}

const along = (x0: number, x1: number, f: (x: number) => number, step = 18): [number, number][] => {
  const o: [number, number][] = [];
  for (let x = x0; x < x1; x += step) o.push([x, f(x)]);
  o.push([x1, f(x1)]);
  return o;
};

export const FLOW_STEPS: FlowStep[] = [
  {
    id: 'runoff',
    label: 'Runs off the sealed street',
    text: 'Rain cannot soak into asphalt. It runs along the street\u2019s slight cross-fall towards the curb.',
    layer: 'surface',
    color: '#5aa8ff',
    pts: [...along(320, 604, (x) => surfaceY(x) - 2), [618, 182], [640, 188]],
  },
  {
    id: 'sewer',
    label: 'Some still goes to the sewer',
    text: 'In heavy rain, part of the runoff reaches the street inlet and the combined sewer, as on a conventional street.',
    layer: null,
    color: '#8d99ad',
    pts: [[INLET_X, 179], [INLET_X, 206], [570, 236], [530, 262], [SEWER.x + 14, SEWER.y - 6]],
  },
  {
    id: 'infiltrate',
    label: 'Soaks into the planted strip',
    text: 'The planted depression collects runoff from the street, so water can soak into the topsoil instead of the drain.',
    layer: 'planted',
    color: '#45dcf0',
    pts: [[652, 190], [672, 194], [690, 200], [694, 212], [690, 226]],
  },
  {
    id: 'pavers',
    label: 'Seeps through permeable paving',
    text: 'In the parking strip, open joints let rain seep through the paving into the substrate below.',
    layer: 'surface',
    color: '#45dcf0',
    pts: [[900, 173], [903, 186], [899, 198], [904, 214]],
  },
  {
    id: 'retain',
    label: 'Is held in the tree substrate',
    text: 'The porous substrate stores water in its pore spaces for a while and releases it slowly.',
    layer: 'substrate',
    color: '#4fb6ff',
    pts: [[700, 236], [748, 244], [800, 238], [852, 246], [906, 236], [950, 244]],
  },
  {
    id: 'roots',
    label: 'Is taken up by roots',
    text: 'Roots draw part of the stored water up into the tree, which cools the street when it evaporates through the leaves.',
    layer: 'rootzone',
    color: '#4ef0a2',
    pts: [[760, 272], [740, 258], [722, 240], [712, 220], [706, 198]],
  },
  {
    id: 'deeper',
    label: 'A little seeps deeper',
    text: 'Where the ground allows, some water seeps further down. How much, and how deep, is uncertain and varies by site.',
    layer: 'deep',
    color: '#b39cff',
    dashed: true,
    pts: [[820, 296], [826, 318], [818, 340], [824, 362]],
  },
];
