/**
 * Shades the land the way the Sun lights it right now.
 *
 * A regular shaded relief has a lamp that always shines from the top left
 * corner of the map. That is fine for a flat map, but on the globe we show
 * where the Sun is, and a mountain with a shadow that points to the Sun looks
 * wrong. So here every pixel is lit from the direction where the Sun is seen
 * from that very place: slopes get long shadows at dawn and at dusk, and lose
 * them at noon.
 *
 * The shade is a set of half transparent pictures that lie over the colors of
 * the map. We draw them in the browser from the same elevation tiles, and
 * draw them again when the Sun moves.
 */
import { addProtocol } from 'maplibre-gl';
import { getMarsTime } from './marsTime.js';
import { loadTileElevation, ELEVATION_TILE_SIZE } from './elevationTiles.js';
import { getDemTileMaxZoom } from '../tiles.js';

export const SUN_RELIEF_SOURCE = 'sun-relief';

const PROTOCOL = 'sunrelief';
const DEGREES = Math.PI / 180;
const MARS_CIRCUMFERENCE = 2 * Math.PI * 3396190;

// The Sun moves a quarter of a degree per minute. We redraw the shade when it
// has moved by this many degrees.
const REDRAW_AFTER = 1;

// How much light a flat land gets from the sky, compared to what it gets
// from the Sun at noon. This is what we see in the shadows and at night.
const SKY_LIGHT = 0.35;
// The Sun does not turn off at the horizon: the slopes that face it catch the
// light a bit longer. This is the sine of the elevation where they stop.
const LAST_LIGHT = -0.08;

// Slopes that got less light than the flat land are painted with the first
// color, the others with the second one. Both are warm, so that the land does
// not turn gray.
const SHADOW_COLOR = [34, 10, 4];
const LIGHT_COLOR = [255, 232, 196];
const SHADOW_STRENGTH = 0.9;
const LIGHT_STRENGTH = 0.55;

addProtocol(PROTOCOL, request => {
  // "sunrelief://time/zoom/x/y"
  const [time, zoom, x, y] = request.url.slice(PROTOCOL.length + 3).split('/').map(Number);
  return drawTile(zoom, x, y, getSun(new Date(time))).then(data => ({ data }));
});

/**
 * The shade of the slopes at the given moment. Tiles are drawn `tileSize`
 * pixels wide: a picture for print asks for a smaller one, and gets tiles
 * that are more detailed.
 */
export function getSunReliefSource(date = new Date(), tileSize = ELEVATION_TILE_SIZE) {
  return {
    type: 'raster',
    tiles: [getTiles(date)],
    tileSize,
    minzoom: 0,
    maxzoom: getDemTileMaxZoom()
  };
}

/**
 * Draws the shade again if the Sun has moved since the last time. Pass
 * `force` to draw it no matter what.
 */
export function updateSunRelief(map, date = new Date(), force = false) {
  const source = map.getSource(SUN_RELIEF_SOURCE);
  // The source learns its tiles when it is loaded
  if (!source || !source.tiles) return;

  // The address of the tiles tells where the Sun was when they were drawn
  const drawnAt = Number(source.tiles[0].slice(PROTOCOL.length + 3).split('/')[0]);
  const sun = getSun(new Date(drawnAt));
  const now = getSun(date);
  const cosine = now.sinLat * sun.sinLat +
    now.cosLat * sun.cosLat * Math.cos(now.longitude - sun.longitude);
  if (!force && cosine > Math.cos(REDRAW_AFTER * DEGREES)) return;

  source.setTiles([getTiles(date)]);
}

function getTiles(date) {
  // The pictures are new each time, so are their addresses:
  return `${PROTOCOL}://${date.getTime()}/{z}/{x}/{y}`;
}

// The same Sun shades hundreds of tiles
let lastSun;

function getSun(date) {
  if (lastSun && lastSun.time === date.getTime()) return lastSun;

  const time = getMarsTime(date);
  const latitude = time.subsolarLatitude * DEGREES;
  lastSun = {
    time: date.getTime(),
    longitude: time.subsolarLongitude * DEGREES,
    sinLat: Math.sin(latitude),
    cosLat: Math.cos(latitude)
  };
  return lastSun;
}

