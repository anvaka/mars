<template>
  <div class='poster-view'>
    <div class='stage' ref='stage'>
      <div class='poster' :class='{ drawing: isSketching }' :style='boxStyle'>
        <canvas ref='background' class='layer'></canvas>
        <div ref='map' class='poster-map' :class='{ hidden: !isLive }' :style='mapStyle'></div>
        <canvas ref='pictures' class='layer' v-show='!isLive'></canvas>
        <canvas ref='overlay' class='layer overlay'></canvas>
      </div>
    </div>

    <div class='poster-panel'>
      <div class='header'>
        <h3>Poster</h3>
        <a href='#' class='close' title='Back to the map' aria-label='Back to the map' @click.prevent='$emit("close")'>&times;</a>
      </div>

      <div class='kinds'>
        <a href='#' :class='{ active: kind === "moment" }' @click.prevent='setKind("moment")'>A moment</a>
        <a href='#' :class='{ active: kind === "place" }' @click.prevent='setKind("place")'>A place</a>
      </div>

      <template v-if='kind === "moment"'>
        <p class='intro'>Mars the way it was seen from Earth at a moment that matters to you.</p>
        <div class='row' v-for='(row, index) in rows' :key='index'>
          <label :for='index ? "poster-day-" + index : "poster-day"'>{{index ? 'And' : 'When'}}</label>
          <input :id='index ? "poster-day-" + index : "poster-day"' type='date' class='day' v-model='row.day'
            min='1800-01-01' max='2050-12-31' @input='row.offset = null'>
          <input :id='index ? "poster-time-" + index : "poster-time"' type='time' class='time' v-model='row.time'
            aria-label='Time' @input='row.offset = null'>
        </div>
        <div class='row top'>
          <span class='label'>Show</span>
          <div class='choices'>
            <a v-for='choice in shows' :key='choice.id' href='#' :class='{ active: show === choice.id }'
              @click.prevent='setShow(choice.id)'>{{choice.name}}</a>
          </div>
        </div>
      </template>

      <template v-else>
        <p class='intro'>A map of a place on Mars. Drag and zoom it to choose what goes into the frame.</p>
        <search-box class='place-search' @select='setFeature'></search-box>
        <div class='choices suggestions' v-if='suggestions.length'>
          <a v-for='place in suggestions' :key='place.id' href='#' :class='{ active: isOnlyPlace(place) }'
            @click.prevent='setFeature(place)'>{{place.name}}</a>
        </div>
        <div class='row check'>
          <input id='poster-names' type='checkbox' v-model='hasNames'>
          <label for='poster-names'>Names on the map</label>
        </div>
      </template>

      <div class='row'>
        <label for='poster-words'>Words</label>
        <input id='poster-words' type='text' v-model='words' maxlength='32' placeholder='A name, or a few words'
          autocomplete='off' spellcheck='false'>
      </div>
      <div class='actions'>
        <a href='#' class='primary' :class='{ busy: isBusy }' @click.prevent='download'>
          {{isDrawing ? progress : 'Download the picture'}}
        </a>
        <a href='#' class='secondary' :class='{ busy: isBusy }' @click.prevent='order'>
          {{isOrdering ? 'Preparing the print...' : 'Order a print'}}
        </a>
      </div>
      <div class='more'>
        <a href='#' @click.prevent='setNextTheme'>Change colors</a>
        <a href='#' class='copy' @click.prevent='copyLink'>{{isCopied ? 'The link is copied' : 'Copy the link'}}</a>
      </div>

      <!-- Everything that comes and goes is below, so that nothing above it moves -->
      <div class='notes' ref='notes'>
        <p class='note' v-if='kind === "moment" && isLive && isTurned'>
          You have turned the globe.
          <a href='#' @click.prevent='showAsSeen'>Show it as it was seen from Earth</a>
        </p>
        <p class='note' v-if='printLink'>
          Your poster is ready to be printed.
          <a :href='printLink' target='_blank' rel='noopener' @click='recordOrder'>Open it on Zazzle</a>
          to choose its size and a frame.
        </p>
        <p class='note error' v-if='error'>{{error}}</p>
      </div>
    </div>
  </div>
</template>

<script>
import appState from '../appState.js';
import SearchBox from './SearchBox.vue';
import { loadDemSource } from '../tiles.js';
import { loadFeatures, describeFeature, formatCoordinates, getBounds, getArea } from '../lib/features.js';
import { loadElevationRange } from '../lib/elevationTiles.js';
import { getMarsTime, getMarsYear, getSeasonName } from '../lib/marsTime.js';
import { seeMarsFromEarth } from '../lib/marsFromEarth.js';
import { getPosterStyle } from '../poster/posterStyle.js';
import { createPosterMap, measureGlobe, fitGlobe, renderPictures, LARGEST_CANVAS } from '../poster/posterMap.js';
import { POSTER_WIDTH, POSTER_HEIGHT, MOMENT, PLACE, getLayout } from '../poster/posterLayout.js';
import { drawBackground, drawOverlay } from '../poster/drawPoster.js';
import {
  parseMoment, getMoment, getDate, getPictureMoments, describeMoments, writePoster
} from '../poster/posterDescription.js';
import { getPosterPrintLink } from '../lib/printShop.js';

