import { createColorReliefExpression, getTheme } from "./lib/colorRamp.js";
import appState from "./appState.js";
import { hasPreciseElevation } from "./tiles.js";
import { NIGHT_SOURCE, SUN_SOURCE, getNightSource, getSunSource } from "./lib/dayNight.js";
import { SUN_RELIEF_SOURCE, getSunReliefSource } from "./lib/sunRelief.js";
import { MISSION_WITH_PHOTOS_ICON, ROVER_ICON, LANDER_ICON } from "./lib/missionIcons.js";

// Both the names and the fonts are served along with the website. The names
// come from tools/build_labels.py
const baseUrl = new URL(".", document.baseURI).href;
const LABELS_URL = baseUrl + "data/mars-labels.geojson";
const GLYPHS_URL = baseUrl + "fonts/{fontstack}/{range}.pbf";

export const LABELS_SOURCE = "labels";

/**
 * @param {Object} demSource - `raster-dem` source with elevation of Mars.
 * @param {String} projection - either `globe` or `mercator`
 * @see ./tiles.js
 */
export function getMarsStyle(demSource, projection) {
  return {
    version: 8,
    name: "mars",
    center: [0, 0],
    zoom: 2.64,
    bearing: 0,
    pitch: 0,
    projection: { type: projection },
    sources: {
      "mars-dem": demSource,
      [LABELS_SOURCE]: {
        type: "geojson",
        data: LABELS_URL
      },
      [NIGHT_SOURCE]: getNightSource(),
      [SELECTION_SOURCE]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      ...(hasPreciseElevation ? { [SUN_RELIEF_SOURCE]: getSunReliefSource() } : {}),
      [SUN_SOURCE]: getSunSource()
    },
    glyphs: GLYPHS_URL,
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "hsla(0, 0%, 0%, 0)" }
      },
      {
        id: "mars200m",
        type: "color-relief",
        source: "mars-dem",
        paint: {
          "color-relief-color": createColorReliefExpression(appState.theme)
        }
      },
      ...getShadingLayers(),
      getNightLayer(),
      ...getSelectionLayers(),
      ...getLabelLayers(),
      // The Sun goes last, so that its name wins when the names do not fit
      ...getSunLayers()
    ]
  };
}

/**
 * Colors tell how high a place is, but the entire palette is spread over 30
 * kilometers, so a crater that is one kilometer deep barely changes the color.
 * Shading tells where the slopes are, and that is what makes the land look
 * like land.
 *
 * There are two kinds of it, and only one is visible at a time. When the map
 * shows where the Sun is, the land is lit by that Sun. Otherwise it is lit
 * from the top left corner, the way printed maps are.
 */
function getShadingLayers() {
  if (!hasPreciseElevation) return [];

  return [{
    id: SHADING_LAYER,
    type: "hillshade",
    source: "mars-dem",
    layout: { visibility: getShadingVisibility() },
    paint: {
      // Seen from afar the planet needs strong light to show its relief.
      // The same light up close turns the steep walls of the canyons into
      // plain black and white, and the colors of elevation get lost.
      "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 2, 1, 6, 0.45],
      // Plain black and white turn the colors of the map into gray
      "hillshade-shadow-color": SHADOW_COLOR,
      "hillshade-accent-color": SHADOW_COLOR,
      "hillshade-highlight-color": HIGHLIGHT_COLOR
    }
  }, {
    id: SUN_SHADING_LAYER,
    type: "raster",
    source: SUN_RELIEF_SOURCE,
    layout: { visibility: getSunShadingVisibility() },
    paint: { "raster-fade-duration": 0 }
  }];
}

const SHADOW_COLOR = "rgb(34, 10, 4)";
// The lit slopes keep some of their own color too
const HIGHLIGHT_COLOR = "rgba(255, 232, 196, 0.5)";

export const SHADING_LAYER = "shading";
export const SUN_SHADING_LAYER = "sun-shading";

export function getShadingVisibility() {
  return isSunVisible() ? "none" : "visible";
}

export function getSunShadingVisibility() {
  return isSunVisible() ? "visible" : "none";
}

