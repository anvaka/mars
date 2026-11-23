/**
 * This is the website startup point.
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import { Map as MapLibreMap, NavigationControl, AttributionControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import createState from 'query-state';
import appState from './appState.js';
import themes from './lib/themes.js';
import createHeightMapRenderer from './lib/createHeightMapRenderer.js';
import { createColorReliefExpression } from './lib/colorRamp.js';
import {
  getMarsStyle, getLabelColors,
  getDayNightVisibility, DAY_NIGHT_LAYERS, getShadingVisibility, SHADING_LAYER,
  getSunShadingVisibility, SUN_SHADING_LAYER,
  SELECTION_SOURCE, SELECTION_LAYERS, CLICKABLE_LAYERS, getSelectionVisibility
} from './getMarsStyle.js';
import { updateDayNight } from './lib/dayNight.js';
import { updateSunRelief } from './lib/sunRelief.js';
import { findFeature, getOutline, getBounds } from './lib/features.js';
import { showRoversOnMap } from './lib/roverLayers.js';
import { loadRover } from './lib/rovers.js';
import { provideMissionIcons } from './lib/missionIcons.js';
import createMiniMap from './lib/miniMap.js';
import { loadDemSource } from './tiles.js';

// maplibre looks for its worker next to its own file, which is not there once
// the code is bundled.
setWorkerUrl(workerUrl);

// The colors that go best with the light and shadow on the slopes
const DEFAULT_THEME = 'OCHRE';
let themeNames = Object.keys(themes);
let themeIndex = 0;
let queryState = createState({
  theme: DEFAULT_THEME
}, {
  useSearch: true
})

mergeStateFromQueryState();
augmentAppStateWithMethods();

// Load vue asyncronously
import('./vueApp.js');

// Hold a reference to maplibre instance.
let map;

let heightMapRenderer;
// The map in the corner of the ground view, see ./lib/miniMap.js
let miniMap;
// Routes of the rovers on the map, see ./lib/roverLayers.js
let rovers;
let isStyleReady = false;
// A stop of a rover is a small dot, so a click may miss it by this many
// pixels. On the small map of the ground view the dots are the way to move,
// and they get more room.
const STOP_REACH = 6;
const STOP_REACH_ON_SMALL_MAP = 14;
let currentProjection;
let pendingGroundViewSave;
// Ground view is kept in the address bar as "latitude_longitude_heading_pitch_height"
const GROUND_VIEW_SEPARATOR = '_';

function mergeStateFromQueryState() {
  const themeName = queryState.get('theme');
  themeIndex = themeNames.findIndex(x => x === themeName);
  if (themeIndex < 0) themeIndex = themeNames.indexOf(DEFAULT_THEME);
  appState.theme = themeNames[themeIndex];
}

function augmentAppStateWithMethods() {
  // Let the vue know what to call to start the app.
  appState.init = init;
  appState.redraw = updateHeights;
  appState.setNextTheme = setNextTheme;
  appState.getMapCanvas = getMapCanvas;
  appState.setPickingGroundPlace = setPickingGroundPlace;
  appState.selectFeature = selectFeature;
  appState.showFeature = showFeature;
  appState.standAtFeature = standAtFeature;
  appState.showRoverPhotos = showRoverPhotos;
  appState.saveGroundView = saveGroundView;
  appState.closeGroundView = closeGroundView;
}

function init() {
  loadDemSource().then(createMap).catch(e => {
    console.error(e);
    appState.error = e.message || String(e);
  });
}

function createMap(demSource) {
  currentProjection = getDesiredProjection();
  // A link may lead straight to a place on the surface. The style of the map
  // depends on it, so we have to know before the map is made.
  appState.ground = parseGroundView(queryState.get('ground'), queryState.get('rover'));

  window.map = map = new MapLibreMap({
    trackResize: true,
    container: "map",
    minZoom: 1,
    style: getMarsStyle(demSource, currentProjection),
    center: [-92.880, 18.79],
    zoom: 2.64,
    hash: true,
    // Default position is taken by the elevation legend
    attributionControl: false
  });

  provideMissionIcons(map);
  map.addControl(new NavigationControl({ showCompass: false }), "top-right");
  map.addControl(createModesControl(), "top-right");
  map.addControl(new AttributionControl({ compact: true }), "bottom-left");

  map.on("zoomstart", hideHeights);
  map.on("zoomend", updateHeights);
  map.on("dragstart", hideHeights);
  map.on("dragend", updateHeights);
  map.on("load", function() {
    isStyleReady = true;
    updateHeights();
    updateDayNightVisibility();
    rovers = showRoversOnMap(map);
    // A link may lead to a named place:
    const featureId = queryState.get('feature');
    if (featureId) findFeature(featureId).then(feature => feature && selectFeature(feature)).catch(logError);
  });
  // The Sun moves a quarter of a degree per minute
  setInterval(() => {
    updateDayNight(map);
    updateSunRelief(map);
  }, 60000);

  map.on("click", function(e) {
    // A stop of a rover is where its photos are, so it wins over everything else
    const found = rovers && rovers.findStop(e.point, appState.ground ? STOP_REACH_ON_SMALL_MAP : STOP_REACH);
    if (found) openRoverStop(found.rover, found.stop);
    // The map in the corner of the ground view moves us where it is clicked
    else if (appState.ground) moveGroundView(e.lngLat.wrap());
    else if (appState.isPickingGroundPlace) openGroundView(e.lngLat.wrap());
    // The ridgelines are for making a print, the cards are hidden there
    else if (!appState.shouldDraw) selectFeatureAt(e.point);
  });
  CLICKABLE_LAYERS.forEach(layer => {
    map.on("mouseenter", layer, () => setMapCursor("pointer"));
    map.on("mouseleave", layer, () => setMapCursor(""));
  });

  // Lines of the height map are drawn for the flat map that looks north:
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  map.touchPitch.disable();
  map.keyboard.disableRotation();

  updateGlobeBackground();

  miniMap = createMiniMap(map);
  if (appState.ground) miniMap.open(appState.ground);
}

const GROUND_VIEW_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
  <circle cx="12" cy="5" r="3"/>
  <path d="M7.5 10.5 Q7.5 9 9 9 L15 9 Q16.5 9 16.5 10.5 L16.5 15 L14.6 15 L14.6 22 L9.4 22 L9.4 15 L7.5 15 Z"/>
</svg>`;
// Three ridges, one behind the other
const RIDGELINES_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 9 L8 9 L10.5 4.5 L13 9 L21 9"/>
  <path d="M3 14.5 L9 14.5 L12.5 8.5 L15.5 14.5 L21 14.5"/>
  <path d="M3 20 L6 20 L9 15.5 L12 20 L21 20"/>
</svg>`;

/**
 * Buttons on the map that change what we look at: one lets the visitor
 * choose a place to stand at, the other draws the map as ridgelines.
 */
