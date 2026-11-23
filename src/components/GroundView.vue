<template>
  <div class='ground-view'>
    <canvas ref='canvas' class='ground-canvas' :class='{gray: isGray}'></canvas>
    <div ref='photos' class='ground-photos' v-show='photosAreVisible'></div>

    <svg class='ground-arrows' v-if='stopArrows.length' viewBox='-1 -1 2 2' preserveAspectRatio='none'>
      <g v-for='arrow in stopArrows' :key='arrow.index' class='arrow' :class='{back: arrow.isBack}' @click='goToStop(arrow.index)'>
        <title>{{arrow.title}}</title>
        <polygon class='hit' :points='arrow.outline' />
        <polygon :points='arrow.points' />
      </g>
    </svg>

    <div class='ground-compass'>
      <div v-for='mark in compassMarks' :key='mark.angle' class='mark' :class='{major: mark.label}' :style='{left: mark.left}'>
        <span v-if='mark.label'>{{mark.label}}</span>
      </div>
    </div>

    <div class='ground-panel place-panel' :class='{ folded: !optionsAreOpen }'>
      <a href='#' class='ground-back' @click.prevent='close' title='Back to the map (Esc)'>
        <svg viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>
          <path d='M15 5 L8 12 L15 19' />
        </svg>
        Back to the map
      </a>

      <template v-if='view'>
        <a href='#' class='place-row' :title='optionsAreOpen ? "Hide the options" : "Show the time of the day and other options"'
          :aria-expanded='optionsAreOpen' @click.prevent='optionsAreOpen = !optionsAreOpen'>
          <span class='place'>{{place}} <span class='secondary'>· <span class='word'>elevation </span>{{elevation}}</span></span>
          <svg class='fold' viewBox='0 0 24 24' width='16' height='16' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>
            <path d='M6 9 L12 15 L18 9' />
          </svg>
        </a>

        <div class='options' v-show='optionsAreOpen'>
          <div class='ground-row'>
            <label for='ground-time'>Local time</label>
            <strong>{{localTime}}</strong>
            <span v-if='view.followsClock' class='secondary'>now</span>
            <a v-else href='#' @click.prevent='followClock'>back to now</a>
          </div>
          <input id='ground-time' type='range' min='0' max='24' step='0.05' :value='view.localTime' @input='setLocalTime'>
          <div class='secondary'>{{sunDescription}} · {{season}}</div>

          <div class='ground-row'>
            <label for='ground-height'>Eye height</label>
            <strong>{{eyeHeight}}</strong>
          </div>
          <input id='ground-height' type='range' min='0' max='1' step='0.001' :value='eyeHeightPosition' @input='setEyeHeight'>

          <div class='ground-row'>
            <input id='ground-colors' type='checkbox' v-model='useMapColors'>
            <label for='ground-colors'>Paint with the map colors</label>
          </div>

          <div class='secondary hint'>Drag to look around, scroll to zoom. Use W A S D keys to move, Q and E to go down and up. Click the small map to go to another place.</div>
          <div class='secondary credit'>Land from the orbit: NASA/JPL/MSSS/Caltech Murray Lab/Esri, University of Arizona, USGS</div>
        </div>
      </template>
    </div>

    <div class='ground-panel rover-panel' v-if='stop'>
      <div class='place'>{{stop.roverName}} <span class='secondary'>· sol {{stop.sol}} · stop {{stop.index + 1}} of {{stop.total}}</span></div>
      <div class='ground-row stops'>
        <a href='#' :class='{disabled: stop.index === 0}' @click.prevent='goToStop(stop.index - 1)'>‹ previous stop</a>
        <a href='#' :class='{disabled: stop.index === stop.total - 1}' @click.prevent='goToStop(stop.index + 1)'>next stop ›</a>
      </div>
      <div class='ground-row' v-if='photos.count'>
        <input id='ground-photos' type='checkbox' v-model='showPhotos'>
        <label for='ground-photos'>Show {{photos.count}} {{photos.count === 1 ? 'photo' : 'photos'}} taken here</label>
      </div>
      <div class='secondary' v-if='photos.status'>{{photos.status}}</div>
      <div class='secondary' v-if='photos.count && !isAtStop'>
        The photos show up only where the rover stood.
        <a href='#' @click.prevent='returnToStop'>Return there</a>
      </div>
      <div class='secondary' v-if='photos.count'>
        Photos: <a :href='photos.link' target='_blank' rel='noopener'>NASA/JPL-Caltech</a>, raw and unprocessed
      </div>

      <div class='sound' v-for='sound in soundsHere' :key='sound.url'>
        <div><strong>{{sound.title}}</strong> <span class='secondary'>· recorded here on sol {{sound.sol}}</span></div>
        <audio controls preload='none' :src='sound.url'></audio>
        <div class='secondary'>{{sound.description}} <a :href='sound.page' target='_blank' rel='noopener'>{{sound.credit}}</a></div>
      </div>
      <div class='secondary' v-if='sounds.length && !soundsHere.length'>
        <span class='note-mark'>♪</span> on the map marks the stops where this rover recorded the sounds of Mars.
      </div>
    </div>

    <div class='ground-note' v-if='note'>
      {{note.text}}
      <a v-if='note.action' href='#' @click.prevent='note.action'>{{note.actionText}}</a>
    </div>
  </div>
