/**
 * Draws routes of the rovers on the map. A route is loaded when the map
 * comes close to it: the files are large, and most of the visitors never get
 * that close.
 */
import { ROVERS, loadRover, getStopsCollection } from './rovers.js';

const MIN_ZOOM_TO_LOAD = 6;
const MAX_DEGREES_FROM_HOME = 2;
// Stops are a few dozen meters apart. They merge into the line when seen from afar.
const MIN_ZOOM_OF_STOPS = 11;
const STOP_COLOR = '#ff4081';
// Stops where the rover has recorded a sound. They are rare and far from
// each other, so they are marked with a note and are seen from afar.
const SOUND_COLOR = '#ffd95a';
const SOUND_ICON = 'rover-sound';
const SOUND_ICON_SIZE = 22;
const MIN_ZOOM_OF_SOUNDS = 8;
// The layers where a stop can be clicked
const LAYER_PREFIXES = ['rover-stops-', 'rover-latest-', 'rover-sounds-'];
// Photos from the orbit cover only a small rectangle around the route. They
// appear when the rectangle is larger than the screen, and its edges are
// not that striking.
const MIN_ZOOM_OF_IMAGERY = 9.5;
// The photos go below everything but the colors of elevation:
const LAYER_ABOVE_IMAGERY = 'night';

/**
 * @param {Object} map - maplibre map
 *
 * Returns an object with `findStop(point, reach)`. It tells which stop of a
 * rover is drawn at the given point of the screen, or not farther than
 * `reach` pixels from it: `{rover, stop}`, see ./rovers.js for their
 * description. If there are several, the closest one wins.
 */
