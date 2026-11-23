<template>
  <div class='app-container'>
    <div id='map' ref='map'></div>
    <div id='app' class='absolute'>
      <search-box @select='onFeatureFound'></search-box>
      <feature-card v-if='selectedFeature' :feature='selectedFeature'
        @close='selectFeature(null)' @show='showFeature(selectedFeature)' @stand='standAtFeature(selectedFeature)'
        @photos='showPhotosOfSelected' @poster='openPoster("place", selectedFeature)'></feature-card>

      <div class='error padded' v-if='error'>
        <h5>Error occurred:</h5>
        <pre>{{error}}</pre>
      </div>
    </div>

    <elevation></elevation>
    <div class='about-line'>
      <a href='#' @click.prevent='aboutVisible = true' class='map-text'>about website</a>
    </div>

    <about v-if='aboutVisible' @close='aboutVisible = false'></about>

    <div class='pick-hint' v-if='isPickingGroundPlace && !ground'>
      Click a place on the map to stand there.
      <a href='#' @click.prevent='setPickingGroundPlace(false)'>cancel</a>
    </div>
    <ground-view v-if='ground' :start='ground' :theme='theme' @close='closeGroundView' @change='saveGroundView'></ground-view>
    <poster-view v-if='poster' :start='poster' :theme='theme' @close='closePoster'></poster-view>

  </div>
</template>

<script>
import { defineAsyncComponent } from 'vue';
import appState from './appState.js';
import About from './components/About.vue';
import Elevation from './components/Elevation.vue';
import SearchBox from './components/SearchBox.vue';
import FeatureCard from './components/FeatureCard.vue';

// Most visitors come for the map, so the ground view is loaded when asked for
const GroundView = defineAsyncComponent(() => import('./components/GroundView.vue'));
const PosterView = defineAsyncComponent(() => import('./components/PosterView.vue'));

export default {
  name: 'App',
  data() {
    return appState;
  },
  components: {
    About,
    Elevation,
    SearchBox,
    FeatureCard,
    GroundView,
    PosterView
  },
  mounted() {
    this.init();
    this.onKeyDown = e => {
      if (e.key !== 'Escape') return;
      if (this.poster) this.closePoster();
      else if (this.isPickingGroundPlace) this.setPickingGroundPlace(false);
      else if (this.ground || this.aboutVisible) return;
      else if (this.selectedFeature) this.selectFeature(null);
    }

    window.addEventListener('keydown', this.onKeyDown);
  },

  beforeUnmount() {
    window.removeEventListener('keydown', this.onKeyDown);
  },

  methods: {
    showPhotosOfSelected(done) {
      // If the route of the rover cannot be loaded, the card stays as it was
      this.showRoverPhotos(this.selectedFeature).catch(e => console.error(e)).then(done);
    },

    onFeatureFound(feature) {
      this.selectFeature(feature);
      this.showFeature(feature);
    },
  }
}
</script>

<style lang='stylus'>
border-color = #d8d8d8;
primary-action-color = #ff4081;
small-screen = 700px;
// Room between the panel and the edges of the screen
panel-margin = 10px;
panel-row-height = 42px;

.app-container {
  font-family: 'Avenir', Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: #2c3e50;
}

// The panel floats over the corner of the map. It holds the search and the
// card of the chosen place.
#app {
  left: panel-margin;
  top: panel-margin;
  width: 380px;
  background: white;
  z-index: 4;
  border-radius: 8px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, .35);
  max-height: 'calc(100vh - %s)' % (panel-margin * 2);
  overflow: hidden;

  .search-box + * {
    border-top: 1px solid border-color;
  }
}
h3 {
  margin: 12px 0;
}

#map {
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  // The sky around the globe
  background: #08080c;
}

// While we stand on the surface, the map is a small window in the corner of
// the ground view, see ./lib/miniMap.js
mini-map-margin = 10px;
#map.mini {
  position: fixed;
  left: mini-map-margin;
  top: auto;
  bottom: mini-map-margin;
  width: 240px;
  height: 180px;
  // above the ground view
  z-index: 11;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 6px rgba(0, 0, 0, .5), 0 0 0 2px rgba(255, 255, 255, .85);

  .maplibregl-ctrl-top-right, .maplibregl-ctrl-bottom-left {
    display: none;
  }
  .maplibregl-canvas-container {
    cursor: pointer;
  }
}
#map.mini.expanded {
  // The panels of the ground view keep their places: the options above the
  // map, and the stop of the rover to the right of it.
  width: 'min(620px, max(240px, calc(100vw - %s)))' % (mini-map-margin * 2 + 320px);
  height: 'min(460px, max(180px, calc(100vh - %s)))' % (mini-map-margin * 2 + 350px);

  // The zoom buttons come back, below the button that makes the map small
  .maplibregl-ctrl-top-right {
    display: block;
    top: 36px;
    .maplibregl-ctrl {
      margin: 8px 8px 0 0;
    }
    .modes-control {
      display: none;
    }
  }
}
.mini-map-expand {
  display: none;
  position: absolute;
  right: 8px;
  top: 8px;
  z-index: 5;
  width: 29px;
  height: 29px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: white;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, .1);
  color: #333;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  &:hover {
    color: primary-action-color;
  }
}
#map.mini .mini-map-expand {
  display: flex;
}
.mini-map-marker {
  // Clicks go to the map under the marker
  pointer-events: none;
  svg {
    display: block;
  }
}

#map.picking-ground-place {
  .maplibregl-canvas-container {
    cursor: crosshair;
  }
  .ground-view-button {
    color: primary-action-color;
  }
}

.mode-button {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #333;
}
.pick-hint {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  padding: 8px 14px;
  background: white;
  border-radius: 4px;
  box-shadow: 0 0 10px rgba(0, 0, 0, .3);
  font-size: 14px;
  z-index: 4;
  white-space: nowrap;
}

.padded {
  padding: 12px;
}

a {
  color: primary-action-color;
  text-decoration: none;
}
.error pre {
  overflow-x: auto;
}

.elevation {
  display: block;
  position: fixed;
  bottom: 42px;
  right: 10px;
  text-align: right;
  cursor: pointer;
}

.about-line {
  position: fixed

  bottom: 8px;
  right: 10px;
  font-size: 14px;
  a {
    color: white;
    font-size: 16px;
    padding: 0 4px;
  }
}
.map-text {
  text-shadow: -1px 0 #333, 0 1px #333, 1px 0 #333, 0 -1px #333;
}

@media (max-width: small-screen) {
  #app {
    width: auto;
    right: panel-margin;
  }
  .maplibregl-ctrl-top-right {
    // below the panel with the search
    top: panel-margin + panel-row-height;
  }

  #map.mini {
    width: 130px;
    height: 110px;
  }
  #map.mini.expanded {
    width: 'calc(100vw - %s)' % (mini-map-margin * 2);
    height: 45vh;
  }
}

@media (max-height: 360px) {
  .elevation {
    display: none;
  }
}
</style>