</template>

<script>
import createGroundScene, { MIN_EYE_HEIGHT, MAX_EYE_HEIGHT } from '../ground/createGroundScene.js';
import createPhotoSphere from '../ground/createPhotoSphere.js';
import { loadRoverPhotos, hasRoverPhotos } from '../ground/loadRoverPhotos.js';
import { loadRover, findStop } from '../lib/rovers.js';
import { getColorStops } from '../lib/colorRamp.js';
import { formatHours, getSeasonName } from '../lib/marsTime.js';

const COMPASS_LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const COMPASS_STEP = 15;
const DEGREES = Math.PI / 180;
// The photos are right only when we look from where the camera was. This is
// how far (in meters) we can step aside, and how high the camera was.
const PHOTOS_RANGE = 15;
const ROVER_EYE_HEIGHT = 2;
const METERS_PER_DEGREE = 59274;
// Arrows on the ground point to the neighbor stops of the rover. They lie
// this far from us and are this large, both measured in our eye heights:
// the arrows stay the same on the screen when we go up or down.
const ARROW_DISTANCE = 2.2;
const ARROW_SIZE = 0.5;
// When two arrows point the same way (the rover came back along its own
// tracks), the second one is moved farther, so that both can be clicked.
const ARROWS_TOO_CLOSE = 35;
const SECOND_ARROW_DISTANCE = 1.7;
// The arrow points forward (the first number of each pair)
const ARROW_SHAPE = [[-0.15, -0.7], [0.55, 0], [-0.15, 0.7], [-0.6, 0.7], [0.1, 0], [-0.6, -0.7]];
// The point between the wings of the arrow. A click there should count too.
const ARROW_NOTCH = 4;
// Stops that are closer than this (in meters) do not tell where the rover went
const TOO_CLOSE_FOR_DIRECTION = 1;
// On a narrow screen the options would hide the land, so they wait until asked for
const NARROW_SCREEN = 700;

