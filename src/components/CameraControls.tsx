import { Icon } from './Icons';

interface Props {
  bearing: number;
  pitch: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRotate: (deg: number) => void;
  onNorth: () => void;
  onTilt: () => void;
  onReset: () => void;
  onFlyTarget: () => void;
}

export function CameraControls(p: Props) {
  return (
    <div className="camctl" role="toolbar" aria-label="Camera controls">
      <div className="glass camctl__group">
        <button className="ctl" onClick={p.onZoomIn} aria-label="Zoom in" data-tip="Zoom in">
          <Icon.plus />
        </button>
        <button className="ctl" onClick={p.onZoomOut} aria-label="Zoom out" data-tip="Zoom out">
          <Icon.minus />
        </button>
      </div>
      <div className="glass camctl__group">
        <button className="ctl" onClick={() => p.onRotate(-30)} aria-label="Rotate left" data-tip="Rotate left">
          <Icon.rotL />
        </button>
        <button className="ctl compass" onClick={p.onNorth} aria-label="Reset north" data-tip="Face north">
          <svg viewBox="0 0 24 24" width="22" height="22" style={{ transform: `rotateX(${p.pitch * 0.6}deg) rotate(${-p.bearing}deg)` }}>
            <path d="M12 3l3.2 9H8.8z" fill="#ff6b6b" />
            <path d="M12 21l-3.2-9h6.4z" fill="#8a97b0" />
          </svg>
        </button>
        <button className="ctl" onClick={() => p.onRotate(30)} aria-label="Rotate right" data-tip="Rotate right">
          <Icon.rotR />
        </button>
        <button className="ctl" onClick={p.onTilt} aria-label="Toggle tilt" data-tip={p.pitch > 20 ? 'Top-down view' : 'Tilt 3D'}>
          <span className="ctl__txt">{p.pitch > 20 ? '2D' : '3D'}</span>
        </button>
      </div>
      <div className="glass camctl__group">
        <button className="ctl" onClick={p.onReset} aria-label="Reset view to Basel overview" data-tip="Basel overview">
          <Icon.reset />
        </button>
        <button className="ctl ctl--accent" onClick={p.onFlyTarget} aria-label="Fly to Therwilerstrasse" data-tip="Fly to Therwilerstrasse">
          <Icon.target />
        </button>
      </div>
    </div>
  );
}
