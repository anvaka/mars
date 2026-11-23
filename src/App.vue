<template>
  <div class='app-container' :class='{ ridgelines: shouldDraw }'>
    <div id='map' ref='map'></div>
    <canvas class='absolute height-map' ref='heightMap'></canvas>
    <div id='app' class='absolute'>
      <search-box v-if='!shouldDraw' @select='onFeatureFound'></search-box>
      <feature-card v-if='selectedFeature && !shouldDraw' :feature='selectedFeature'
        @close='selectFeature(null)' @show='showFeature(selectedFeature)' @stand='standAtFeature(selectedFeature)'
        @photos='showPhotosOfSelected'></feature-card>

      <div class='ridgelines-panel' v-if='shouldDraw' :class='{ open: optionsOpen }'>
        <div class='header'>
          <h3>Ridgelines</h3>
          <span class='progress'>{{renderProgress && renderProgress.message}}</span>
          <a href='#' class='close' title='Back to the map' aria-label='Back to the map' @click.prevent='shouldDraw = false'>&times;</a>
        </div>
        <div class='options'>
          <div class='basic'>
            <div class='row'>
              <div class='col label'>Line density</div>
              <div class='col value'>
                <input type='range' min='1' max='100' step='1' v-model='lineDensity' aria-label='Line density'>
                <input type='number' :step='1' v-model='lineDensity' autocomplete='off' autocorrect='off' autocapitalize='off' spellcheck='false' min='1' max='100'>
              </div>
            </div>
            <div class='row'>
              <div class='col label'>Height scale</div>
              <div class='col value'>
                <input type='range' min='10' max='128' step='1' v-model='heightScale' aria-label='Height scale'>
                <input type='number' :step='1' v-model='heightScale' autocomplete='off' autocorrect='off' autocapitalize='off' spellcheck='false' min='10' max='128'>
              </div>
            </div>
          </div>
          <div class='advanced' v-if='optionsOpen'>
            <div class='row'>
              <div class='col label'>Ocean level</div>
              <div class='col value'>
                <input type='range' min='-8600' max='22000' step='1' v-model='oceanLevel' aria-label='Ocean level'>
                <input type='number' :step='1' v-model='oceanLevel' autocomplete='off' autocorrect='off' autocapitalize='off' spellcheck='false' max='22000' min='-8600'>
              </div>
            </div>
            <div class='row'>
              <div class='col label'>Smooth steps</div>
              <div class='col value'>
                <input type='range' min='1' max='12' step='1' v-model='smoothSteps' aria-label='Smooth steps'>
                <input type='number' :step='1' v-model='smoothSteps' autocomplete='off' autocorrect='off' autocapitalize='off' spellcheck='false' min='1' max='12'>
              </div>
            </div>
            <div class='row'>
              <div class='col label' title='Make the lines see-through, to print them over the map'>Lines over the map</div>
              <div class='col value'>
                <input type='range' min='1' max='100' step='1' v-model='mapOpacity' aria-label='Opacity of the lines'>
                <input type='number' :step='1' v-model='mapOpacity' autocomplete='off' autocorrect='off' autocapitalize='off' spellcheck='false' min='1' max='100'>
              </div>
            </div>
            <div class='row'>
              <div class='col label'>Line width</div>
              <div class='col value'>
                <input type='range' min='1' max='10' step='1' v-model='lineWidth' aria-label='Line width'>
                <input type='number' :step='1' v-model='lineWidth' autocomplete='off' autocorrect='off' autocapitalize='off' spellcheck='false' min='1' max='100'>
              </div>
            </div>
            <div class='row'>
              <div class='col label'>Line stroke</div>
              <div class='col'>
                <color-picker v-model='lineColor' @change='redraw'></color-picker>
              </div>
            </div>
            <div class='row'>
              <div class='col label'>Line fill</div>
              <div class='col'>
                <color-picker v-model='lineBackground' @change='redraw'></color-picker>
              </div>
            </div>
            <div class='row'>
              <div class='col label'>Background color</div>
              <div class='col'>
                <color-picker v-model='backgroundColor' @change='redraw'></color-picker>
              </div>
            </div>
          </div>
        </div>
        <div class='actions'>
          <a href='#' class='primary' :class='{ busy: generatingPreview }' @click.prevent='previewOrOpen'>
            {{generatingPreview ? 'Making the preview...' : 'Print it on a mug'}}
          </a>
          <a href='#' class='more' @click.prevent='optionsOpen = !optionsOpen'>{{optionsOpen ? 'Fewer options' : 'More options'}}</a>
        </div>
        <div v-if='zazzleLink' class='popup-help'>
          If your browser has blocked the new window, please <a :href='zazzleLink' target='_blank'>click here</a>
          to open it.
        </div>
      </div>

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

  </div>