// Places that make a good picture, for those who came without one in mind:
// ids of the features, see ../lib/features.js. The first one is the mountain
// that everyone knows, and the poster opens with it.
const SUGGESTED_PLACES = [
  4453, // Olympus Mons
  6288, // Valles Marineris
  5948, // Tharsis Montes
  2071, // Gale
  4324, // Noctis Labyrinthus
  2402  // Hebes Chasma
];
// What a poster of a moment can show. One moment is one globe, and the rest
// is a sheet of them: the layout is counted, see ../poster/posterLayout.js.
const SHOWS = [
  { id: 'one', name: 'A moment' },
  { id: 'two', name: 'Two' },
  { id: 'month', name: 'A month' },
  { id: 'year', name: 'A year' }
];
// Room between the poster and the edges of the screen
const STAGE_MARGIN = 24;
// Room between a place and the frame of its map, as a part of the frame
const PLACE_MARGIN = 0.09;
// A feature without a known size (a landing site) is shown from this close
const ZOOM_OF_SMALL_PLACE = 7;
const KM_AROUND_EQUATOR = 2 * Math.PI * 3396.19;
// The scale bar is not longer than this, in the units of the poster
const LONGEST_SCALE = 150;
// The hidden map cannot draw a globe that is smaller than this, in pixels
const SMALLEST_GLOBE = 48;
// The visitor types, drags and turns. We wait for a pause this long (in
// milliseconds) before we draw the pictures and write the address again.
const PAUSE = 250;

/**
 * Makes a poster: Mars at the moments that the visitor has chosen, or maps
 * of named places. See ../poster/posterDescription.js for what a poster is
 * about, and ../poster/drawPoster.js for what it is made of.
 *
 * A poster with one picture has a map that can be dragged. When there are
 * more, the pictures are drawn one after another by a hidden map, the same
 * way the picture for print is made.
 *
 * `start` tells what to open with: the description of a poster. It may have
 * a `feature` instead of `places`, if the place is already known.
 */