export default {
  name: 'GroundView',
  props: {
    // {longitude, latitude, heading, pitch, eyeHeight, rover}. The `rover` is
    // optional: {id, site, drive} of the place where a rover has stopped.
    start: { type: Object, required: true },
    theme: { type: String, required: true }
  },
  emits: ['close', 'change'],
  data() {
    return {
      // State of the scene, see getState() in ../ground/createGroundScene.js
      view: null,
      useMapColors: false,
      error: null,
      // The stop of a rover where we stand: {roverId, roverName, site, drive,
      // sol, index, total, longitude, latitude, next, previous}. The last
      // two tell the way to the neighbor stops: {index, sol, distance, bearing}
      stop: null,
      photos: { count: 0, status: '', link: '' },
      // The photos are black and white. Then the land that we draw between
      // them is black and white too.
      photosAreGray: false,
      showPhotos: true,
      optionsAreOpen: window.innerWidth > NARROW_SCREEN,
      // Everything that the rover has recorded: [{sound, stop}], see ../lib/roverSounds.js
      sounds: []
    };
  },

  mounted() {
    this.onKeyDown = e => {
      if (e.key === 'Escape') this.close();
    };
    window.addEventListener('keydown', this.onKeyDown);

    try {
      // The scene is not reactive on purpose: vue should not look inside it
      this.scene = createGroundScene(this.$refs.canvas, {
        ...this.start,
        onChange: view => {
          this.view = view;
          this.photoSphere.setCamera(view.heading, view.pitch, view.fov);
          this.$emit('change', { ...view, rover: this.stopAddress });
        }
      });
      this.photoSphere = createPhotoSphere(this.$refs.photos);
      if (this.start.rover) this.showRoverStop(this.start.rover);
    } catch (e) {
      console.error(e);
      this.error = e.message || String(e);
    }
  },

  beforeUnmount() {
    window.removeEventListener('keydown', this.onKeyDown);
    if (this.scene) this.scene.dispose();
    if (this.photoSphere) this.photoSphere.dispose();
  },

  watch: {
    /**
     * The visitor has chosen another place on the small map (see ../lib/miniMap.js)
     */
    start(start) {
      if (!this.scene) return;
      if (start.rover) {
        this.showRoverStop(start.rover, true);
      } else {
        // The stop of the rover stays with us, the same way it does when we walk away
        this.scene.moveTo(start.longitude, start.latitude);
      }
    },
    useMapColors() {
      this.updateColors();
    },
    photosAreVisible() {
      this.updateSky();
    },
    theme() {
      this.updateColors();
    }
  },

  computed: {
    stopAddress() {
      const stop = this.stop;
      return stop ? { id: stop.roverId, site: stop.site, drive: stop.drive } : null;
    },

    isAtStop() {
      if (!this.stop || !this.view) return false;
      const { longitude, latitude, eyeHeight } = this.view;
      const north = (latitude - this.stop.latitude) * METERS_PER_DEGREE;
      const east = (longitude - this.stop.longitude) * METERS_PER_DEGREE * Math.cos(latitude * DEGREES);
      return Math.hypot(north, east) < PHOTOS_RANGE && eyeHeight < ROVER_EYE_HEIGHT * 2;
    },

    soundsHere() {
      return this.sounds.filter(record => record.stop.index === this.stop.index).map(record => record.sound);
    },

    photosAreVisible() {
      return this.showPhotos && this.photos.count > 0 && this.isAtStop;
    },

    isGray() {
      return this.photosAreVisible && this.photosAreGray;
    },

    /**
     * Arrows to the next and to the previous stops of the rover, drawn on the
     * ground: [{index, isBack, title, points, outline}]
     */
    stopArrows() {
      if (!this.isAtStop) return [];
      const { next, previous } = this.stop;
      const arrows = [];
      if (next) arrows.push(this.getArrow(next, ARROW_DISTANCE, false));
      if (previous) {
        const isSameWay = next && Math.abs(getTurn(next.bearing, previous.bearing)) < ARROWS_TOO_CLOSE;
        arrows.push(this.getArrow(previous, ARROW_DISTANCE * (isSameWay ? SECOND_ARROW_DISTANCE : 1), true));
      }
      return arrows.filter(arrow => arrow.points);
    },

    place() {
      const { latitude, longitude } = this.view;
      // The fourth digit is six meters: a few steps should be seen in the numbers
      return Math.abs(latitude).toFixed(4) + '°' + (latitude < 0 ? 'S' : 'N') + ' ' +
        Math.abs(longitude).toFixed(4) + '°' + (longitude < 0 ? 'W' : 'E');
    },

    elevation() {
      return formatMeters(this.view.elevation);
    },

    localTime() {
      return formatHours(this.view.localTime);
    },

    eyeHeight() {
      return formatDistance(this.view.eyeHeight);
    },

    eyeHeightPosition() {
      // The slider moves along the logarithmic scale: a step near the ground
      // is a meter, a step high in the sky is a kilometer.
      return Math.log(this.view.eyeHeight / MIN_EYE_HEIGHT) / Math.log(MAX_EYE_HEIGHT / MIN_EYE_HEIGHT);
    },

    sunDescription() {
      const elevation = this.view.sunElevation;
      if (elevation < -0.3) return 'The Sun is below the horizon';
      if (elevation < 0.3) return 'The Sun is at the horizon';
      return `The Sun is ${Math.round(elevation)}° above the horizon`;
    },

    season() {
      const { marsTime, latitude } = this.view;
      return getSeasonName(marsTime.solarLongitude, latitude) + ' here';
    },

    note() {
      if (this.error) return { text: this.error };
      if (!this.view) return null;
      if (this.view.error) return { text: this.view.error };
      if (this.view.isLoading) return { text: 'Loading the land around you...' };
      if (this.view.followsClock && this.view.sunElevation < -3) {
        return {
          text: 'It is night here right now.',
          actionText: 'See this place at noon',
          action: () => this.scene.setLocalTime(12)
        };
      }
      return null;
    },

    compassMarks() {
      if (!this.view) return [];
      const { heading, horizontalFov } = this.view;
      const edge = Math.tan(Math.min(horizontalFov, 170) / 2 * DEGREES);
      const marks = [];
      for (let angle = 0; angle < 360; angle += COMPASS_STEP) {
        // How far the mark is from the direction we look at, -180..180
        const offset = ((angle - heading + 540) % 360) - 180;
        if (Math.abs(offset) > 85) continue;
        const position = Math.tan(offset * DEGREES) / edge;
        if (Math.abs(position) > 1) continue;
        marks.push({
          angle,
          left: (50 + 50 * position) + '%',
          label: angle % 45 === 0 ? COMPASS_LABELS[angle / 45] : ''
        });
      }
      return marks;
    }
  },

  methods: {
    close() {
      this.$emit('close', this.view);
    },

    setLocalTime(e) {
      this.scene.setLocalTime(Number.parseFloat(e.target.value));
    },

    followClock() {
      this.scene.setLocalTime(null);
    },

    setEyeHeight(e) {
      const position = Number.parseFloat(e.target.value);
      this.scene.setEyeHeight(MIN_EYE_HEIGHT * Math.pow(MAX_EYE_HEIGHT / MIN_EYE_HEIGHT, position));
    },

    updateColors() {
      if (!this.scene) return;
      this.scene.setColorStops(this.useMapColors ? getColorStops(this.theme) : null);
    },

    /**
     * Our own sky is seen between the photos. While they are shown, it takes
     * the color of the sky that the photos have.
     */
    updateSky() {
      if (!this.scene) return;
      this.scene.setPhotoSky(this.photosAreVisible ? this.photoSphere.getSkyColor() : null);
    },

    /**
     * Shows what a rover saw from one of its stops. The `address` is
     * {id, site, drive}. We are taken to the stop when `shouldMove` is set.
     */
    showRoverStop(address, shouldMove) {
      loadRover(address.id).then(rover => {
        const stop = findStop(rover, address.site, address.drive);
        if (!stop) return;
        // The photos of the stop where we already are do not have to be loaded again
        const isSameStop = this.stop && this.stop.roverId === rover.id && this.stop.index === stop.index;
        if (!isSameStop) this.setStop(rover, stop);
        if (shouldMove) this.returnToStop();
      }).catch(e => {
        console.error(e);
        this.photos = { count: 0, status: 'Could not load the route of the rover.', link: '' };
      });
    },

    goToStop(index) {
      if (!this.stop) return;
      loadRover(this.stop.roverId).then(rover => {
        const stop = rover.stops[index];
        if (!stop) return;
        this.setStop(rover, stop);
        this.returnToStop();
      });
    },

    returnToStop() {
      this.scene.moveTo(this.stop.longitude, this.stop.latitude);
      this.scene.setEyeHeight(ROVER_EYE_HEIGHT);
    },

    /**
     * Describes an arrow that lies on the ground `distance` eye heights from
     * us, and points to a neighbor stop. It has no `points` when it is not
     * on the screen.
     */
    getArrow(neighbor, distance, isBack) {
      const { heading, pitch, fov, horizontalFov, eyeHeight } = this.view;
      const cosBearing = Math.cos(neighbor.bearing * DEGREES);
      const sinBearing = Math.sin(neighbor.bearing * DEGREES);
      const cosHeading = Math.cos(heading * DEGREES);
      const sinHeading = Math.sin(heading * DEGREES);
      const cosPitch = Math.cos(pitch * DEGREES);
      const sinPitch = Math.sin(pitch * DEGREES);
      const zoomX = 1 / Math.tan(Math.min(horizontalFov, 170) / 2 * DEGREES);
      const zoomY = 1 / Math.tan(fov / 2 * DEGREES);

      const points = [];
      for (const [forward, side] of ARROW_SHAPE) {
        // Where the point is, in meters to the North and to the East of us.
        // The ground is one eye height below.
        const along = (distance + forward * ARROW_SIZE) * eyeHeight;
        const across = side * ARROW_SIZE * eyeHeight;
        const north = along * cosBearing - across * sinBearing;
        const east = along * sinBearing + across * cosBearing;

        // And the same from the point of view of the camera
        const flat = north * cosHeading + east * sinHeading;
        const right = east * cosHeading - north * sinHeading;
        const up = -flat * sinPitch - eyeHeight * cosPitch;
        const depth = flat * cosPitch - eyeHeight * sinPitch;
        // An arrow that is partly behind us cannot be drawn
        if (depth < eyeHeight * 0.05) return { index: neighbor.index };
        points.push((right / depth * zoomX).toFixed(4) + ',' + (-up / depth * zoomY).toFixed(4));
      }

      const far = neighbor.distance < 1 ? 'less than a meter away' : formatDistance(neighbor.distance) + ' away';
      return {
        index: neighbor.index,
        isBack,
        title: `${isBack ? 'Previous' : 'Next'} stop: sol ${neighbor.sol}, ${far}`,
        points: points.join(' '),
        outline: points.filter((point, index) => index !== ARROW_NOTCH).join(' ')
      };
    },

    setStop(rover, stop) {
      this.stop = {
        roverId: rover.id,
        roverName: rover.name,
        site: stop.site,
        drive: stop.drive,
        sol: stop.sol,
        index: stop.index,
        total: rover.stops.length,
        longitude: stop.longitude,
        latitude: stop.latitude,
        next: getWayToNeighbor(rover.stops, stop, 1),
        previous: getWayToNeighbor(rover.stops, stop, -1)
      };
      // Only the plain description of the stops goes to vue, not the entire route:
      this.sounds = rover.sounds.map(record => ({ sound: record.sound, stop: { index: record.stop.index } }));
      this.photoSphere.setFrames([]);
      this.photosAreGray = false;
      this.updateSky();
      if (!hasRoverPhotos(rover.id)) {
        this.photos = { count: 0, status: 'Photos of this rover are not here yet.', link: '' };
        return;
      }

      this.photos = { count: 0, status: 'Looking for the photos taken here...', link: '' };
      loadRoverPhotos(rover.id, stop).then(frames => {
        // We could have moved to another stop while the photos were loading
        if (!this.stop || this.stop.index !== stop.index || this.stop.roverId !== rover.id) return;
        if (!frames.length) {
          this.photos = { count: 0, status: 'The rover did not look around at this stop.', link: '' };
          return;
        }

        // Let the Sun shine from where it was when the photos were taken
        this.scene.setMoment(frames[0].date);
        return this.photoSphere.setFrames(frames).then(count => {
          // Zero means that we have asked for other photos meanwhile
          if (count) {
            this.photos = { count, status: '', link: frames[0].link };
            this.photosAreGray = this.photoSphere.isBlackAndWhite();
          }
          this.updateSky();
        });
      }).catch(e => {
        console.error(e);
        this.photos = { count: 0, status: 'Could not load the photos from NASA.', link: '' };
      });
    }
  }
}