</template>

<script>
import { defineAsyncComponent } from 'vue';
import appState from './appState.js';
import ColorPicker from './components/ColorPicker.vue';
import About from './components/About.vue';
import Elevation from './components/Elevation.vue';
import SearchBox from './components/SearchBox.vue';
import FeatureCard from './components/FeatureCard.vue';
import generateZazzleLink from './lib/getZazzleLink.js';

// Most visitors come for the map, so the ground view is loaded when asked for
const GroundView = defineAsyncComponent(() => import('./components/GroundView.vue'));

export default {
  name: 'App',
  data() {
    return appState;
  },
  components: {
    About,
    ColorPicker,
    Elevation,
    SearchBox,
    FeatureCard,
    GroundView
  },
  mounted() {
    updateSizes(this.$refs);
    this.init();
    this.onResize = () => {
      updateSizes(this.$refs);
      this.redraw();
    }
    this.onKeyDown = e => {
      if (e.key !== 'Escape') return;
      if (this.isPickingGroundPlace) this.setPickingGroundPlace(false);
      else if (this.ground || this.aboutVisible) return;
      // The card is hidden while the ridgelines are drawn
      else if (this.shouldDraw) this.shouldDraw = false;
      else if (this.selectedFeature) this.selectFeature(null);
    }

    window.addEventListener('resize', this.onResize, true);
    window.addEventListener('keydown', this.onKeyDown);
  },

  beforeUnmount() {
    window.removeEventListener('resize', this.onResize, true);
    window.removeEventListener('keydown', this.onKeyDown);
  },

  watch: {
    lineWidth() {
      this.redraw();
    },
    lineDensity() {
      this.redraw();
    },
    oceanLevel() {
      this.redraw();
    },
    heightScale() {
      this.redraw();
    },
    smoothSteps() {
      this.redraw();
    },
    mapOpacity(newValue) {
      let heightMap = this.$refs.heightMap;
      if (heightMap) {
        heightMap.style.opacity = parseFloat(newValue) / 100;
      }
    },
    shouldDraw(newValue) {
      if (!newValue) {
        this.zazzleLink = null;
        this.error = null;
      }
      this.redraw();
    },
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

    previewOrOpen() {
      if (this.generatingPreview) return;
      if (this.zazzleLink) {
        window.open(this.zazzleLink, '_blank');
        recordOpenClick(this.zazzleLink);
        return;
      }

      let heightMapCanvas = this.$refs.heightMap;
      appState.generatingPreview = true;

      let mapCanvas = appState.getMapCanvas();
      let width = mapCanvas.width;
      let height = mapCanvas.height;

      let blended = document.createElement('canvas');
      let blendedCtx = blended.getContext('2d');
      blended.width = width;
      blended.height = height;
      const globalAlpha = Number.parseFloat(appState.mapOpacity)/100;

      // The map shows through the lines when they are not solid
      if (globalAlpha < 1) {
        blendedCtx.drawImage(mapCanvas, 0, 0)
      }
      blendedCtx.globalAlpha = globalAlpha;
      blendedCtx.drawImage(heightMapCanvas, 0, 0, heightMapCanvas.width, heightMapCanvas.height, 0, 0, width, height);

      generateZazzleLink(blended).then(link => {
        appState.zazzleLink = link;
        window.open(link, '_blank');
        recordOpenClick(link);
        appState.generatingPreview = false;
      }).catch(e => {
        appState.error = e;
        appState.generatingPreview = false;
      });
    },
  }
}

