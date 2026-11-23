const LEVELS = ['Gentle', 'Moderate', 'Heavy'] as const;
export type RainLevel = 0 | 1 | 2;

export function RainIntensity({ intensity, onIntensity }: {
  intensity: RainLevel;
  onIntensity: (level: RainLevel) => void;
}) {
  return (
    <div className="segmented small rain-intensity" role="radiogroup" aria-label="Rainfall intensity (visual only)" title="Changes the animation only; not a rainfall or flood prediction">
      {LEVELS.map((label, index) => (
        <button key={label} role="radio" aria-checked={intensity === index} className={intensity === index ? 'on' : ''} onClick={() => onIntensity(index as RainLevel)}>
          {label}
        </button>
      ))}
    </div>
  );
}