/**
 * Tells how to get from a stop to the next one (`step` is 1) or to the
 * previous one (`step` is -1): {index, sol, distance, bearing}. The distance
 * is in meters, the bearing is in degrees clockwise from the North.
 */
function getWayToNeighbor(stops, from, step) {
  const neighbor = stops[from.index + step];
  if (!neighbor) return null;

  // The rover often turns in place, or moves by a few centimeters. Such a
  // neighbor does not tell the direction, so we look where the route goes
  // after it.
  let way = getWay(from, neighbor);
  for (let index = neighbor.index + step; stops[index] && way.distance < TOO_CLOSE_FOR_DIRECTION; index += step) {
    way = getWay(from, stops[index]);
  }
  // No direction at all: let the next stop be ahead, and the previous one behind
  const bearing = way.distance > 0 ? way.bearing : (step > 0 ? 0 : 180);

  return { index: neighbor.index, sol: neighbor.sol, distance: getWay(from, neighbor).distance, bearing };
}

function getWay(from, to) {
  const north = (to.latitude - from.latitude) * METERS_PER_DEGREE;
  const east = (to.longitude - from.longitude) * METERS_PER_DEGREE * Math.cos(from.latitude * DEGREES);
  return { distance: Math.hypot(north, east), bearing: Math.atan2(east, north) / DEGREES };
}