function updateSizes(refs) {
  let dimensions = getCanvasDimensions();
  // The size of the map itself is set by the styles: it takes the entire
  // screen, or a corner of the ground view.
  setGuideLineSize(refs.heightMap, dimensions);
  appState.redraw();
}

function setGuideLineSize(el, dimensions) {
  if (!el) return;
  el.width = dimensions.width;
  el.height = dimensions.height;
  el.style.left = px(dimensions.left);
  el.style.top = px(dimensions.top);
  el.style.width = px(dimensions.trueWidth);
  el.style.height = px(dimensions.trueHeight);
}

function px(x) {
  return x + 'px';
}

function getCanvasDimensions() {

  return {
    width: window.innerWidth,
    height: window.innerHeight,
    left: 0,
    top: 0,
    trueWidth: window.innerWidth,
    trueHeight: window.innerHeight
  };
}

function recordOpenClick(link) {
  if (typeof gtag === 'undefined') return;

  gtag('event', 'click', {
    event_category: 'Outbound Link',
    event_label: link
  });
}
</script>

<style lang='stylus'>
border-color = #d8d8d8;
primary-action-color = #ff4081;
quiet-color = #6b7882;
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
// card of the chosen place, or the options of the ridgelines.
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
}
#map.globe {
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

// The ridgelines are drawn over the map, the buttons have to stay above them
.maplibregl-ctrl-top-right {
  z-index: 4;
}

.mode-button {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #333;
}
.ridgelines .ridgelines-button {
  color: primary-action-color;
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

.height-map {
  position: absolute;
  z-index: 3;
  pointer-events: none;
  transition: opacity 100ms ease-in-out;
}

.col {
  align-items: center;
  display: flex;
  flex: 1;
}

.row {
  margin-top: 4px;
  display: flex;
  flex-direction: row;
  height: 32px;
}

.ridgelines-panel {
  font-size: 14px;

  .header {
    display: flex;
    align-items: center;
    height: panel-row-height;
    padding: 0 8px 0 16px;
    h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }
    .progress {
      flex: 1;
      margin: 0 12px;
      font-size: 12px;
      color: quiet-color;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .close {
      width: 28px;
      height: 28px;
      line-height: 26px;
      text-align: center;
      font-size: 22px;
      color: quiet-color;
      &:hover {
        color: primary-action-color;
      }
    }
  }

  .options {
    padding: 0 16px;
    overflow-y: auto;
    // The header and the actions are always on the screen
    max-height: 'calc(100vh - %s)' % (panel-margin * 2 + panel-row-height + 100px);
    .label {
      flex: 0.7;
    }
  }

  .value {
    input[type='range'] {
      flex: 1;
      min-width: 0;
      accent-color: primary-action-color;
    }
    input[type='number'] {
      width: 58px;
      margin-left: 8px;
    }
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px 14px;
    .primary {
      padding: 6px 14px;
      border-radius: 3px;
      background: primary-action-color;
      color: white;
      &:hover {
        background: darken(primary-action-color, 8%);
      }
      &.busy {
        background: #b9c0c6;
        cursor: default;
      }
    }
  }

  .popup-help {
    padding: 0 16px 14px;
    color: quiet-color;
  }
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

  // A phone has little room, so all the options wait until asked for
  .ridgelines-panel:not(.open) .basic {
    display: none;
  }
  .ridgelines .maplibregl-ctrl-top-right {
    top: panel-margin + panel-row-height + 58px;
  }
}

@media (max-height: 360px) {
  .elevation {
    display: none;
  }
}
</style>