export default {
  name: 'PosterView',
  components: { SearchBox },
  props: {
    start: { type: Object, required: true },
    theme: { type: String, required: true }
  },
  emits: ['close'],

  data() {
    const start = this.start;
    const moments = start.moments && start.moments.length ? start.moments : [getMoment()];
    return {
      kind: start.kind === PLACE ? PLACE : MOMENT,
      // The moments, the way the visitor has typed them: "2015-02-14" and
      // "20:30". The `offset` tells how far the clock is from Greenwich; when
      // it is not known, the clock is the one of the visitor.
      rows: moments.map(getRow),
      // `moment`, `month` or `year`, see ../poster/posterDescription.js
      span: start.span || 'moment',
      words: start.words || '',
      // True when the visitor has turned the globe away from what Earth has seen
      isTurned: false,
      // True when the visitor has moved the map of the place
      isFramed: false,
      // The places of the poster, see ../lib/features.js
      features: start.feature ? [start.feature] : [],
      // The places that we offer, see SUGGESTED_PLACES
      suggestions: [],
      // `{min, max}` of the only place, in meters
      elevation: null,
      // The names make a map of the picture. It is cleaner without them.
      hasNames: Boolean(start.hasNames),
      // How many pixels of the screen one unit of the poster takes
      scale: 0.5,
      // Changes when the map has moved, for those who depend on its camera
      cameraVersion: 0,
      // True while the pictures of the poster on the screen are drawn
      isSketching: false,
      isDrawing: false,
      // How many pictures of the file are drawn already
      drawn: 0,
      // True while the picture is sent to the print shop
      isOrdering: false,
      // The page of the print shop where this very poster can be ordered
      printLink: '',
      isCopied: false,
      error: ''
    };
  },

  computed: {
    shows() {
      // A link may have more than two moments
      return SHOWS.map(show => (show.id === 'two' && this.rows.length > 2 ? { id: 'two', name: 'Several' } : show));
    },
    show() {
      if (this.span !== 'moment') return this.span;
      return this.rows.length > 1 ? 'two' : 'one';
    },

    /**
     * The moments that are typed well, see ../poster/posterDescription.js
     */
    moments() {
      return this.rows.map(readRow).filter(Boolean);
    },
    /**
     * The globes of the poster: when each was seen, and how it was turned to
     * Earth (see ../lib/marsFromEarth.js). There is always at least one.
     */
    globes() {
      const chosen = this.moments.length ? this.moments : [getMoment()];
      return getPictureMoments(chosen, this.span).map(moment => {
        const date = getDate(moment);
        const seen = seeMarsFromEarth(date);
        // What we see has happened on Mars when the light has left it
        return { moment, seen, sunDate: new Date(date.getTime() - seen.lightTime * 1000) };
      });
    },
    feature() {
      return this.features[0] || null;
    },

    /**
     * How many pictures the poster has
     */
    count() {
      return this.kind === MOMENT ? this.globes.length : Math.max(1, this.features.length);
    },
    /**
     * The only picture is a map that the visitor can drag
     */
    isLive() {
      return this.count === 1;
    },
    layout() {
      return getLayout(this.kind, this.count, this.kind === MOMENT && this.span !== 'moment');
    },

    isBusy() {
      return this.isDrawing || this.isOrdering;
    },
    progress() {
      return this.count > 1 ? `Drawing ${Math.min(this.drawn + 1, this.count)} of ${this.count}...` : 'Drawing it...';
    },
    boxStyle() {
      return { width: POSTER_WIDTH * this.scale + 'px', height: POSTER_HEIGHT * this.scale + 'px' };
    },
    mapStyle() {
      // The map is of a poster with one picture. It keeps that size while it is hidden.
      const { x, y, width, height } = getLayout(this.kind).cells[0].map;
      const scale = this.scale;
      return { left: x * scale + 'px', top: y * scale + 'px', width: width * scale + 'px', height: height * scale + 'px' };
    },

    /**
     * What the map of every picture shows, see ../poster/posterStyle.js
     */
    contents() {
      const sunDate = this.globes[0].sunDate;
      if (this.kind === MOMENT) {
        return this.globes.map(globe => ({ kind: MOMENT, sunDate: globe.sunDate, hasNames: false, titleId: null }));
      }
      const features = this.features.length ? this.features : [null];
      return features.map(feature => ({
        kind: PLACE,
        sunDate,
        hasNames: this.hasNames,
        // The name of the place itself is in the words of the poster
        titleId: feature ? feature.id : null
      }));
    },
    /**
     * When the light of the first picture has left Mars, in milliseconds
     */
    sunTime() {
      return this.globes[0].sunDate.getTime();
    },

    /**
     * Everything that is drawn around the maps, see ../poster/drawPoster.js
     */
    poster() {
      // The camera of the map is not reactive, this is how we know it has moved
      const version = this.cameraVersion;
      return this.kind === MOMENT ? this.getMomentPoster(version) : this.getPlacePoster(version);
    },

    /**
     * Changes when the pictures that the hidden map draws are not the same anymore
     */
    picturesKey() {
      if (this.isLive) return '';
      const subjects = this.kind === MOMENT ? this.globes.map(globe => globe.sunDate.getTime()) : this.features.map(feature => feature.id);
      return [this.kind, this.theme, this.hasNames, this.scale, subjects.join()].join('|');
    },

    /**
     * The poster for the address bar, see ../poster/posterDescription.js
     */
    address() {
      const version = this.cameraVersion;
      return writePoster({
        kind: this.kind,
        moments: this.moments,
        span: this.span,
        places: this.features.map(feature => feature.id),
        hasNames: this.hasNames,
        words: this.words.trim(),
        camera: this.getCamera(version)
      });
    }
  },

  watch: {
    kind() {
      this.error = '';
      this.updateStyle();
      this.showAfterResize();
    },
    isLive(isLive) {
      // The map was not drawn while it was hidden
      if (isLive) this.showAfterResize();
    },
    theme() {
      this.printLink = '';
      this.updateStyle();
    },
    hasNames() {
      this.printLink = '';
      this.updateStyle();
    },
    sunTime() {
      if (this.kind !== MOMENT) return;
      this.updateStyle();
      if (!this.isTurned) this.showFromEarth();
    },
    feature: {
      immediate: true,
      handler(feature) {
        this.elevation = null;
        if (!feature) return;

        const area = getArea(feature);
        if (area) {
          // A link opens the poster before the map knows where the elevation is
          loadDemSource().then(() => loadElevationRange(area.box, area.contains)).then(elevation => {
            if (feature === this.feature) this.elevation = elevation;
          }).catch(() => {});
        }
        if (this.map && this.kind === PLACE) {
          this.updateStyle();
          this.showAll();
        }
      }
    },
    poster() {
      // The print that was prepared is of the poster as it was
      this.printLink = '';
      this.draw();
    },
    printLink(link) {
      if (link) this.showNotes();
    },
    error(error) {
      if (error) this.showNotes();
    },
    picturesKey() {
      this.sketchLater();
    },
    address() {
      this.isCopied = false;
      clearTimeout(this.addressTimer);
      this.addressTimer = setTimeout(() => this.saveAddress(), PAUSE);
    }
  },

  mounted() {
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.updateScale();
    // The camera that the link asks for, until the visitor chooses their own
    this.startCamera = this.start.camera || null;
    // Every time the pictures are drawn again, the number is new
    this.sketch = 0;

    loadFeatures().then(features => {
      const byId = new Map(features.map(feature => [String(feature.id), feature]));
      this.suggestions = SUGGESTED_PLACES.map(id => byId.get(String(id))).filter(Boolean);
      if (this.features.length) return;

      const asked = (this.start.places || []).map(id => byId.get(String(id))).filter(Boolean);
      this.features = asked.length ? asked : this.suggestions.slice(0, 1);
    }).catch(() => {});

    loadDemSource().then(demSource => {
      if (this.isGone) return;
      this.demSource = demSource;
      const map = createPosterMap(this.$refs.map, getPosterStyle(demSource, this.contents[0], getScreenDetail()));
      // The same way the main map is seen from the console of the browser
      window.posterMap = this.map = map;
      map.on('move', e => {
        if (e.originalEvent) {
          // From now on the camera is of the visitor
          this.startCamera = null;
          if (this.kind === MOMENT) this.isTurned = true;
          else this.isFramed = true;
        }
        this.cameraVersion += 1;
      });
      // The map becomes a globe when its style is loaded, and only then it
      // can be turned the way a globe is
      map.once('load', () => this.showAll());
      this.showAll();
      this.cameraVersion += 1;
      this.sketchLater();
    }).catch(e => {
      console.error(e);
      this.error = 'Could not load the map of Mars.';
    });
    this.draw();
    this.saveAddress();
  },

  beforeUnmount() {
    this.isGone = true;
    clearTimeout(this.addressTimer);
    clearTimeout(this.sketchTimer);
    clearTimeout(this.copiedTimer);
    window.removeEventListener('resize', this.onResize);
    if (this.map) this.map.remove();
  },

  methods: {
    setNextTheme() {
      appState.setNextTheme();
    },

    setKind(kind) {
      if (kind === this.kind) return;
      this.startCamera = null;
      this.kind = kind;
    },

    /**
     * `show` is one of SHOWS
     */
    setShow(show) {
      const first = this.rows[0];
      if (show === 'two') {
        this.span = 'moment';
        if (this.rows.length < 2) this.rows = [first, getRowBefore(first)];
        return;
      }
      this.rows = [first];
      this.span = show === 'one' ? 'moment' : show;
    },

    setFeature(feature) {
      this.startCamera = null;
      this.features = [feature];
    },

    isOnlyPlace(place) {
      return this.features.length === 1 && this.features[0].id === place.id;
    },

    getMomentPoster() {
      const globes = this.globes;
      const layout = this.layout;
      const lines = [];
      let title = this.words.trim();
      let captions = [];
      if (this.moments.length) {
        const said = describeMoments(globes.map(globe => globe.moment));
        captions = said.captions;
        const when = this.isLive ? `${said.date}  ·  ${said.time}` : said.date;
        if (!title) title = when;
        else if (when) lines.push(when);

        lines.push(getCalendarLine(globes));
        const distance = getDistanceLine(globes);
        if (this.isLive) lines.push(this.isTurned ? `${distance} from Earth` : `Seen from Earth, ${distance} away`);
        else lines.push(`Seen from Earth${said.time ? ' at ' + said.time : ''}, ${distance} away`);
      }

      const cells = layout.cells.map((cell, index) => ({ ...cell, text: captions[index] }));
      if (this.isLive && this.map) {
        // The map takes the entire poster, so its pixels are counted from the same corner
        const measured = measureGlobe(this.map);
        cells[0].globe = { x: measured.x / this.scale, y: measured.y / this.scale, radius: measured.radius / this.scale };
      }
      return { ...layout, kind: MOMENT, title: title || 'Mars', lines, cells };
    },

    getPlacePoster() {
      const features = this.features;
      const layout = this.layout;
      const words = this.words.trim();
      if (!features.length) return { ...layout, kind: PLACE, title: words, lines: [] };
      if (features.length > 1) {
        // The names are under the maps
        const cells = layout.cells.map((cell, index) => ({ ...cell, text: features[index].name }));
        return { ...layout, kind: PLACE, title: words || 'Mars', lines: [], cells };
      }

      const feature = features[0];
      const facts = [formatCoordinates(feature)];
      const elevation = this.elevation;
      if (elevation && elevation.max !== undefined) {
        // The same rule as on the card of the place: we tell the end that
        // surely belongs to the feature.
        if (feature.class === 'mountain') facts.push('Highest point ' + formatMeters(elevation.max));
        else if (feature.class === 'valley') facts.push('Lowest point ' + formatMeters(elevation.min));
        else facts.push(`From ${formatMeters(elevation.min)} to ${formatMeters(elevation.max)}`);
      }

      const about = describeFeature(feature);
      return {
        ...layout,
        kind: PLACE,
        title: words || feature.name,
        lines: [words ? `${feature.name}  ·  ${about}` : about, facts.join('  ·  ')],
        scale: this.getScaleBar()
      };
    },

    /**
     * A round number of kilometers, and how long it is on the poster
     */
    getScaleBar() {
      const map = this.map;
      if (!map) return null;

      const kmInPixel = KM_AROUND_EQUATOR * Math.cos(map.getCenter().lat * Math.PI / 180) / (512 * Math.pow(2, map.getZoom()));
      const kmInUnit = kmInPixel * this.scale;
      const longest = kmInUnit * LONGEST_SCALE;
      const power = Math.pow(10, Math.floor(Math.log10(longest)));
      const km = [5, 2, 1].map(step => step * power).find(step => step <= longest);
      return { length: km / kmInUnit, label: km.toLocaleString('en-US') + ' km' };
    },

    /**
     * Where the visitor has turned the only map to, for the address bar. See
     * `camera` in ../poster/posterDescription.js.
     */
    getCamera() {
      const map = this.map;
      if (!map || !this.isLive || !(this.kind === MOMENT ? this.isTurned : this.isFramed)) return null;
      const center = map.getCenter();
      return [center.lng, center.lat, map.getZoom() - Math.log2(this.scale)];
    },

    /**
     * Turns the map to what the poster is about
     */
    showAll() {
      if (!this.map) return;
      if (this.kind === MOMENT) this.showFromEarth();
      else this.showPlace();

      const camera = this.startCamera;
      if (!camera || !this.isLive) return;
      this.map.jumpTo({ center: [camera[0], camera[1]], zoom: camera[2] + Math.log2(this.scale) });
      if (this.kind === MOMENT) this.isTurned = true;
      else this.isFramed = true;
    },

    showAsSeen() {
      this.startCamera = null;
      this.showFromEarth();
    },

    showFromEarth() {
      const map = this.map;
      if (!map) return;

      this.isTurned = false;
      const globe = getLayout(MOMENT).cells[0].globe;
      const seen = this.globes[0].seen;
      map.jumpTo({
        center: [seen.longitude, seen.latitude],
        // The globe is above the middle of the poster
        padding: { top: 0, left: 0, right: 0, bottom: (POSTER_HEIGHT - 2 * globe.y) * this.scale }
      });
      fitGlobe(map, globe.radius * this.scale);
    },

    showPlace() {
      if (!this.map || !this.feature) return;
      this.isFramed = false;
      aimAtPlace(this.map, this.feature, getLayout(PLACE).cells[0].map, this.scale);
    },

    updateStyle() {
      const map = this.map;
      if (!map) return;
      // The map can change only a style that it has loaded. Otherwise it starts anew.
      map.setStyle(getPosterStyle(this.demSource, this.contents[0], getScreenDetail()), { diff: Boolean(map.isStyleLoaded()) });
    },

    /**
     * The map gets its new size after the page is drawn again
     */
    showAfterResize() {
      this.$nextTick(() => {
        if (!this.map) return;
        this.map.resize();
        this.showAll();
      });
    },

    updateScale() {
      const stage = this.$refs.stage.getBoundingClientRect();
      const width = Math.min(stage.width - STAGE_MARGIN * 2, (stage.height - STAGE_MARGIN * 2) * POSTER_WIDTH / POSTER_HEIGHT);
      this.scale = Math.max(120, width) / POSTER_WIDTH;
    },

    resize() {
      const before = this.scale;
      this.updateScale();
      if (before === this.scale) return;

      this.$nextTick(() => {
        if (!this.map) return;
        // The same land should stay in the frame
        const zoom = this.map.getZoom() + Math.log2(this.scale / before);
        this.map.resize();
        if (this.kind === MOMENT && !this.isTurned) this.showFromEarth();
        else this.map.jumpTo({ zoom });
        this.draw();
      });
    },

    /**
     * On a small screen the panel is scrolled, and a note that has just
     * appeared may be under its edge
     */
    showNotes() {
      this.$nextTick(() => {
        const notes = this.$refs.notes;
        if (notes && notes.scrollIntoView) notes.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    },

    saveAddress() {
      clearTimeout(this.addressTimer);
      if (!this.isGone) appState.savePoster(this.address);
    },

    copyLink() {
      this.saveAddress();
      const done = () => {
        this.isCopied = true;
        clearTimeout(this.copiedTimer);
        this.copiedTimer = setTimeout(() => { this.isCopied = false; }, 4000);
      };
      const address = window.location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(address).then(done).catch(() => {
          this.error = 'Could not copy the link. It is in the address bar of the browser.';
        });
      } else {
        this.error = 'The link is in the address bar of the browser.';
      }
    },

    /**
     * Draws the paper and the words of the poster on the screen
     */
    draw() {
      const ratio = this.prepareLayer(this.$refs.background);
      this.prepareLayer(this.$refs.overlay);
      [[this.$refs.background, drawBackground], [this.$refs.overlay, drawOverlay]].forEach(([canvas, drawLayer]) => {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        drawLayer(ctx, this.poster);
      });
    },

    /**
     * Gives the canvas the size of the poster on the screen. Returns how
     * many of its pixels a unit of the poster takes.
     */
    prepareLayer(canvas) {
      const ratio = (window.devicePixelRatio || 1) * this.scale;
      if (!canvas) return ratio;
      const width = Math.round(POSTER_WIDTH * ratio);
      const height = Math.round(POSTER_HEIGHT * ratio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      return ratio;
    },

    /**
     * Tells the hidden map what to draw: a picture for every cell of the
     * poster, see `renderPictures()` in ../poster/posterMap.js.
     */
    getPictures() {
      const cells = this.layout.cells;
      const contents = this.contents;
      if (this.isLive) {
        // Exactly what the visitor sees
        const map = this.map;
        const camera = { center: map.getCenter(), zoom: map.getZoom(), padding: map.getPadding() };
        return [{ frame: cells[0].map, content: contents[0], aim: hidden => hidden.jumpTo(camera) }];
      }

      return cells.map((cell, index) => {
        const frame = cell.map;
        const content = contents[index];
        if (this.kind === PLACE) {
          const feature = this.features[index];
          return { frame, content, aim: (map, mapScale) => aimAtPlace(map, feature, frame, mapScale) };
        }
        const seen = this.globes[index].seen;
        return {
          frame,
          content,
          aim: (map, mapScale) => {
            map.jumpTo({ center: [seen.longitude, seen.latitude] });
            fitGlobe(map, cell.globe.radius * mapScale);
          }
        };
      });
    },

    /**
     * How many pixels of the hidden map a unit of the poster takes. It is
     * the same for the screen and for print, so that the names of a map are
     * where the visitor has seen them.
     */
    getMapScale() {
      const globe = this.layout.cells[0].globe;
      if (this.isLive || !globe) return this.scale;
      return Math.max(this.scale, SMALLEST_GLOBE / globe.radius);
    },

    /**
     * Draws the pictures of the poster on the screen, when the visitor
     * makes a pause
     */
    sketchLater() {
      clearTimeout(this.sketchTimer);
      // Whatever is being drawn is not needed anymore
      this.sketch += 1;
      this.isSketching = false;
      if (this.isLive || !this.demSource) return;

      this.isSketching = true;
      this.sketchTimer = setTimeout(() => this.drawSketch(), PAUSE);
    },

    drawSketch() {
      const sketch = this.sketch;
      const canvas = this.$refs.pictures;
      const cells = this.layout.cells;
      const ratio = this.prepareLayer(canvas);
      const ctx = canvas.getContext('2d');
      // The pictures of the same grid are replaced one by one. Those of
      // another grid are not at their places.
      const grid = [this.kind, cells.length, canvas.width].join();
      if (grid !== this.sketchedGrid) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this.sketchedGrid = grid;
      }

      renderPictures(this.demSource, this.getPictures(), {
        mapScale: this.getMapScale(),
        pictureScale: ratio,
        isStopped: () => this.isGone || sketch !== this.sketch,
        onPicture: (picture, index) => {
          const { x, y, width, height } = cells[index].map;
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
          ctx.clearRect(x, y, width, height);
          ctx.drawImage(picture, x, y, width, height);
        }
      }).catch(e => {
        console.error(e);
        if (sketch === this.sketch) this.error = 'Could not draw the poster. Please try again.';
      }).then(() => {
        if (sketch === this.sketch) this.isSketching = false;
      });
    },

    /**
     * Draws the poster as large as a browser can, and saves it as a file
     */
    download() {
      if (this.isBusy || !this.map) return;
      this.isDrawing = true;
      this.error = '';

      const poster = this.poster;
      this.drawPicture(poster).then(canvas => {
        return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      }).then(blob => {
        if (!blob) throw new Error('The browser could not make the picture');
        // Tests and those who are curious can look at the last picture
        this.lastPicture = blob;
        saveFile(blob, getFileName(poster));
      }).catch(e => {
        console.error(e);
        this.error = 'Could not draw the picture. Please try again.';
      }).then(() => {
        this.isDrawing = false;
      });
    },

    /**
     * Sends the poster to the print shop, and the visitor after it
     */
    order() {
      if (this.isBusy || !this.map) return;
      if (this.printLink) {
        this.openPrintShop();
        return;
      }
      this.isOrdering = true;
      this.error = '';

      // The visitor may change the poster while we work. Then the print is
      // not of what they see anymore.
      const poster = this.poster;
      this.drawPicture(poster).then(getPosterPrintLink).then(link => {
        if (poster !== this.poster) {
          this.error = 'The poster has changed while the print was prepared. Please order it again.';
          return;
        }
        this.printLink = link;
        this.openPrintShop();
      }).catch(e => {
        console.error(e);
        this.error = 'Could not prepare the print. Please try again.';
      }).then(() => {
        this.isOrdering = false;
      });
    },

    openPrintShop() {
      // A browser may not let us open a window this long after the click.
      // Then the link in the panel does it.
      window.open(this.printLink, '_blank', 'noopener');
      this.recordOrder();
    },

    recordOrder() {
      if (typeof gtag === 'undefined') return;
      gtag('event', 'click', { event_category: 'Outbound Link', event_label: 'poster print: ' + this.kind });
    },

    /**
     * Resolves with a canvas that has the poster as large as a browser can draw
     */
    drawPicture(poster) {
      // How many pixels of the picture one unit of the poster takes. A pixel
      // is left spare: the map rounds its size up, and must not get over the limit.
      const size = (LARGEST_CANVAS - 1) / POSTER_HEIGHT;
      const cells = this.layout.cells;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(POSTER_WIDTH * size);
      canvas.height = Math.round(POSTER_HEIGHT * size);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(size, 0, 0, size, 0, 0);
      drawBackground(ctx, poster);

      this.drawn = 0;
      return renderPictures(this.demSource, this.getPictures(), {
        mapScale: this.getMapScale(),
        pictureScale: size,
        isStopped: () => this.isGone,
        onPicture: (picture, index) => {
          const { x, y, width, height } = cells[index].map;
          ctx.drawImage(picture, x, y, width, height);
          this.drawn = index + 1;
        }
      }).then(() => {
        drawOverlay(ctx, poster);
        return canvas;
      });
    }
  }
};

/**
 * Turns a map to a named place, so that it fits into the frame with some
 * room around. `scale` tells how many pixels a unit of the poster takes.
 */
function aimAtPlace(map, feature, frame, scale) {
  map.setPadding({ top: 0, left: 0, right: 0, bottom: 0 });
  const bounds = getBounds(feature);
  const margin = Math.min(frame.width, frame.height) * scale * PLACE_MARGIN;
  if (bounds) map.fitBounds(bounds, { padding: margin, duration: 0 });
  else map.jumpTo({ center: [feature.lon, feature.lat], zoom: ZOOM_OF_SMALL_PLACE });
}

/**
 * "Mars year 38 · Sol 301 · autumn in the North" for one globe. For many it
 * tells what they share, and how the rest differs.
 */
function getCalendarLine(globes) {
  const calendars = globes.map(globe => getMarsYear(globe.sunDate));
  const seasons = globes.map(globe => getSeasonName(getMarsTime(globe.sunDate).solarLongitude, 1));
  const years = calendars.map(calendar => calendar.year);
  const parts = [];
  if (isSame(years)) parts.push(`Mars year ${years[0]}`, sayAll('Sol', 'Sols', calendars.map(calendar => calendar.sol)));
  else parts.push(sayAll('Mars year', 'Mars years', years));
  if (isSame(seasons)) parts.push(`${seasons[0]} in the North`);
  return parts.join('  ·  ');
}

/**
 * "101 million km", or "96 to 101 million km" when the globes are not equally far
 */
function getDistanceLine(globes) {
  return sayAll('', '', globes.map(globe => Math.round(globe.seen.distance / 1e6))) + ' million km';
}

/**
 * Says several numbers in a few words: "Sol 5" when they are the same, "Sols
 * 5 and 9" for two of them, and "Sols 5 to 9" for a row.
 */
function sayAll(one, many, numbers) {
  let said;
  if (isSame(numbers)) said = `${one} ${numbers[0]}`;
  else if (numbers.length === 2) said = `${many} ${numbers[0]} and ${numbers[1]}`;
  else said = `${many} ${Math.min(...numbers)} to ${Math.max(...numbers)}`;
  return said.trim();
}

function isSame(values) {
  return values.every(value => value === values[0]);
}

/**
 * Turns a moment (see ../poster/posterDescription.js) into what the visitor types
 */
function getRow(moment) {
  return {
    day: `${moment.year}-${pad(moment.month)}-${pad(moment.day)}`,
    time: `${pad(moment.hour)}:${pad(moment.minute)}`,
    offset: moment.offset
  };
}

/**
 * Turns what the visitor has typed into a moment, or into nothing while it
 * is being typed
 */
function readRow(row) {
  if (!/^\d{4}-\d\d-\d\d$/.test(row.day)) return null;
  const time = /^\d\d:\d\d/.test(row.time) ? row.time.slice(0, 5) : '12:00';
  const moment = parseMoment(`${row.day}T${time}`);
  if (moment && row.offset !== null && row.offset !== undefined) moment.offset = row.offset;
  return moment;
}

/**
 * The second moment of a poster starts a year before the first one: two
 * globes that are the same would look like a mistake.
 */
function getRowBefore(row) {
  const moment = readRow(row) || getMoment();
  const before = parseMoment(`${moment.year - 1}-${pad(moment.month)}-${pad(Math.min(moment.day, 28))}T${pad(moment.hour)}:${pad(moment.minute)}`);
  return getRow(before || getMoment());
}

/**
 * On a sharp screen the tiles have to be twice as detailed
 */
function getScreenDetail() {
  return (window.devicePixelRatio || 1) > 1.25 ? 2 : 1;
}

function saveFile(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 60000);
}