function drawTile(zoom, x, y, sun) {
  return loadTileElevation(zoom, x, y).then(heights => {
    // Without a picture the map keeps the shade of a less detailed tile,
    // which is better than a hole in the shade.
    if (!heights) throw new Error(`No elevation to shade ${zoom}/${x}/${y}`);

    const image = new ImageData(ELEVATION_TILE_SIZE, ELEVATION_TILE_SIZE);
    shade(image.data, heights, zoom, x, y, sun);
    return createImageBitmap(image);
  });
}

function shade(pixels, heights, zoom, tileX, tileY, sun) {
  const size = ELEVATION_TILE_SIZE;
  const tilesInRow = Math.pow(2, zoom);
  const exaggeration = getExaggeration(zoom);

  // Longitude is the same for the entire column of pixels, so we find where
  // the Sun is relative to each column only once.
  const sinHourAngle = new Float32Array(size);
  const cosHourAngle = new Float32Array(size);
  for (let x = 0; x < size; ++x) {
    const longitude = ((tileX + (x + 0.5) / size) / tilesInRow) * 2 * Math.PI - Math.PI;
    sinHourAngle[x] = Math.sin(sun.longitude - longitude);
    cosHourAngle[x] = Math.cos(sun.longitude - longitude);
  }

  for (let y = 0; y < size; ++y) {
    const latitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * (tileY + (y + 0.5) / size) / tilesInRow)));
    const sinLat = Math.sin(latitude);
    const cosLat = Math.cos(latitude);
    // Pixels of the map get smaller towards the poles
    const pixelSize = MARS_CIRCUMFERENCE * cosLat / (tilesInRow * size);
    const slopeScale = exaggeration / pixelSize;

    const above = Math.max(y - 1, 0) * size;
    const below = Math.min(y + 1, size - 1) * size;
    const rows = (below - above) / size;

    for (let x = 0; x < size; ++x) {
      const left = Math.max(x - 1, 0);
      const right = Math.min(x + 1, size - 1);
      // How fast the land rises towards the East and towards the North:
      const slopeEast = (heights[y * size + right] - heights[y * size + left]) / (right - left) * slopeScale;
      const slopeNorth = (heights[above + x] - heights[below + x]) / rows * slopeScale;
      // The vertical part of the unit vector that sticks out of the slope.
      // The other two parts are `-slopeEast * normalUp` and `-slopeNorth * normalUp`
      const normalUp = 1 / Math.sqrt(1 + slopeEast * slopeEast + slopeNorth * slopeNorth);

      // Direction to the Sun as it is seen from this place:
      const sunEast = sun.cosLat * sinHourAngle[x];
      const sunNorth = sun.sinLat * cosLat - sun.cosLat * sinLat * cosHourAngle[x];
      const sunUp = sun.sinLat * sinLat + sun.cosLat * cosLat * cosHourAngle[x];

      // How much of the sunlight the slope catches, and how much the flat
      // land at the same place would:
      const facing = (sunUp - slopeEast * sunEast - slopeNorth * sunNorth) * normalUp;
      const daylight = smoothStep(LAST_LIGHT, -LAST_LIGHT, sunUp);
      const onSlope = SKY_LIGHT * normalUp + daylight * Math.max(0, facing);
      const onFlat = SKY_LIGHT + Math.max(0, sunUp);
      const ratio = onSlope / onFlat;

      const offset = (y * size + x) * 4;
      const color = ratio < 1 ? SHADOW_COLOR : LIGHT_COLOR;
      const opacity = ratio < 1 ? SHADOW_STRENGTH * (1 - ratio) : LIGHT_STRENGTH * (1 - 1 / ratio);
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = Math.round(255 * opacity);
    }
  }
}

/**
 * Real slopes of Mars are gentle: flanks of the largest volcano rise by five
 * degrees. Seen from space they would cast no visible shade at all, so we make
 * the land taller than it is, and the more so the farther we look from.
 */
function getExaggeration(zoom) {
  return 2.3 * Math.pow(2, (8 - zoom) * 0.4);
}

function smoothStep(from, to, value) {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}
