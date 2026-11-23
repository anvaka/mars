/**
 * Development tool: shows the old and the new elevation tiles side by side.
 * Drag the divider to compare them.
 *
 *    npm start, and open http://localhost:8080/tools/compare.html
 *
 * The left side is the 8 bit tileset hosted by MapBox, the right side is the
 * 16 bit PMTiles file that VITE_DEM_PMTILES points to.
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import { Map as MapLibreMap, NavigationControl, addProtocol, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Protocol } from 'pmtiles';
import { MAPBOX_TOKEN } from '../src/token.js';
import themes from '../src/lib/themes.js';

setWorkerUrl(workerUrl);
addProtocol('pmtiles', new Protocol().tile);

const MIN_ELEVATION = -8200;
const ELEVATION_RANGE = 21229 + 8200;

const before = createMap('before', {
  type: 'raster-dem',
  tiles: [`https://api.mapbox.com/v4/anvaka.8ctdbgc9/{z}/{x}/{y}.pngraw?access_token=${MAPBOX_TOKEN}`],
  tileSize: 256,
  maxzoom: 8,
  encoding: 'custom',
  redFactor: ELEVATION_RANGE / 256,
  greenFactor: 0,
  blueFactor: 0,
  baseShift: -MIN_ELEVATION
}, { hash: true });

const after = createMap('after', {
  type: 'raster-dem',
  url: 'pmtiles://' + import.meta.env.VITE_DEM_PMTILES,
  tileSize: 256,
  encoding: 'terrarium'
});

// handy for debugging from the browser console:
window.maps = { before, after };

after.addControl(new NavigationControl({ showCompass: false }), 'top-right');
keepInSync(before, after);
listenToDivider();
listenToModeChange();

function createMap(container, demSource, options = {}) {
  const map = new MapLibreMap({
    container,
    minZoom: 1,
    center: [-133.6, 18.4],
    zoom: 6,
    attributionControl: false,
    dragRotate: false,
    style: {
      version: 8,
      sources: { dem: demSource },
      layers: [
        { id: 'color', type: 'color-relief', source: 'dem', layout: { visibility: 'none' },
          paint: { 'color-relief-color': getColorRamp() } },
        { id: 'gray', type: 'background', paint: { 'background-color': '#9a9a9a' } },
        // Shaded relief shows every step of the elevation, this is where the
        // difference between 8 and 16 bit is the most visible.
        { id: 'shade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 1 } }
      ]
    },
    ...options
  });
  map.touchZoomRotate.disableRotation();
  return map;
}

function getColorRamp() {
  // Both sides get the same colors for the same elevation. The highest stop is
  // the largest value that an 8 bit tile is able to store.
  const steps = themes.RED.colorRamp;
  const total = steps.reduce((sum, step) => sum + (step.size || 0), 0);
  const ramp = ['interpolate', ['linear'], ['elevation']];
  let covered = 0;
  steps.forEach(step => {
    ramp.push(MIN_ELEVATION + ELEVATION_RANGE * 255 / 256 * covered / total, step.value);
    covered += step.size || 0;
  });
  return ramp;
}

function keepInSync(a, b) {
  let syncing = false;
  follow(a, b);
  follow(b, a);
  b.jumpTo({ center: a.getCenter(), zoom: a.getZoom() });

  function follow(leader, follower) {
    leader.on('move', () => {
      if (syncing) return;
      syncing = true;
      follower.jumpTo({ center: leader.getCenter(), zoom: leader.getZoom() });
      syncing = false;
    });
  }
}

function listenToDivider() {
  const divider = document.getElementById('divider');
  const afterContainer = document.getElementById('after');
  let position = window.innerWidth / 2;
  setPosition(position);

  divider.addEventListener('pointerdown', e => {
    divider.setPointerCapture(e.pointerId);
    divider.addEventListener('pointermove', onMove);
    divider.addEventListener('pointerup', () => divider.removeEventListener('pointermove', onMove), { once: true });
  });
  window.addEventListener('resize', () => setPosition(Math.min(position, window.innerWidth)));

  function onMove(e) {
    setPosition(e.clientX);
  }

  function setPosition(x) {
    position = Math.max(0, Math.min(window.innerWidth, x));
    divider.style.left = position + 'px';
    // The new tiles are on top, and we see them to the right of the divider:
    afterContainer.style.clipPath = `inset(0 0 0 ${position}px)`;
  }
}

function listenToModeChange() {
  document.querySelectorAll('input[name=mode]').forEach(input => {
    input.addEventListener('change', () => setMode(input.value));
  });
}

function setMode(mode) {
  [before, after].forEach(map => {
    map.setLayoutProperty('color', 'visibility', mode === 'shade' ? 'none' : 'visible');
    map.setLayoutProperty('gray', 'visibility', mode === 'shade' ? 'visible' : 'none');
    map.setLayoutProperty('shade', 'visibility', mode === 'color' ? 'none' : 'visible');
  });
}
