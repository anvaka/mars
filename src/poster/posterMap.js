/**
 * The maps inside of a poster: how the one that the visitor can turn is
 * made, how the globe is measured and sized, and how the pictures of the
 * maps are drawn, for print and for a poster that has many of them.
 */
import { Map as MapLibreMap } from 'maplibre-gl';
import { provideMissionIcons } from '../lib/missionIcons.js';
import { getPosterStyle } from './posterStyle.js';

const DEGREES = Math.PI / 180;
// The largest picture a browser is sure to draw
export const LARGEST_CANVAS = 4096;
// A tile may be stretched this many times before the picture gets soft
const LARGEST_STRETCH = 1.5;
const MOST_DETAILED_TILES = 8;
// How long a picture may take to draw, in milliseconds
const LONGEST_RENDERING = 120000;

/**
 * @param {HTMLElement} container
 * @param {Object} style - see ./posterStyle.js
 * @param {Object} [options] - more options for the map
 */
export function createPosterMap(container, style, options = {}) {
  const map = new MapLibreMap({
    container,
    style,
    // The globe of a small poster is smaller than the map allows by default
    minZoom: -1,
    attributionControl: false,
    // The picture is turned by its author, not by an accident
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    maxCanvasSize: [LARGEST_CANVAS, LARGEST_CANVAS],
    ...options
  });
  map.touchZoomRotate.disableRotation();
  provideMissionIcons(map);
  return map;
}

/**
 * Tells where the globe is on the screen: `{x, y, radius}` in pixels of the
 * map container.
 *
 * The map looks at the globe from a finite distance, so its edge is not
 * where the points that are 90 degrees away from the center are, and the map
 * does not tell where it is. We find it from two points with known
 * positions: a point of the sphere that is `angle` away from the center is
 * seen at `D * r * sin(angle) / (D + r - r * cos(angle))` pixels from it,
 * where `r` is the radius of the sphere and `D` is the distance from the eye
 * to its closest point. Two points give both numbers.
 */
export function measureGlobe(map) {
  const center = map.getCenter();
  // Both points have to be on the globe, so we go away from the closer pole
  const direction = center.lat >= 0 ? -1 : 1;
  const middle = map.project(center);
  const near = getDistance(map.project([center.lng, center.lat + direction * 30]), middle);
  const far = getDistance(map.project([center.lng, center.lat + direction * 60]), middle);

  const sin1 = Math.sin(30 * DEGREES);
  const cos1 = Math.cos(30 * DEGREES);
  const sin2 = Math.sin(60 * DEGREES);
  const cos2 = Math.cos(60 * DEGREES);
  const sphere = near * far * (cos2 - cos1) / (near * (1 - cos1) * sin2 - far * (1 - cos2) * sin1);
  const eye = near * sphere * (1 - cos1) / (sphere * sin1 - near);
  // From very far the edge is where the sphere ends
  const radius = eye > 0 && Number.isFinite(eye) ? eye * sphere / Math.sqrt(eye * eye + 2 * eye * sphere) : sphere;

  return { x: middle.x, y: middle.y, radius };
}

/**
 * Zooms the map so that the globe gets the given radius, in pixels.
 */
export function fitGlobe(map, radius) {
  for (let i = 0; i < 8; ++i) {
    const globe = measureGlobe(map);
    if (!(globe.radius > 0) || Math.abs(globe.radius / radius - 1) < 0.001) return;
    map.jumpTo({ zoom: map.getZoom() + Math.log2(radius / globe.radius) });
  }
}

