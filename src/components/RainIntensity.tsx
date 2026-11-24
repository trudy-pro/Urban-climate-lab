const LEVELS = ['Gentle', 'Moderate', 'Heavy'] as const;
export type RainLevel = 0 | 1 | 2;

export function RainIntensity({ intensity, onIntensity }: {
  intensity: RainLevel;
  onIntensity: (level: RainLevel) => void;
}) {
  const label = LEVELS[intensity];
  return (
    <label className="rain-intensity">
      <span>Inflow</span>
      <input type="range" min={0} max={2} step={1} value={intensity} aria-valuetext={label}
        onChange={(event) => onIntensity(event.currentTarget.valueAsNumber as RainLevel)} />
      <span className="rain-intensity__level" aria-hidden="true">{label}</span>
    </label>
  );
}