/**
 * The half of Mars where it is night right now is shaded, and there is a dot
 * where the Sun is right overhead. Both show up only on the globe: the flat
 * map is the one that gets printed, and it should stay clean.
 */
function getNightLayer() {
  return {
    id: "night",
    type: "raster",
    source: NIGHT_SOURCE,
    layout: { visibility: getDayNightVisibility() },
    paint: {
      "raster-fade-duration": 0,
      "raster-resampling": "linear"
    }
  };
}

function getSunLayers() {
  const visibility = getDayNightVisibility();
  return [
    {
      id: "sun",
      type: "circle",
      source: SUN_SOURCE,
      layout: { visibility },
      paint: {
        "circle-radius": 7,
        "circle-color": "#ffd95a",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
        "circle-blur": 0.1
      }
    },
    {
      id: "sun-label",
      type: "symbol",
      source: SUN_SOURCE,
      layout: {
        visibility,
        "text-field": "The Sun is overhead",
        "text-font": ["Noto Sans Italic"],
        "text-size": 11,
        "text-anchor": "top",
        "text-offset": [0, 0.9],
        "text-optional": true
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "rgba(0, 0, 0, 0.7)",
        "text-halo-width": 1.2
      }
    }
  ];
}

export const DAY_NIGHT_LAYERS = ["night", "sun", "sun-label"];

export const SELECTION_SOURCE = "selection";
export const SELECTION_LAYERS = ["selection-shade", "selection-outline", "selection-point"];

/**
 * Layers of the names that can be clicked
 */
export const MISSIONS_LAYER = "missions";
export const CLICKABLE_LAYERS = ["feature-labels", MISSIONS_LAYER];
// A landmark is set this many pixels larger than its neighbors, and the
// neighbors are this transparent
const LANDMARK_SIZE_GAIN = 2;
const OPACITY_OF_QUIET_NAMES = 0.7;
// Closer than this a mission also tells what it is, and when it has landed
const MIN_ZOOM_OF_MISSION_DETAILS = 3;

/**
 * The feature that the visitor has chosen gets a line around it, to show how
 * large it is. Those that have no known outline get a ring in the middle.
 */
function getSelectionLayers() {
  const isLine = ["==", ["geometry-type"], "LineString"];
  const round = { "line-cap": "round", "line-join": "round" };

  return [
    {
      // A soft dark line under the white one keeps it visible on any color
      id: "selection-shade",
      type: "line",
      source: SELECTION_SOURCE,
      filter: isLine,
      layout: round,
      paint: { "line-color": "rgba(0, 0, 0, 0.5)", "line-width": 4.5, "line-blur": 2 }
    },
    {
      id: "selection-outline",
      type: "line",
      source: SELECTION_SOURCE,
      filter: isLine,
      layout: round,
      paint: { "line-color": "#ffffff", "line-width": 1.6, "line-dasharray": [0.2, 2.6] }
    },
    {
      id: "selection-point",
      type: "circle",
      source: SELECTION_SOURCE,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 9,
        "circle-color": "rgba(255, 255, 255, 0.15)",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff"
      }
    }
  ];
}

export function getDayNightVisibility() {
  return isSunVisible() ? "visible" : "none";
}

function isSunVisible() {
  // The small map of the ground view is there to show the way: it would be
  // of no use in the dark.
  return !appState.ground;
}

/**
 * Colors of the label layers depend on the current theme. This gives a list of
 * `[layerId, paintProperty, value]` to apply when the theme changes.
 */
export function getLabelColors(themeName) {
  const theme = getTheme(themeName);
  const colors = [];
  getLabelLayers().forEach(layer => {
    if (layer.type === "symbol") {
      colors.push([layer.id, "text-color", theme.labelColor]);
      colors.push([layer.id, "text-halo-color", theme.haloColor]);
    } else {
      colors.push([layer.id, "circle-color", theme.labelColor]);
      colors.push([layer.id, "circle-stroke-color", theme.haloColor]);
    }
  });
  return colors;
}

