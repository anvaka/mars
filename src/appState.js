
import { reactive } from 'vue';

// The state is shared between vue components and the map code in main.js
const appState = reactive({
  autoHeightMap: true,
  currentState: 'intro',
  lineDensity: 28,
  lineWidth: 1,
  smoothSteps: 1,
  mapOpacity: 100,
  heightScale: 42,
  oceanLevel: 0,
  aboutVisible: false,
  blank: false,
  error: null,
  zazzleLink: null,
  startOver,
  generatingPreview: false,
  // True while the map is drawn as ridgelines, to be printed
  shouldDraw: false,
  // The ridgelines have many options, most of them wait until asked for
  optionsOpen: false,
  // When set, we stand on the surface: {longitude, latitude, heading, pitch, eyeHeight, rover}.
  // The `rover` is optional: {id, site, drive} of the stop of a rover where we stand.
  ground: null,
  // True while the visitor chooses a place on the map to stand at
  isPickingGroundPlace: false,
  // The named place whose card is shown, see ./lib/features.js
  selectedFeature: null,
  renderProgress: null,
  width: window.innerWidth,
  height: window.innerHeight,

  backgroundColor: {
    r: 255, g: 255, b: 255, a: 1
  },
  lineBackground: {
    r: 255, g: 255, b: 255, a: 1
  },
  lineColor: {
    r: 22, g: 22, b: 22, a: 0.85
  },
});

function startOver() {
  appState.zazzleLink = null;
  appState.generatingPreview = false;
  appState.currentState = 'intro';
  appState.blank = false;
}

export default appState;