function getFileName(poster) {
  const name = String(poster.title).normalize('NFD').replace(/[^\w ]/g, '').trim().replace(/\s+/g, '-').toLowerCase();
  return `mars-${name || 'poster'}.png`;
}

function formatMeters(value) {
  // A proper minus sign is as wide as a digit
  return (value < 0 ? '−' : '') + Math.round(Math.abs(value)).toLocaleString('en-US') + ' m';
}

function pad(number) {
  return (number < 10 ? '0' : '') + number;
}
</script>

<style lang='stylus' scoped>
primary-action-color = #ff4081;
text-color = #2c3e50;
quiet-color = #6b7882;
panel-width = 380px;

.poster-view {
  position: fixed;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  z-index: 10;
  // The wall where the poster hangs
  background: #2c2c31;
  font-size: 14px;
  color: text-color;
}

.stage {
  position: absolute;
  left: panel-width + 20px;
  right: 0;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.poster {
  position: relative;
  flex: none;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}
.layer {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}
.overlay {
  // The map under the words is the one that is dragged
  pointer-events: none;
}
.poster-map {
  position: absolute;
  // A poster with many pictures is drawn without it. The map keeps its size
  // meanwhile, so it is not removed from the page.
  &.hidden {
    visibility: hidden;
  }
}

.poster-panel {
  position: absolute;
  left: 10px;
  top: 10px;
  width: panel-width;
  max-height: calc(100vh - 20px);
  overflow-y: auto;
  box-sizing: border-box;
  padding: 14px 16px 16px;
  border-radius: 8px;
  background: white;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

.header {
  display: flex;
  align-items: center;
  h3 {
    flex: 1;
    margin: 0;
    font-size: 20px;
    font-weight: 600;
  }
  .close {
    width: 28px;
    height: 28px;
    line-height: 26px;
    text-align: center;
    font-size: 22px;
    color: quiet-color;
    text-decoration: none;
    &:hover {
      color: primary-action-color;
    }
  }
}

.kinds {
  display: flex;
  margin-top: 12px;
  border: 1px solid #d9dde1;
  border-radius: 6px;
  overflow: hidden;
  a {
    flex: 1;
    padding: 7px 0;
    text-align: center;
    text-decoration: none;
    color: text-color;
    &.active {
      background: text-color;
      color: white;
    }
  }
}

.intro {
  margin: 14px 0 12px;
  line-height: 1.45;
  color: quiet-color;
}

.row {
  display: flex;
  align-items: center;
  margin-top: 8px;
  label, .label {
    flex: none;
    width: 64px;
    color: quiet-color;
  }
  input[type='date'], input[type='time'], input[type='text'] {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    height: 34px;
    padding: 0 8px;
    border: 1px solid #d9dde1;
    border-radius: 4px;
    background: white;
    font: inherit;
    color: text-color;
    &:focus {
      outline: none;
      border-color: primary-action-color;
    }
  }
  // The day and the time of a moment share a row
  input.day {
    flex: 1.5;
  }
  input.time {
    margin-left: 6px;
  }
  &.top {
    align-items: flex-start;
    margin-top: 10px;
    .label {
      line-height: 27px;
    }
  }
  &.check {
    margin: 12px 0 4px;
    label {
      width: auto;
      margin-left: 8px;
      color: text-color;
    }
  }
}

.place-search {
  border: 1px solid #d9dde1;
  border-radius: 4px;
}

// A few things to choose from, each is a word or two
.choices {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  a {
    padding: 4px 10px;
    border: 1px solid #d9dde1;
    border-radius: 14px;
    font-size: 13px;
    color: text-color;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
    &:hover {
      border-color: primary-action-color;
      color: primary-action-color;
    }
    &.active {
      border-color: text-color;
      background: text-color;
      color: white;
    }
  }
}
.suggestions {
  margin-top: 10px;
}

// The two things that a poster is made for. They are equally wide, and
// their words change without moving anything around.
.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 18px;
  a {
    box-sizing: border-box;
    height: 38px;
    line-height: 36px;
    padding: 0 8px;
    border: 1px solid primary-action-color;
    border-radius: 4px;
    text-align: center;
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: primary-action-color;
    transition: background-color 0.15s, opacity 0.15s;
    &:hover {
      background: rgba(255, 64, 129, 0.08);
    }
    &.busy {
      opacity: 0.6;
      cursor: default;
    }
  }
  .primary {
    background: primary-action-color;
    color: white;
    &:hover {
      background: darken(primary-action-color, 8%);
    }
    &.busy:hover {
      background: primary-action-color;
    }
  }
  .secondary.busy:hover {
    background: none;
  }
}

// Smaller things to do with the poster
.more {
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
  a {
    color: primary-action-color;
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }
}

.note {
  margin: 12px 0 0;
  padding: 9px 12px;
  border-radius: 6px;
  background: #f3f5f7;
  line-height: 1.45;
  color: quiet-color;
  a {
    color: primary-action-color;
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }
  &.error {
    background: #fdecea;
    color: #b3261e;
  }
}

// On a phone the poster is above, and its options are below
@media (max-width: 700px) {
  .stage {
    left: 0;
    bottom: auto;
    height: 52vh;
  }
  .poster-panel {
    left: 0;
    top: 52vh;
    bottom: 0;
    width: 100%;
    max-height: none;
    border-radius: 12px 12px 0 0;
  }
}
</style>
