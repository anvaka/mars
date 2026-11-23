
import { reactive } from 'vue';

// The state is shared between vue components and the map code in main.js
const appState = reactive({
  aboutVisible: false,
  error: null,
  // When set, we stand on the surface: {longitude, latitude, heading, pitch, eyeHeight, rover}.
  // The `rover` is optional: {id, site, drive} of the stop of a rover where we stand.
  ground: null,
  // When set, the visitor makes a poster. This is what the poster starts
  // with: its description (see ./poster/posterDescription.js), which may have
  // a `feature` - the named place to start with.
  poster: null,
  // True while the visitor chooses a place on the map to stand at
  isPickingGroundPlace: false,
  // The named place whose card is shown, see ./lib/features.js
  selectedFeature: null
});

export default appState;
