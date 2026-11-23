import { useId } from 'react';
import './therwilerstrasseMarker.css';

const LEADER = 'M 5 -4 L 25 -21 H 62';

export function TherwilerstrasseMarker() {
  const drawMask = useId();

  return (
    <div className="therwiler-marker">
      <svg className="therwiler-marker__geometry" viewBox="-35 -35 101 70" width="101" height="70" aria-hidden="true">
        <defs>
          <mask id={drawMask} x="-35" y="-35" width="101" height="70" maskUnits="userSpaceOnUse">
            <path d={LEADER} pathLength="1" className="therwiler-marker__draw" stroke="white" strokeWidth="4" fill="none" />
          </mask>
        </defs>
        <circle className="therwiler-marker__radar" r="28" />
        <circle className="therwiler-marker__pulse" r="28" />
        <path d={LEADER} className="therwiler-marker__leader" mask={`url(#${drawMask})`} />
        <g className="therwiler-marker__reticle">
          <circle r="6" />
          <circle className="therwiler-marker__point" r="2.25" />
        </g>
      </svg>
      <span className="therwiler-marker__target-hit" aria-hidden="true" />
      <span className="therwiler-marker__label-position">
        <span className="therwiler-marker__label">
          <span className="therwiler-marker__status" aria-hidden="true" />
          THERWILERSTRASSE
        </span>
      </span>
    </div>
  );
}
