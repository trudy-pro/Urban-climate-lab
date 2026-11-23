/** Conceptual cutaway. X crosses the street, Z follows it and Y points up. */
export const LAYERS = [
  {
    key: 'surface', name: 'Street Surface', material: 'Asphalt · paving · planting', swatch: '#7b807b',
    text: 'The road and sidewalks shed rain toward the curb. The planted strip and open-jointed paving give some of that runoff a way into the ground.',
  },
  {
    key: 'foundation', name: 'Foundation & Infrastructure', material: 'Compacted base · utilities', swatch: '#aba08b',
    text: 'A compacted base supports the street. Building footings and utility pipes share this band, and curb inlets carry some runoff into the sewer.',
  },
  {
    key: 'substrate', name: 'Substrate', material: 'Engineered stone and soil', swatch: '#a6815b',
    text: 'Stone carries the weight of the pavement. The pores between stones hold some of the rain that enters through the planted strip and permeable paving.',
  },
  {
    key: 'roots', name: 'Root Zone', material: 'Planting soil · tree roots', swatch: '#79573d',
    text: 'Roots spread through the planting soil and draw on stored rainwater between showers. This gives street trees a longer supply of water.',
  },
  {
    key: 'deep', name: 'Deeper Ground', material: 'Native soil · gravel', swatch: '#57473c',
    text: 'Native soil and gravel underlie the built layers. Some water may seep farther down where the ground allows it.',
  },
  {
    key: 'water', name: 'Water Movement', material: 'Runoff · infiltration · storage', swatch: '#287eba',
    text: 'Follow runoff to a curb inlet, or trace it through open surfaces into the substrate and root zone. The blue pools show where some water is held.',
  },
] as const;

export type LayerKey = typeof LAYERS[number]['key'];
export type SlabKey = Exclude<LayerKey, 'water'>;
export const SLABS = ['surface', 'foundation', 'substrate', 'roots', 'deep'] as const;

export const BAND: Record<SlabKey, [top: number, bottom: number]> = {
  surface: [0, -0.43],
  foundation: [-0.43, -1.75],
  substrate: [-1.75, -3.18],
  roots: [-3.18, -4.49],
  deep: [-4.49, -6.42],
};

export const WIDTH = 24;
export const LENGTH = 16;
export const PLANT_TOP = -0.09;
export const TREES = [[2.85, -4.2], [2.85, 3.65]] as const;
export const INLETS_Z = [-5.35, 0.35, 5.82];
export const SEWER = { x: -2.6, y: -1.08, radius: 0.43 };

export const BUILDINGS = [
  { x: -10.18, z: -5.18, w: 3.55, d: 5.5, h: 5.6, plaster: '#ded1b9', trim: '#ede2cc', roof: '#765e4e', shutters: '#617068' },
  { x: -10.18, z: 0.12, w: 3.55, d: 4.92, h: 6.48, plaster: '#e4d8c4', trim: '#f3ebda', roof: '#8c6e57', shutters: '#6b7063' },
  { x: -10.18, z: 5.12, w: 3.55, d: 4.92, h: 5.15, plaster: '#bfaa91', trim: '#e4ceb4', roof: '#6e5b50', shutters: '#5f6963' },
  { x: 10.65, z: -5.3, w: 2.64, d: 5.16, h: 4.75, plaster: '#d9c4ad', trim: '#f2e5cf', roof: '#806451', shutters: '#6d7262' },
  { x: 10.65, z: -0.68, w: 2.64, d: 4, h: 4.15, plaster: '#c3b6a3', trim: '#e3d4bd', roof: '#716052', shutters: '#65706a' },
] as const;

export interface ModelState {
  offset: Record<SlabKey, number>;
  manual: Record<SlabKey, number>;
  down: boolean;
}

export function zeroOffsets(): Record<SlabKey, number> {
  return { surface: 0, foundation: 0, substrate: 0, roots: 0, deep: 0 };
}

export function seededRandom(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
