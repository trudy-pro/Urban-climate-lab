import type { ReactNode } from 'react';
import { describeBuildingType, type OsmBuilding } from '../data/osm';
import type { TreeProps } from '../data/trees';
import type { GwrBuilding } from '../data/gwr';
import type { LngLatTuple } from '../map/geo';

export type Selection =
  | {
      kind: 'building';
      lngLat: LngLatTuple;
      renderHeight: number | null;
      renderMinHeight: number | null;
      area: number;
      gwr: GwrBuilding | null | 'loading' | 'error';
      osm: OsmBuilding | null | 'loading' | 'error';
    }
  | { kind: 'tree'; lngLat: LngLatTuple; props: TreeProps };

const NA = <span className="na">Data unavailable</span>;

function Row({ label, children, note }: { label: string; children: ReactNode; note?: string }) {
  return (
    <div className="row">
      <dt>{label}</dt>
      <dd>
        {children}
        {note && <small>{note}</small>}
      </dd>
    </div>
  );
}

export function InfoPanel({ sel, onClose }: { sel: Selection | null; onClose: () => void }) {
  return (
    <aside className={`info ${sel ? 'is-open' : ''}`} aria-hidden={!sel} aria-live="polite">
      {sel && (
        <>
          <button className="icon-btn info__close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
          {sel.kind === 'building' ? <BuildingBody sel={sel} /> : <TreeBody sel={sel} />}
        </>
      )}
    </aside>
  );
}

function BuildingBody({ sel }: { sel: Extract<Selection, { kind: 'building' }> }) {
  const osm = sel.osm && typeof sel.osm === 'object' ? sel.osm : null;
  const g = sel.gwr && typeof sel.gwr === 'object' ? sel.gwr : null;
  const loadingG = sel.gwr === 'loading';
  const t = osm?.tags ?? {};
  const osmStreet = t['addr:street'] ? `${t['addr:street']} ${t['addr:housenumber'] ?? ''}`.trim() : null;
  const address = g?.address ?? osmStreet;
  const title = t.name || address?.split(',')[0] || (loadingG ? null : 'Building');
  const use = g?.gklas_decoded ?? describeBuildingType(t.building);
  const heightTag = t.height ? `${t.height.replace(/\s*m$/, '')} m (OSM)` : null;
  const heat = [g?.gwaerzh1_decoded, g?.genh1_decoded].filter(Boolean).join(' · ');
  const L = (v: ReactNode) => (loadingG ? '…' : v ?? NA);

  return (
    <>
      <p className="eyebrow">Selected building</p>
      <h3>{title ?? <span className="shimmer">Looking up the building register…</span>}</h3>
      {title && address && title !== address.split(',')[0] && <p className="sub">{address}</p>}
      <dl>
        <Row label="Address">{L(address)}</Row>
        <Row label="Use">{L(use)}</Row>
        <Row label="Built">
          {L(g?.gbauj ? `${g.gbauj}` : g?.gbaup_decoded ? g.gbaup_decoded.replace('Periode ', '') : null)}
        </Row>
        <Row label="Floors">{L(g?.gastw ?? t['building:levels'] ?? null)}</Row>
        <Row label="Dwellings">{L(g?.ganzwhg ?? null)}</Row>
        <Row label="Height">{sel.osm === 'loading' && !heightTag ? '…' : heightTag ?? NA}</Row>
        <Row label="Footprint" note={g?.garea ? 'official register (GWR)' : sel.area ? 'computed from the map outline' : undefined}>
          {L(g?.garea ? `${g.garea.toLocaleString('de-CH')} m²` : sel.area > 0 ? `≈ ${Math.round(sel.area).toLocaleString('de-CH')} m²` : null)}
        </Row>
        <Row label="3D model" note="OpenStreetMap height or levels; a default where missing">
          {sel.renderHeight != null ? `${Math.round(sel.renderHeight)} m extrusion` : NA}
        </Row>
      </dl>

      <div className="info__env">
        <p className="eyebrow">Energy & environment</p>
        <dl className="mini">
          <Row label="Heating">{L(heat || null)}</Row>
          <Row label="Hot water">{L(g?.genw1_decoded ?? null)}</Row>
        </dl>
        <p>
          Roof runoff, sealing ratio and soil permeability for this parcel: {NA}. No measured dataset is connected,
          so the water-flow layer shows <em>conceptual</em> paths only.
        </p>
      </div>

      <p className="info__src">
        {g ? (
          <span>
            Register:{' '}
            <a href="https://data.bs.ch/explore/dataset/100230/" target="_blank" rel="noreferrer">
              GWR Basel-Stadt
            </a>{' '}
            · EGID {g.egid}
          </span>
        ) : sel.gwr === 'error' ? (
          <span>Building register unavailable right now.</span>
        ) : sel.gwr === null ? (
          <span>No entry in the building register at this point.</span>
        ) : null}
        {osm ? (
          <span>
            OSM:{' '}
            <a href={`https://www.openstreetmap.org/${osm.type}/${osm.id}`} target="_blank" rel="noreferrer">
              {osm.type} {osm.id}
            </a>
          </span>
        ) : sel.osm === 'error' ? (
          <span>OpenStreetMap lookup unavailable (Overpass busy).</span>
        ) : null}
        <span className="coords">
          {sel.lngLat[1].toFixed(5)}° N, {sel.lngLat[0].toFixed(5)}° E
        </span>
      </p>
    </>
  );
}

function TreeBody({ sel }: { sel: Extract<Selection, { kind: 'tree' }> }) {
  const p = sel.props;
  return (
    <>
      <p className="eyebrow eyebrow--green">Tree cadastre · Basel-Stadt</p>
      <h3>{p.baumart_deutsch ?? 'Tree'}</h3>
      {p.baumart_lateinisch && <p className="sub"><em>{p.baumart_lateinisch}</em></p>}
      <dl>
        <Row label="Tree no.">{p.ba_baumnr ?? NA}</Row>
        <Row label="Age">{p.ba_baumalter != null ? `${p.ba_baumalter} years` : NA}</Row>
        <Row label="Years on site">{p.ba_standjahr != null ? `${p.ba_standjahr}` : NA}</Row>
        <Row label="Location">{p.ba_strasse ?? NA}</Row>
        <Row label="Category">{p.ba_gruppe ?? NA}</Row>
        <Row label="Protection">{p.ba_schutzstatus ?? NA}</Row>
      </dl>
      <div className="info__env">
        <p className="eyebrow">Sponge-city role</p>
        <p>
          Street trees can take in runoff through their pits, shade the street and cool it as water evaporates.
          Crown size and rooting volume for this tree: {NA}.
        </p>
      </div>
      <p className="info__src">
        Source:{' '}
        <a href="https://data.bs.ch/explore/dataset/100052/" target="_blank" rel="noreferrer">
          Open Data Basel-Stadt · Baumkataster
        </a>
        <span className="coords">
          {sel.lngLat[1].toFixed(5)}° N, {sel.lngLat[0].toFixed(5)}° E
        </span>
      </p>
    </>
  );
}
