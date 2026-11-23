<template>
  <a class='elevation' href='#' title='Change the colors of the map' @click.prevent='toggleTheme'>
    <div class='map-text header'>Elevation</div>
    <div class='canvas-container'>
      <div class='labels'>
        <div v-for="(label, index) in computedLabels" :key="index" class='map-text' :style='label.style'>{{label.title}}</div>
      </div>
      <canvas class='elevation-legend' ref='elevation'></canvas>
    </div>
  </a>
</template>
<script>
import { getColorStops } from '../lib/colorRamp.js';
import appState from '../appState.js';

// Range of the legend, in kilometers
const LEGEND_FROM = -9;
const LEGEND_TO = 21;
const LEGEND_STEPS = 5;
const LEGEND_HEIGHT = 160;

export default {
  name: 'Elevation',
  data() {
    return appState;
  },
  watch: {
    theme() {
      this.updateCanvas();
    }
  },
  computed: {
      computedLabels() {
        return getLabelsOffsets(LEGEND_HEIGHT);
      }
  },
  mounted() {
    this.updateCanvas();
  },
  methods: {
    toggleTheme() {
      appState.setNextTheme();
    },
    updateCanvas() {
      let canvas = this.$refs.elevation;
      let ctx = canvas.getContext('2d');
      let width = canvas.width = 22;
      let height = canvas.height = LEGEND_HEIGHT;

      // The legend uses the same color stops as the map does. Highest
      // elevation is at the top:
      let gradient = ctx.createLinearGradient(0, 0, 0, height);
      getColorStops(appState.theme).forEach(stop => {
        let offset = (LEGEND_TO - stop.elevation / 1000) / (LEGEND_TO - LEGEND_FROM);
        gradient.addColorStop(Math.max(0, Math.min(1, offset)), stop.color);
      });

      let dx = 8;
      ctx.fillStyle = gradient;
      ctx.fillRect(dx, 0, width - dx, height);

      ctx.fillStyle = 'black';
      for (let i = 0; i <= LEGEND_STEPS; ++i) {
        let offset = Math.round((i / LEGEND_STEPS) * height);
        ctx.fillRect(2, offset - (i === 0 ? 0 : 1), width, 1);
      }

      ctx.lineWidth = 1;
      ctx.strokeRect(dx, 0, width - dx, height)
    }
  }
}

function getLabelsOffsets(height) {
  const halfFontSize = 8;
  let dx = (LEGEND_TO - LEGEND_FROM) / LEGEND_STEPS;
  let labels = [];
  for (let i = 0; i <= LEGEND_STEPS; ++i) {
    labels.push({
      style: {
        top: (height * (i / LEGEND_STEPS) - halfFontSize) + 'px'
      },
      title: `${LEGEND_TO - i * dx}km`
    });
  }

  return labels;
}

</script>
<style lang="stylus">
.elevation .map-text {
  color: #fff;
  font-size: 10px;
}
.map-text.header {
  padding-bottom: 12px;
  font-size: 16px;
}
.labels {
  position: absolute;
  right: 26px;
  .map-text {
    position: absolute;
    right: 0px;
  }
}
.canvas-container {
  position: relative;
}

.elevation-legend {
}

</style>