function getLabelLayers() {
  const theme = getTheme(appState.theme);
  const featureClass = ["get", "class"];
  // The rovers whose photos we can show, see tools/build_labels.py
  const hasPhotos = ["has", "rover"];
  // The names that people look for
  const isLandmark = ["has", "landmark"];
  const landmarkGain = ["case", isLandmark, LANDMARK_SIZE_GAIN, 0];

  return [
    {
      // All the names live in one layer, so that when two of them do not fit
      // together the more important one stays, no matter what kind it is.
      id: "feature-labels",
      type: "symbol",
      source: LABELS_SOURCE,
      // A name appears when its feature is large enough on the screen, and
      // regions hide when we are deep inside of them. See tools/build_labels.py
      filter: [
        "all",
        ["!=", featureClass, "landing"],
        ["<=", ["get", "minzoom"], ["zoom"]],
        [">=", ["coalesce", ["get", "maxzoom"], 24], ["zoom"]]
      ],
      layout: {
        "text-field": ["get", "name"],
        "symbol-sort-key": ["-", ["get", "rank"]],
        "text-padding": 4,
        // Regions are spelled in capitals. Valleys and canyons are set in
        // italic, the way rivers are on the maps of Earth. A landmark is
        // set in a heavier type, unless it is italic: that font has one weight.
        "text-font": [
          "match", featureClass,
          "region", ["literal", ["Noto Sans Medium"]],
          ["valley", "landform"], ["literal", ["Noto Sans Italic"]],
          ["case", isLandmark, ["literal", ["Noto Sans Medium"]], ["literal", ["Noto Sans Regular"]]]
        ],
        "text-transform": ["match", featureClass, "region", "uppercase", "none"],
        "text-letter-spacing": ["match", featureClass, "region", 0.2, "valley", 0.05, 0],
        "text-max-width": ["match", featureClass, "region", 7, 8],
        "text-size": [
          "interpolate", ["linear"], ["zoom"],
          1, ["+", ["match", featureClass, "region", 11, "mountain", 12, "valley", 11, 10.5], landmarkGain],
          8, ["+", ["match", featureClass, "region", 18, "mountain", 15, "valley", 14, 13], landmarkGain]
        ]
      },
      paint: {
        ...getTextPaint(),
        // The names that few have heard of step back, and the landmarks are
        // seen first. See LANDMARK_READERS in tools/build_labels.py
        "text-opacity": ["case", isLandmark, 1, OPACITY_OF_QUIET_NAMES]
      }
    },
    {
      // The missions are the places where a visitor has the most to see, so
      // they do not look like the names: each is a badge, and its name is
      // set in a heavier type. The badge is always drawn, and the names of
      // the land give way to it. See ./lib/missionIcons.js
      id: MISSIONS_LAYER,
      type: "symbol",
      source: LABELS_SOURCE,
      filter: ["==", featureClass, "landing"],
      layout: {
        "icon-image": [
          "case",
          hasPhotos, MISSION_WITH_PHOTOS_ICON,
          ["==", ["get", "kind"], "rover"], ROVER_ICON,
          LANDER_ICON
        ],
        "icon-allow-overlap": true,
        // The rovers with photos go on top of their neighbors
        "symbol-sort-key": ["case", hasPhotos, 0, 1],
        "symbol-z-order": "source",
        // From afar a name is enough. Closer we also tell what it is: "rover · 2012"
        "text-field": [
          "step", ["zoom"],
          ["get", "name"],
          MIN_ZOOM_OF_MISSION_DETAILS, [
            "format",
            ["get", "name"], {},
            "\n", {},
            ["concat", ["get", "kind"], " · ", ["to-string", ["get", "year"]]],
            { "font-scale": 0.8, "text-font": ["literal", ["Noto Sans Regular"]] }
          ]
        ],
        "text-font": ["Noto Sans Medium"],
        "text-size": ["case", hasPhotos, 14, 12],
        "text-line-height": 1.25,
        "text-anchor": "top",
        "text-offset": ["case", hasPhotos, ["literal", [0, 1.05]], ["literal", [0, 0.95]]],
        // Two missions may be too close for both names. The badges stay anyway.
        "text-optional": true
      },
      paint: getTextPaint()
    }
  ];
}

function getTextPaint() {
  const theme = getTheme(appState.theme);
  return {
    "text-color": theme.labelColor,
    "text-halo-color": theme.haloColor,
    "text-halo-width": 1.2,
    "text-halo-blur": 0.5
  };
}