function createModesControl() {
  let container;

  return {
    onAdd() {
      container = document.createElement('div');
      container.className = 'maplibregl-ctrl maplibregl-ctrl-group modes-control';

      container.appendChild(createModeButton('ground-view-button', 'Stand on the surface', GROUND_VIEW_ICON,
        () => setPickingGroundPlace(!appState.isPickingGroundPlace)));
      container.appendChild(createModeButton('ridgelines-button', 'Draw this view as ridgelines, to print it',
        RIDGELINES_ICON, () => setRidgelinesVisible(!appState.shouldDraw)));
      return container;
    },

    onRemove() {
      container.remove();
    }
  };
}

function createModeButton(className, title, icon, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mode-button ' + className;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.innerHTML = icon;
  button.addEventListener('click', onClick);
  return button;
}

function setRidgelinesVisible(isVisible) {
  // The print is made of what is on the screen, not of a place to stand at
  if (isVisible) setPickingGroundPlace(false);
  appState.shouldDraw = isVisible;
}

function setMapCursor(cursor) {
  // While the visitor chooses where to stand, any place can be clicked. And
  // the names cannot be clicked on the small map of the ground view.
  const canClick = !appState.isPickingGroundPlace && !appState.shouldDraw && !appState.ground;
  map.getCanvas().style.cursor = canClick ? cursor : "";
}

/**
 * Shows the card of the named place under the given point of the screen.
 */
function selectFeatureAt(point) {
  // A finger is not as precise as a mouse, so the names get some room around
  const reach = 6;
  const area = [[point.x - reach, point.y - reach], [point.x + reach, point.y + reach]];
  const found = map.queryRenderedFeatures(area);
  if (!found.length) return;

  const top = found[0];
  if (!CLICKABLE_LAYERS.includes(top.layer.id)) return;

  findFeature(top.properties.id).then(feature => feature && selectFeature(feature)).catch(logError);
}

/**
 * Shows the card of a named place (see ./lib/features.js), and draws a line
 * around the place. Pass nothing to hide both.
 */
