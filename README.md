# Basel Beneath the Surface — Urban Climate Lab

Interactive, cinematic 3D map of Basel built with React, TypeScript and MapLibre GL JS.
Journey: city overview → "Explore the City" → continuous camera flight → neighbourhood →
Paulusgasse / Therwilerstrasse → select buildings and trees → environmental layers.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
```

## Data sources (all real, loaded live, no API keys)

| What | Source |
| --- | --- |
| Basemap, streets, building footprints & heights | OpenStreetMap via OpenFreeMap vector tiles (OpenMapTiles schema) |
| Building facts (year, floors, dwellings, use, heating) | Federal building register GWR, Open Data Basel-Stadt (datasets 100230 / 100231) |
| Building name / height tags | OpenStreetMap via Overpass API (optional; often busy) |
| Trees (species, age, protection) | Baumkataster, Open Data Basel-Stadt (dataset 100052) |
| Heat island, PET, air temperature, cold-air flow & flow density, wind, focus areas, 2030 scenario | Stadtklima WMS, Geodaten Kanton Basel-Stadt (wms.geo.bs.ch) |
| Trees to be felled / replaced | Baumkataster WMS layer `BA_FaellUndBaumersatzliste` (wms.geo.bs.ch) |
| Live air temperature at ~50–200 sensors | meteoblue City Climate network via Open Data Basel-Stadt "Smart Climate Luftklima" (dataset 100009), refreshed every 5 min |

Anything not in a dataset is shown as "Data unavailable".

## What is conceptual

- **Make it Rain**: a visual rain effect plus a "wet street" look.
- **Reveal Water Flows**: animated paths built from real roofs, streets, trees and green areas
  (roof → nearest gutter → nearest tree pit / green area). It is an illustration, not a hydraulic model.
  Zoomed out, it shows city-wide runoff routes downhill towards the Birsig, Birs, Wiese and Rhine,
  pre-computed from Terrarium elevation tiles (AWS Open Data) by `node scripts/build-drainage.mjs`
  → `public/data/drainage.geojson` (depression filling + D8 flow accumulation; terrain only, ignores sewers and buildings).
- **Above / Below Surface**: a stylised cross-section of a sponge-city street, not to scale.
  Its **Concept** tab shows an illustrative infiltration-concept drawing (`public/concept/versickerungskonzept.jpg`).

## Structure

- `src/config.ts`: camera stages, data endpoints, climate layer list
- `src/map/style.ts`: custom dark navy style
- `src/map/cinematic.ts`: multi-stage camera flight (spline through keyframes, cancels on user input)
- `src/map/pick.ts`: 3D-aware building picking (tiles merge footprints into MultiPolygons)
- `src/map/flows.ts`: conceptual water-flow layer
- `src/data/*`: GWR, tree cadastre, OSM lookups
- `src/components/*`: UI panels, rain canvas, cross-section