/**
 * How many degrees to turn from one bearing to get to the other, -180..180
 */
function getTurn(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function formatMeters(value) {
  return Math.round(value).toLocaleString('en-US') + ' m';
}

function formatDistance(meters) {
  if (meters < 1000) return Math.round(meters) + ' m';
  return (meters / 1000).toFixed(meters < 10000 ? 1 : 0) + ' km';
}
</script>

<style lang='stylus'>
primary-action-color = #ff4081;
secondary-color = #7a8794;

.ground-view {
  position: fixed;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  z-index: 10;
  background: #0b0908;
  font-size: 14px;

  .secondary {
    color: secondary-color;
    font-size: 12px;
  }
}

.ground-canvas {
  position: absolute;
  width: 100%;
  height: 100%;
  cursor: grab;
  // We handle all gestures ourselves:
  touch-action: none;
  &:active {
    cursor: grabbing;
  }
  &.gray {
    filter: grayscale(1);
  }
}

.ground-photos {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: none;

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
}

.ground-arrows {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  // Only the arrows take the clicks, the rest of the view can be dragged
  pointer-events: none;

  .arrow {
    pointer-events: auto;
    cursor: pointer;
    fill: rgba(255, 255, 255, .92);
    stroke: rgba(0, 0, 0, .6);
    stroke-width: 1.5px;
    stroke-linejoin: round;
    polygon {
      vector-effect: non-scaling-stroke;
    }
    .hit {
      fill: transparent;
      stroke: none;
    }
  }
  // The way back is less important than the way forward
  .arrow.back {
    fill: rgba(255, 255, 255, .5);
  }
  .arrow:hover polygon:not(.hit) {
    fill: primary-action-color;
  }
}


.ground-compass {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 34px;
  overflow: hidden;
  pointer-events: none;
  color: white;
  text-shadow: 0 0 3px rgba(0, 0, 0, .9);
  background: linear-gradient(rgba(0, 0, 0, .35), rgba(0, 0, 0, 0));

  .mark {
    position: absolute;
    top: 0;
    width: 0;
    height: 5px;
    border-left: 1px solid rgba(255, 255, 255, .7);
    span {
      position: absolute;
      top: 10px;
      transform: translateX(-50%);
      font-size: 12px;
      font-weight: bold;
    }
  }
  .mark.major {
    height: 9px;
  }
}

.ground-panel {
  position: absolute;
  left: 10px;
  bottom: 10px;
  width: 300px;
  max-width: calc(100% - 20px);
  box-sizing: border-box;
  padding: 10px 14px 12px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, .35);

  .place {
    font-weight: bold;
    .secondary {
      font-weight: normal;
    }
  }
  .ground-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-top: 10px;
    a {
      font-size: 12px;
    }
  }
  input[type='range'] {
    display: block;
    width: 100%;
    margin: 4px 0;
  }
  input[type='checkbox'] {
    margin: 0;
    align-self: center;
    cursor: pointer;
  }
  .hint, .credit {
    margin-top: 10px;
  }
}