/**
 * Draws the maps of a poster, one after another. The same hidden map draws
 * them all: a browser allows only a handful of maps on a page, and a poster
 * may have thirty.
 *
 * @param {Object} demSource - elevation of Mars, see ../tiles.js
 * @param {Array} pictures - what to draw. Each is an object with:
 *   - `frame` - `{width, height}` of the picture, in the units of the poster;
 *   - `content` - what the map shows, see ./posterStyle.js;
 *   - `aim(map, mapScale)` - turns the map to what the picture is about.
 * @param {Object} options
 * @param {Number} options.mapScale - how many pixels of the hidden map a unit
 * of the poster takes. Names and lines of a map do not grow with the
 * picture, so this is what decides how large they are next to the land.
 * @param {Number} options.pictureScale - how many pixels of the picture a
 * unit of the poster takes
 * @param {Function} options.onPicture - called with `(canvas, index)` when a
 * picture is drawn. The canvas is of the map, and is good only during the call.
 * @param {Function} [options.isStopped] - returns true when the pictures are
 * not needed anymore
 *
 * Resolves when everything is drawn, or when it was stopped.
 */
export function renderPictures(demSource, pictures, options) {
  const { mapScale, pictureScale, onPicture } = options;
  const isStopped = options.isStopped || (() => false);
  if (!pictures.length) return Promise.resolve();

  const container = document.createElement('div');
  // The map has to be a part of the page to be drawn, yet nobody should see it
  container.style.cssText = 'position: fixed; left: -100000px; top: 0;';
  document.body.appendChild(container);
  // The frame that the map has the size of
  let size;
  setSize(pictures[0].frame);

  const scale = pictureScale / mapScale;
  // The larger the picture, the more detailed tiles it needs
  const detail = Math.min(MOST_DETAILED_TILES, Math.pow(2, Math.max(0, Math.ceil(Math.log2(scale / LARGEST_STRETCH)))));
  // The browser gives the container a whole number of pixels. On a small
  // screen that half of a pixel, taken this many times larger, gets the
  // picture over the limit, and the map would draw it less sharp than asked.
  const largest = Math.max(...pictures.map(picture => Math.max(picture.frame.width, picture.frame.height)));
  const pixelRatio = Math.min(scale, (LARGEST_CANVAS - 1) / Math.ceil(largest * mapScale));
  const map = createPosterMap(container, getPosterStyle(demSource, pictures[0].content, detail), {
    interactive: false,
    pixelRatio,
    // A globe of a poster with many of them is small
    minZoom: -2,
    fadeDuration: 0,
    // Otherwise the picture is gone before we copy it
    canvasContextAttributes: { preserveDrawingBuffer: true }
  });

  return new Promise((resolve, reject) => {
    let index = 0;
    let timer;
    let isDone = false;
    map.on('error', e => console.warn('The map of the poster has a problem', e.error || e));
    map.once('load', draw);
    watch();

    function draw() {
      if (isDone) return;
      if (isStopped()) return finish();

      const picture = pictures[index];
      if (index > 0) {
        if (setSize(picture.frame)) map.resize();
        map.setStyle(getPosterStyle(demSource, picture.content, detail));
      }
      picture.aim(map, mapScale);
      // If the picture is the same as the last one, the map has nothing to
      // draw, and would never tell us that it is ready
      map.triggerRepaint();
      watch();
      // The tiles of the labels and of the shade may still be on their way
      map.once('idle', () => {
        if (isDone) return;
        if (isStopped()) return finish();

        map.redraw();
        try {
          onPicture(map.getCanvas(), index);
        } catch (e) {
          return finish(e);
        }
        index += 1;
        if (index < pictures.length) draw();
        else finish();
      });
    }

    // A picture loads hundreds of tiles. If it takes too long, something went wrong.
    function watch() {
      clearTimeout(timer);
      timer = setTimeout(() => finish(new Error('The picture took too long to draw')), LONGEST_RENDERING);
    }

    function finish(error) {
      if (isDone) return;
      isDone = true;
      clearTimeout(timer);
      map.remove();
      container.remove();
      if (error) reject(error);
      else resolve();
    }
  });

  /**
   * Returns true if the size of the map had to be changed
   */
  function setSize(frame) {
    if (size && size.width === frame.width && size.height === frame.height) return false;
    size = frame;
    container.style.width = frame.width * mapScale + 'px';
    container.style.height = frame.height * mapScale + 'px';
    return true;
  }
}

function getDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
