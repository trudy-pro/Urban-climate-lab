const LEVELS = ['Light', 'Heavy', 'Extreme'] as const;
export type RainLevel = 0 | 1 | 2;

export function RainIntensity({ intensity, onIntensity }: {
  intensity: RainLevel;
  onIntensity: (level: RainLevel) => void;
}) {
  return (
    <label className="rain-intensity">
      <span>Rainfall</span>
      <input
        type="range"
        min={0}
        max={2}
        step={1}
        value={intensity}
        aria-valuetext={LEVELS[intensity]}
        onChange={(event) => onIntensity(event.currentTarget.valueAsNumber as RainLevel)}
      />
      <span className="rain-intensity__level" aria-hidden="true">{LEVELS[intensity]}</span>
    </label>
  );
}