// Where we are, and the way back. The small map takes the corner below, see ../App.vue
.ground-panel.place-panel {
  top: 10px;
  bottom: auto;
  padding: 0;
  max-height: calc(100% - 20px);
  overflow-y: auto;

  .ground-back {
    display: flex;
    align-items: center;
    height: 38px;
    padding: 0 14px 0 8px;
    border-bottom: 1px solid #e4e4e4;
  }
  .place-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 10px 9px 14px;
    color: inherit;
    .fold {
      flex-shrink: 0;
      color: secondary-color;
      transform: rotate(180deg);
      transition: transform .15s;
    }
    &:hover .fold {
      color: primary-action-color;
    }
  }
  &.folded .fold {
    transform: none;
  }
  .options {
    padding: 0 14px 12px;
    .ground-row:first-child {
      margin-top: 2px;
    }
  }
}

.ground-panel.rover-panel {
  left: auto;
  right: 10px;
  .stops {
    justify-content: space-between;
    a {
      font-size: 14px;
    }
    a.disabled {
      color: secondary-color;
      pointer-events: none;
    }
  }
  .secondary {
    margin-top: 8px;
  }
  .place .secondary {
    margin-top: 0;
  }
  .sound {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid #e4e4e4;
    audio {
      display: block;
      width: 100%;
      height: 32px;
      margin: 6px 0 2px;
    }
    .secondary {
      margin-top: 0;
    }
  }
  .note-mark {
    display: inline-block;
    width: 16px;
    height: 16px;
    line-height: 16px;
    border-radius: 50%;
    text-align: center;
    background: #ffd95a;
    color: #3a2a00;
  }
}

.ground-note {
  position: absolute;
  left: 50%;
  top: 46px;
  transform: translateX(-50%);
  max-width: calc(100% - 20px);
  padding: 8px 14px;
  background: white;
  border-radius: 4px;
  box-shadow: 0 0 10px rgba(0, 0, 0, .3);
  text-align: center;
}

@media (max-width: 700px) {
  .ground-panel .hint {
    display: none;
  }
  // The place and its height have one line: the number speaks for itself
  .place-panel .place {
    white-space: nowrap;
    .word {
      display: none;
    }
  }
  .ground-panel.rover-panel {
    bottom: auto;
    top: 96px;
    width: 240px;
  }
  // The note goes next to the small map: the top of the screen is taken
  .ground-note {
    top: auto;
    bottom: 10px;
    left: 150px;
    transform: none;
    width: calc(100% - 160px);
    box-sizing: border-box;
  }
}
</style>