export function showRoversOnMap(map) {
  const requested = new Set();
  // The rovers whose routes are on the map
  const shown = new Map();
  map.addImage(SOUND_ICON, drawSoundIcon(), { pixelRatio: 2 });

  map.on('moveend', loadNearbyRovers);
  loadNearbyRovers();

  return { findStop };

  function findStop(point, reach = 0) {
    const layers = Array.from(shown.keys()).flatMap(id => LAYER_PREFIXES.map(prefix => prefix + id));
    if (!layers.length) return null;

    const area = [[point.x - reach, point.y - reach], [point.x + reach, point.y + reach]];
    let closest = null;
    let closestDistance = Infinity;
    map.queryRenderedFeatures(area, { layers }).forEach(feature => {
      const place = map.project(feature.geometry.coordinates);
      const distance = Math.hypot(place.x - point.x, place.y - point.y);
      if (distance < closestDistance) {
        closest = feature;
        closestDistance = distance;
      }
    });
    if (!closest) return null;

    const rover = shown.get(closest.properties.rover);
    const stop = rover && rover.stops[closest.properties.index];
    return stop ? { rover, stop } : null;
  }

  function loadNearbyRovers() {
    if (map.getZoom() < MIN_ZOOM_TO_LOAD) return;

    const bounds = map.getBounds();
    const center = map.getCenter();
    Object.keys(ROVERS).forEach(id => {
      const [longitude, latitude] = ROVERS[id].home;
      // When the map is zoomed deep into the route, the home point may be
      // outside of the screen, yet we are still close to it.
      const isNear = bounds.contains(ROVERS[id].home) ||
        Math.hypot(center.lng - longitude, center.lat - latitude) < MAX_DEGREES_FROM_HOME;
      if (requested.has(id) || !isNear) return;

      requested.add(id);
      loadRover(id).then(addRover).catch(e => {
        console.warn('Could not show the route of ' + ROVERS[id].name, e);
        requested.delete(id);
      });
    });
  }

  function addRover(rover) {
    shown.set(rover.id, rover);
    const track = 'rover-track-' + rover.id;
    const stops = 'rover-stops-' + rover.id;
    const latest = 'rover-latest-' + rover.id;
    const sounds = 'rover-sounds-' + rover.id;
    const isLatest = ['get', 'isLatest'];

    rover.imagery.forEach((imagery, index) => {
      const id = `rover-imagery-${rover.id}-${index}`;
      map.addSource(id, {
        type: 'raster',
        tiles: [imagery.tiles],
        // NASA counts rows of tiles from the South
        scheme: 'tms',
        tileSize: 256,
        bounds: imagery.bounds,
        minzoom: imagery.minzoom,
        maxzoom: imagery.maxzoom,
        attribution: imagery.attribution
      });
      map.addLayer({
        id, type: 'raster', source: id, minzoom: MIN_ZOOM_OF_IMAGERY,
        paint: {
          'raster-opacity': ['interpolate', ['linear'], ['zoom'], MIN_ZOOM_OF_IMAGERY, 0, MIN_ZOOM_OF_IMAGERY + 1, 1]
        }
      }, LAYER_ABOVE_IMAGERY);
    });

    map.addSource(track, { type: 'geojson', data: rover.track });
    map.addSource(stops, { type: 'geojson', data: getStopsCollection(rover) });

    const line = { 'line-join': 'round', 'line-cap': 'round' };
    map.addLayer({
      id: track + '-outline', type: 'line', source: track, layout: line,
      paint: { 'line-color': 'rgba(0, 0, 0, 0.5)', 'line-width': 4.5 }
    });
    map.addLayer({
      id: track, type: 'line', source: track, layout: line,
      paint: { 'line-color': '#ffffff', 'line-width': 2 }
    });
    map.addLayer({
      id: stops, type: 'circle', source: stops, minzoom: MIN_ZOOM_OF_STOPS,
      filter: ['!', isLatest],
      // Stops with a sound are rare, so they are on top of their neighbors
      layout: { 'circle-sort-key': ['case', ['get', 'hasSound'], 1, 0] },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], MIN_ZOOM_OF_STOPS, 2.5, 15, 5.5],
        'circle-color': ['case', ['get', 'hasSound'], SOUND_COLOR, STOP_COLOR],
        'circle-stroke-color': '#ffffff',
        // From afar the stops are packed, and a wide stroke would leave
        // nothing but white on the map
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], MIN_ZOOM_OF_STOPS, 0.5, 14, 1.5]
      }
    });
    // The place where the rover is now:
    map.addLayer({
      id: latest, type: 'circle', source: stops, filter: isLatest,
      paint: {
        'circle-radius': 6.5,
        'circle-color': STOP_COLOR,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2
      }
    });
    map.addLayer({
      id: latest + '-label', type: 'symbol', source: stops, filter: isLatest,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Medium'],
        'text-size': 12,
        'text-anchor': 'top',
        'text-offset': [0, 0.9]
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0, 0, 0, 0.75)',
        'text-halo-width': 1.4
      }
    });

    map.addLayer({
      id: sounds, type: 'symbol', source: stops, minzoom: MIN_ZOOM_OF_SOUNDS,
      filter: ['get', 'hasSound'],
      layout: {
        'icon-image': SOUND_ICON,
        'icon-allow-overlap': true,
        'text-field': ['get', 'sounds'],
        'text-font': ['Noto Sans Medium'],
        'text-size': 12,
        'text-anchor': 'left',
        'text-offset': [1.1, 0],
        'text-max-width': 12,
        // The note alone is enough when there is no room for the words
        'text-optional': true
      },
      paint: {
        'text-color': SOUND_COLOR,
        'text-halo-color': 'rgba(0, 0, 0, 0.8)',
        'text-halo-width': 1.4
      }
    });

    // The clicks are handled by whoever owns the map, see `findStop()`
    [stops, latest, sounds].forEach(layer => {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    });
  }
}

/**
 * A musical note in a circle. The picture is twice as large as it is drawn
 * on the map, for the sharp screens.
 */
function drawSoundIcon() {
  const size = SOUND_ICON_SIZE * 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.scale(size / 22, size / 22);

  ctx.beginPath();
  ctx.arc(11, 11, 9.5, 0, Math.PI * 2);
  ctx.fillStyle = SOUND_COLOR;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#3a2a00';
  ctx.stroke();

  // The head of the note, its stem and its flag
  ctx.fillStyle = '#3a2a00';
  ctx.beginPath();
  ctx.ellipse(9.3, 14.6, 2.7, 2, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(11.6, 14.2);
  ctx.lineTo(11.6, 5.6);
  ctx.quadraticCurveTo(12.6, 7.8, 15.2, 8.6);
  ctx.stroke();

  return ctx.getImageData(0, 0, size, size);
}