function selectFeature(feature) {
  appState.selectedFeature = feature || null;
  if (feature) {
    queryState.set('feature', feature.id);
  } else {
    queryState.unset('feature');
  }

  const source = map && map.getSource(SELECTION_SOURCE);
  if (source) source.setData(getSelectionData(feature));
}

function getSelectionData(feature) {
  const features = [];
  if (feature) {
    const outline = getOutline(feature);
    features.push({
      type: 'Feature',
      properties: {},
      geometry: outline ? { type: 'LineString', coordinates: outline } :
        { type: 'Point', coordinates: [feature.lon, feature.lat] }
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Moves the map so that the entire feature is visible.
 */
function showFeature(feature) {
  if (!map) return;

  // The panel with the card covers a part of the map: the left side of a wide
  // screen, and the top of a narrow one.
  const panel = document.querySelector('#app').getBoundingClientRect();
  const isWide = window.innerWidth > 700;
  const padding = isWide ?
    { top: 60, bottom: 60, left: panel.right + 40, right: 80 } :
    { top: Math.min(panel.bottom, window.innerHeight / 2) + 30, bottom: 40, left: 30, right: 30 };
  const bounds = getBounds(feature);
  if (bounds) {
    map.fitBounds(bounds, { padding, maxZoom: 9, duration: 1500 });
  } else {
    // Either the size is not known, or the feature goes around the planet
    const zoom = feature.class === 'landing' ? 8 : feature.size ? 2 : 4;
    map.flyTo({ center: [feature.lon, feature.lat], zoom, padding, duration: 1500 });
  }
}

function standAtFeature(feature) {
  openGroundView({ lng: feature.lon, lat: feature.lat });
}

/**
 * Takes the visitor to the rover of the given mission (a feature that has
 * `rover`), to see its photos. It is the place where the rover is now, or
 * where it has stayed forever. Resolves when the visitor is there.
 */
function showRoverPhotos(feature) {
  return loadRover(feature.rover).then(rover => {
    openRoverStop(rover, rover.stops[rover.stops.length - 1]);
  });
}

function logError(e) {
  console.error(e);
}

function setPickingGroundPlace(isPicking) {
  appState.isPickingGroundPlace = isPicking;
  if (map) map.getContainer().classList.toggle('picking-ground-place', isPicking);
}

function openGroundView(lngLat) {
  showGround({
    longitude: lngLat.lng,
    latitude: lngLat.lat,
    heading: 0,
    pitch: 0,
    eyeHeight: 2
  });
}

/**
 * Moves the visitor who already stands on the surface to another place.
 */
function moveGroundView(lngLat) {
  showGround({ ...appState.ground, longitude: lngLat.lng, latitude: lngLat.lat, rover: null });
}

/**
 * Opens the ground view, or moves it if it is open. The `ground` is
 * described in ./appState.js
 */
function showGround(ground) {
  const wasOpen = !!appState.ground;
  setPickingGroundPlace(false);
  // The ridgelines are made of what is on the screen, and it is not the map anymore
  appState.shouldDraw = false;
  // The ground view watches this value, and moves when it is replaced
  appState.ground = ground;
  if (wasOpen) return;

  miniMap.open(ground);
  updateDayNightVisibility();
}

/**
 * Opens the ground view at the place where a rover has stopped. See
 * ./lib/rovers.js for the description of the arguments.
 */
function openRoverStop(rover, stop) {
  showGround({
    longitude: stop.longitude,
    latitude: stop.latitude,
    // We look where the rover looks, a bit down, where its tracks are
    heading: stop.heading,
    pitch: -8,
    eyeHeight: 2,
    rover: { id: rover.id, site: stop.site, drive: stop.drive }
  });
}

/**
 * Remembers the ground view in the address bar, so that it can be shared.
 * The `view` is the state of the ground scene.
 */
function saveGroundView(view) {
  if (miniMap) miniMap.update(view);
  clearTimeout(pendingGroundViewSave);
  pendingGroundViewSave = setTimeout(() => {
    if (!appState.ground) return;
    queryState.set('ground', [
      view.latitude.toFixed(4),
      view.longitude.toFixed(4),
      view.heading.toFixed(1),
      view.pitch.toFixed(1),
      Math.round(view.eyeHeight)
    ].join(GROUND_VIEW_SEPARATOR));

    const rover = view.rover;
    if (rover) queryState.set('rover', [rover.id, rover.site, rover.drive].join(GROUND_VIEW_SEPARATOR));
    else queryState.unset('rover');
  }, 300);
}

function parseGroundView(value, roverValue) {
  if (!value) return null;
  const [latitude, longitude, heading, pitch, eyeHeight] = String(value)
    .split(GROUND_VIEW_SEPARATOR).map(Number.parseFloat);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  // "M20_49_370" is the stop of a rover: its name, site and drive
  let rover = null;
  const [id, site, drive] = String(roverValue || '').split(GROUND_VIEW_SEPARATOR);
  if (id && Number.isFinite(Number.parseInt(site, 10)) && Number.isFinite(Number.parseInt(drive, 10))) {
    rover = { id, site: Number.parseInt(site, 10), drive: Number.parseInt(drive, 10) };
  }

  return { longitude, latitude, heading, pitch, eyeHeight, rover };
}

function closeGroundView(view) {
  clearTimeout(pendingGroundViewSave);
  appState.ground = null;
  queryState.unset('ground');
  queryState.unset('rover');

  if (miniMap) miniMap.close(view);
  updateDayNightVisibility();
}

function setNextTheme() {
  themeIndex += 1;
  themeIndex = themeIndex % themeNames.length;
  setThemeName(themeNames[themeIndex]);
}

function setThemeName(name) {
  themeIndex = themeNames.findIndex(x => x === name);
  if (themeIndex < 0) return;

  appState.theme = name;
  queryState.set('theme', appState.theme);
  if (map) {
    map.setPaintProperty('mars200m', 'color-relief-color', createColorReliefExpression(appState.theme));
    updateCurrentLabelColors();
  }
}

function updateCurrentLabelColors() {
  getLabelColors(appState.theme).forEach(([layerId, property, value]) => {
    map.setPaintProperty(layerId, property, value);
  });
}

function setShadingLayersVisibility(shading, sunShading) {
  if (!map.getLayer(SHADING_LAYER)) return;
  map.setLayoutProperty(SHADING_LAYER, 'visibility', shading);
  map.setLayoutProperty(SUN_SHADING_LAYER, 'visibility', sunShading);
}

function updateDayNightVisibility() {
  if (!map || !isStyleReady) return;
  setDayNightLayersVisibility(getDayNightVisibility());
  // When there is no Sun on the map, the land is lit from the top left corner
  setShadingLayersVisibility(getShadingVisibility(), getSunShadingVisibility());
}

function setDayNightLayersVisibility(visibility) {
  DAY_NIGHT_LAYERS.forEach(layerId => map.setLayoutProperty(layerId, 'visibility', visibility));
}

function getDesiredProjection() {
  // Mars is a globe: a sphere when zoomed out, that flattens as we zoom in.
  // The height map lines are computed for the flat map only, so they get one.
  return appState.shouldDraw ? 'mercator' : 'globe';
}

/**
 * Makes sure the map uses projection that matches the app state. Returns true
 * if projection was changed.
 */
function updateProjection() {
  if (!map) return false;

  const projection = getDesiredProjection();
  if (projection === currentProjection) return false;

  currentProjection = projection;
  map.setProjection({ type: projection });
  updateGlobeBackground();
  updateDayNightVisibility();
  SELECTION_LAYERS.forEach(layerId => map.setLayoutProperty(layerId, 'visibility', getSelectionVisibility()));
  return true;
}

function updateGlobeBackground() {
  map.getContainer().classList.toggle('globe', currentProjection === 'globe');
}

/**
 * Returns canvas with the current frame of the map, ready to be copied.
 */
function getMapCanvas() {
  // WebGL drops the frame once it is presented, so we have to draw a new one
  // right before the canvas is read.
  map.redraw();
  return map.getCanvas();
}

function hideHeights() {
  appState.zazzleLink = null;
  let canvas = document.querySelector(".height-map");
  if (canvas) canvas.style.opacity = 0.02;
}

function updateHeights() {
  if (!map) return;

  let heightMapCanvas = document.querySelector(".height-map");
  if (!heightMapCanvas) return;

  map.resize();
  updateProjection();

  if (!appState.shouldDraw) {
    heightMapCanvas.style.display = "none";
    return;
  } else {
    heightMapCanvas.style.display = "";
  }

  if (heightMapRenderer) {
    heightMapRenderer.cancel();
  }

  heightMapRenderer = createHeightMapRenderer(appState, map, heightMapCanvas);
  heightMapRenderer.render();
}
