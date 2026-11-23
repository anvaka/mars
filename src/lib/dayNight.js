/**
 * Day and night of Mars for the map: a shade over the half of the planet that
 * is turned away from the Sun, and a mark where the Sun is right overhead.
 */
import { addProtocol } from 'maplibre-gl';
import { getMarsTime } from './marsTime.js';

export const NIGHT_SOURCE = 'night';
export const SUN_SOURCE = 'sun';

const DEGREES = Math.PI / 180;
const PROTOCOL = 'night';
// The shade is one small picture of the entire planet. Night has no sharp
// edges, so it can be stretched as much as needed.
const SHADE_SIZE = 256;
const NIGHT_OPACITY = 0.5;
// The shade starts when the Sun is this high (as a sine of its elevation), and
// reaches its full strength when the Sun is this far below the horizon.
const TWILIGHT_START = 0.05;
const TWILIGHT_END = -0.25;

addProtocol(PROTOCOL, request => {
  // "night://time/darkness/zoom/x/y", see `getNightTiles()`
  const [time, darkness] = request.url.slice(PROTOCOL.length + 3).split('/').map(Number);
  return drawNightShade(getMarsTime(new Date(time)), darkness / 100).then(data => ({ data }));
});

/**
 * The shade of the night at the given moment. The `darkness` tells how dark
 * the middle of the night is, from 0 to 1: the map stays readable at night,
 * and a picture of the planet seen from afar does not have to.
 */
export function getNightSource(date = new Date(), darkness = NIGHT_OPACITY) {
  return {
    type: 'raster',
    tiles: [getNightTiles(date, darkness)],
    tileSize: 512,
    minzoom: 0,
    maxzoom: 0
  };
}

export function getSunSource(date = new Date()) {
  return { type: 'geojson', data: getSunPoint(getMarsTime(date)) };
}

/**
 * Moves the shade and the Sun to where they are at the given moment.
 */
export function updateDayNight(map, date = new Date(), darkness = NIGHT_OPACITY) {
  const night = map.getSource(NIGHT_SOURCE);
  if (night) night.setTiles([getNightTiles(date, darkness)]);
  const sun = map.getSource(SUN_SOURCE);
  if (sun) sun.setData(getSunPoint(getMarsTime(date)));
}

function getNightTiles(date, darkness) {
  // The picture is new each time, so is its address:
  return `${PROTOCOL}://${date.getTime()}/${Math.round(darkness * 100)}/{z}/{x}/{y}`;
}

function getSunPoint(marsTime) {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [marsTime.subsolarLongitude, marsTime.subsolarLatitude]
    },
    properties: {}
  };
}

/**
 * Resolves with a PNG image of the web mercator map of the entire planet,
 * which is transparent where it is day and dark where it is night.
 */
function drawNightShade(time, darkness) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SHADE_SIZE;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(SHADE_SIZE, SHADE_SIZE);

  const sinSunLat = Math.sin(time.subsolarLatitude * DEGREES);
  const cosSunLat = Math.cos(time.subsolarLatitude * DEGREES);

  for (let y = 0; y < SHADE_SIZE; ++y) {
    const latitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / SHADE_SIZE)));
    const sinLat = Math.sin(latitude);
    const cosLat = Math.cos(latitude);

    for (let x = 0; x < SHADE_SIZE; ++x) {
      const longitude = (x + 0.5) / SHADE_SIZE * 360 - 180;
      const hourAngle = (longitude - time.subsolarLongitude) * DEGREES;
      // Sine of the Sun's elevation, as it is seen from this place:
      const sunHeight = sinLat * sinSunLat + cosLat * cosSunLat * Math.cos(hourAngle);

      let night = (TWILIGHT_START - sunHeight) / (TWILIGHT_START - TWILIGHT_END);
      night = Math.max(0, Math.min(1, night));
      night = night * night * (3 - 2 * night);
      image.data[(y * SHADE_SIZE + x) * 4 + 3] = Math.round(255 * darkness * night);
    }
  }
  ctx.putImageData(image, 0, 0);

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    .then(blob => blob.arrayBuffer());
}
