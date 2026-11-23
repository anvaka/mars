/**
 * Photos of the land taken from the orbit. The ground view paints the land
 * with them.
 *
 * Just like the elevation (see ./loadTerrainPatch.js), the photos come in
 * levels: square pictures around the viewer, where each next one covers more
 * land with less detail. A level is put together from the tiles of two kinds
 * of maps:
 *
 * - The mosaic of the entire planet made by the Murray Lab at Caltech from
 *   the photos of the Context Camera (CTX). A pixel is 5 meters, and it is
 *   black and white, so we give it a color: the one that the color photos
 *   have nearby, or the color of the dust.
 * - Color mosaics of the HiRISE camera around the rovers, where a pixel is 25
 *   centimeters. These are the maps of NASA's "Where is the rover" pages.
 */
import { ROVERS } from '../lib/rovers.js';
import { createLocalProjection } from './localProjection.js';

/**
 * Number of pixels along the side of every level
 */
export const IMAGERY_SIZE = 1024;

/**
 * `texelSize` is the size of a pixel in meters. The levels marked as detailed
 * make sense only where we have photos that sharp.
 */
export const IMAGERY_LEVELS = [
  { texelSize: 0.25, isDetailed: true }, // 128m in each direction
  { texelSize: 2 },     // 1km
  { texelSize: 16 },    // 8km
  { texelSize: 128 },   // 65km
  { texelSize: 1024 },  // 524km
];

const DEGREES = Math.PI / 180;
const METERS_PER_DEGREE = 59274.7;
// A tile is asked for when its pixel is not larger than this many pixels of the level
const LARGEST_TILE_PIXEL = 1.5;
// We would rather show nothing than ask for hundreds of tiles
const MAX_TILES = 64;
// A tile is drawn as flat pieces, and the planet is not flat. Pieces smaller
// than this many pixels of the level hide the difference.
const PIECE_SIZE = 96;
const MAX_REMEMBERED_TILES = 96;

// How much light an average place reflects. Photos of every place are made
// this bright: their makers did not agree on the brightness.
const AVERAGE_BRIGHTNESS = 0.16;
// The color of the dust: red, green and blue of a place that reflects all
// the light. Counted in the amount of light, not in what a screen shows.
const DUST_HUE = [1.705, 0.853, 0.406];
// Black and white photos of the planet are multiplied by this color. An
// average place becomes as bright and as orange as the dust is.
const TYPICAL_GRAY = 0.216;
const DUST_TINT = DUST_HUE.map(share => share * AVERAGE_BRIGHTNESS / TYPICAL_GRAY);
// Color photos from the orbit show what the land is made of, and their
// colors are far from what an eye would see: sand is blue, rock is white.
// This is how far every color is moved towards the color of the dust.
const WARMTH = 0.5;
// The photos are also stretched to use every shade a screen has, so their
// bright places are much brighter than the land is. A power below one pulls
// everything back towards the average.
const CONTRAST = 0.6;
// The color for a place near color photos is found on a small picture of
// this many pixels
const TINT_PICTURE_SIZE = 128;
// Color photos fade into the black and white ones over this many pixels
// from their edge
const FADE_SIZE = 24;

/**
 * The mosaic of the entire planet. Its tiles are cut along the meridians and
 * the parallels: two square tiles at zoom zero, each is 180 degrees wide.
 */
const PLANET = {
  address: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX1/MapServer/tile/{z}/{y}/{x}',
  tileSize: 512,
  minZoom: 0,
  maxZoom: 12,
  isGray: true,
  // Position on the map, where the side of a zoom zero tile is 1
  getX: longitude => (longitude + 180) / 180,
  getY: latitude => (90 - latitude) / 180,
  getLongitude: x => x * 180 - 180,
  getLatitude: y => 90 - y * 180,
  getPixelSize: (zoom) => 180 * METERS_PER_DEGREE / (512 * Math.pow(2, zoom)),
  getTileAddress(zoom, x, y) {
    const columns = 2 * Math.pow(2, zoom);
    const wrappedX = ((x % columns) + columns) % columns;
    return this.address.replace('{z}', zoom).replace('{x}', wrappedX).replace('{y}', y);
  },
  hasRow: (zoom, y) => y >= 0 && y < Math.pow(2, zoom)
};

// Detailed color photos around the rovers, in web mercator tiles
const detailedSources = [];
Object.keys(ROVERS).forEach(id => {
  ROVERS[id].imagery.filter(imagery => imagery.isDetailed).forEach(imagery => {
    detailedSources.push(createMercatorSource(imagery));
  });
});

const rememberedTiles = new Map();

/**
 * Makes the picture of one level around the place `x, y` (in meters on the
 * sheet of the `projection`, see ./localProjection.js).
 *
 * Resolves with `{canvas, x, y, halfExtent}`, where north is at the top of
 * the canvas. Resolves with `null` when there is nothing to show.
 */
export function loadImageryLevel(projection, levelIndex, x, y) {
  const level = IMAGERY_LEVELS[levelIndex];
  const view = createView(projection, x, y, level.texelSize, IMAGERY_SIZE);

  const [longitude, latitude] = projection.unproject(x, y);
  const detailed = detailedSources.find(source => contains(source.bounds, longitude, latitude));
  if (level.isDetailed && !detailed) return Promise.resolve(null);

  return Promise.all([
    loadTiles(PLANET, view),
    detailed ? loadTiles(detailed, view) : [],
    detailed ? getLook(detailed) : { tint: DUST_TINT, gain: 1 }
  ]).then(([planetTiles, detailedTiles, look]) => {
    if (!planetTiles.some(tile => tile.image) && !detailedTiles.some(tile => tile.image)) return null;

    const ctx = createPicture(view);
    drawTiles(ctx, PLANET, planetTiles, view);
    paint(ctx, look.tint, 0);
    if (detailedTiles.some(tile => tile.image)) {
      const color = createPicture(view);
      drawTiles(color, detailed, detailedTiles, view);
      paint(color, [look.gain, look.gain, look.gain], WARMTH);
      fadeEdges(color);
      ctx.drawImage(color.canvas, 0, 0);
    }

    return { canvas: ctx.canvas, x, y, halfExtent: view.halfExtent };
  });
}

/**
 * Describes a square picture of the land around `x, y`
 */
function createView(projection, x, y, texelSize, size) {
  const halfExtent = texelSize * size / 2;
  return { projection, x, y, texelSize, size, halfExtent, box: getBox(projection, x, y, halfExtent) };
}

function createPicture(view) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = view.size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/**
 * Turns a photo into the picture of how much light the land reflects. The
 * red, green and blue of every pixel are multiplied by the three numbers of
 * the `tint` (this is how a black and white photo gets its color), the color
 * is moved towards the color of the dust (`warmth` tells how far, 0..1), and
 * then the contrast is lowered.
 */
function paint(ctx, tint, warmth) {
  // What a screen shows is not the amount of light, so we go there and back.
  // There are not that many different values, and they can be found in advance.
  const light = new Float32Array(256);
  for (let value = 0; value < 256; ++value) light[value] = toLight(value);
  const STEPS = 2048;
  const BRIGHTEST = 4;
  const softer = new Float32Array(STEPS + 1);
  for (let step = 0; step <= STEPS; ++step) {
    const brightness = step / STEPS * BRIGHTEST;
    softer[step] = brightness > 0 ? Math.pow(brightness / AVERAGE_BRIGHTNESS, CONTRAST - 1) : 0;
  }
  const screen = new Uint8ClampedArray(STEPS + 1);
  for (let step = 0; step <= STEPS; ++step) screen[step] = toScreen(step / STEPS);

  const { width, height } = ctx.canvas;
  const picture = ctx.getImageData(0, 0, width, height);
  const pixels = picture.data;
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    let red = light[pixels[i]] * tint[0];
    let green = light[pixels[i + 1]] * tint[1];
    let blue = light[pixels[i + 2]] * tint[2];
    const brightness = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    red += (brightness * DUST_HUE[0] - red) * warmth;
    green += (brightness * DUST_HUE[1] - green) * warmth;
    blue += (brightness * DUST_HUE[2] - blue) * warmth;
    const share = softer[Math.min(STEPS, Math.round(brightness / BRIGHTEST * STEPS))] * STEPS;
    pixels[i] = screen[Math.min(STEPS, Math.round(red * share))];
    pixels[i + 1] = screen[Math.min(STEPS, Math.round(green * share))];
    pixels[i + 2] = screen[Math.min(STEPS, Math.round(blue * share))];
  }
  ctx.putImageData(picture, 0, 0);
}

/**
 * Makes the picture more transparent towards the places where it has
 * nothing. The side of the picture itself does not count: the land goes on
 * there, we just did not draw it.
 */
function fadeEdges(ctx) {
  const size = ctx.canvas.width;
  const picture = ctx.getImageData(0, 0, size, size);
  const pixels = picture.data;

  // Number of pixels that have something, above and to the left of each
  // pixel. With it we can count them in any rectangle.
  const stride = size + 1;
  const counts = new Uint32Array(stride * stride);
  let isFull = true;
  for (let row = 0; row < size; ++row) {
    let rowCount = 0;
    for (let col = 0; col < size; ++col) {
      if (pixels[(row * size + col) * 4 + 3] > 127) rowCount += 1;
      else isFull = false;
      counts[(row + 1) * stride + col + 1] = counts[row * stride + col + 1] + rowCount;
    }
  }
  if (isFull) return;

  for (let row = 0; row < size; ++row) {
    const top = Math.max(row - FADE_SIZE, 0);
    const bottom = Math.min(row + FADE_SIZE + 1, size);
    for (let col = 0; col < size; ++col) {
      const index = (row * size + col) * 4 + 3;
      if (!pixels[index]) continue;

      const left = Math.max(col - FADE_SIZE, 0);
      const right = Math.min(col + FADE_SIZE + 1, size);
      const count = counts[bottom * stride + right] - counts[top * stride + right] -
        counts[bottom * stride + left] + counts[top * stride + left];
      // Half of the pixels around a pixel at the very edge are empty
      const share = Math.min(1, Math.max(0, 2 * count / ((bottom - top) * (right - left)) - 1));
      pixels[index] *= share * share * (3 - 2 * share);
    }
  }
  ctx.putImageData(picture, 0, 0);
}

/**
 * Tells how to make the photos around the `source` of color photos look the
 * same: `gain` is what the color photos are multiplied by to get the average
 * brightness, and `tint` is the color for the black and white photos of the
 * planet that makes them look like the color ones.
 *
 * To find it the same place is drawn from both, and the averages are
 * compared. This way the land does not change its color where the color
 * photos end.
 */
function getLook(source) {
  if (!source.look) {
    const [west, south, east, north] = source.bounds;
    const projection = createLocalProjection((west + east) / 2, (south + north) / 2);
    const [right, top] = projection.project(east, north);
    const view = createView(projection, 0, 0, 2 * Math.max(right, top) / TINT_PICTURE_SIZE, TINT_PICTURE_SIZE);

    source.look = Promise.all([loadTiles(PLANET, view), loadTiles(source, view)]).then(layers => {
      const [gray, color] = [PLANET, source].map((layerSource, index) => {
        const ctx = createPicture(view);
        drawTiles(ctx, layerSource, layers[index], view);
        return ctx.getImageData(0, 0, view.size, view.size).data;
      });

      const sum = [0, 0, 0];
      let graySum = 0;
      let count = 0;
      for (let i = 0; i < gray.length; i += 4) {
        // Only the places that both pictures have
        if (gray[i + 3] < 255 || color[i + 3] < 255) continue;
        count += 1;
        graySum += toLight(gray[i]);
        for (let channel = 0; channel < 3; ++channel) sum[channel] += toLight(color[i + channel]);
      }
      if (!count || !graySum) return { tint: DUST_TINT, gain: 1 };

      const brightness = (0.2126 * sum[0] + 0.7152 * sum[1] + 0.0722 * sum[2]) / count;
      const gain = Math.min(2, Math.max(0.3, AVERAGE_BRIGHTNESS / brightness));
      // The same warmth that the color photos get in paint()
      const tint = sum.map((value, channel) => {
        const average = value / count;
        return gain * (average + (brightness * DUST_HUE[channel] - average) * WARMTH) * count / graySum;
      });
      return { gain, tint };
    });
  }
  return source.look;
}

// From what a pixel stores (0..255) to the amount of light (0..1), and back
function toLight(value) {
  const share = value / 255;
  return share <= 0.04045 ? share / 12.92 : Math.pow((share + 0.055) / 1.055, 2.4);
}

function toScreen(light) {
  const share = light <= 0.0031308 ? light * 12.92 : 1.055 * Math.pow(light, 1 / 2.4) - 0.055;
  return Math.round(255 * Math.min(1, share));
}

/**
 * Gives [west, south, east, north] of a square on the sheet. The longitudes
 * are counted from the center of the square, so the west is always smaller
 * than the east.
 */
function getBox(projection, x, y, halfExtent) {
  const center = projection.unproject(x, y)[0];
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (let row = -2; row <= 2; ++row) {
    for (let col = -2; col <= 2; ++col) {
      const [longitude, latitude] = projection.unproject(x + col * halfExtent / 2, y + row * halfExtent / 2);
      const unwrapped = center + ((longitude - center + 540) % 360) - 180;
      west = Math.min(west, unwrapped);
      east = Math.max(east, unwrapped);
      south = Math.min(south, latitude);
      north = Math.max(north, latitude);
    }
  }
  return [west, south, east, north];
}

function contains(bounds, longitude, latitude) {
  return longitude > bounds[0] && longitude < bounds[2] && latitude > bounds[1] && latitude < bounds[3];
}

/**
 * Resolves with the tiles of the source that the view needs:
 * [{zoom, x, y, image}]. The image is missing when the tile is.
 */
function loadTiles(source, view) {
  let [west, south, east, north] = view.box;
  if (source.bounds) {
    west = Math.max(west, source.bounds[0]);
    south = Math.max(south, source.bounds[1]);
    east = Math.min(east, source.bounds[2]);
    north = Math.min(north, source.bounds[3]);
    if (west >= east || south >= north) return Promise.resolve([]);
  }

  const latitude = (south + north) / 2;
  let zoom = source.minZoom;
  while (zoom < source.maxZoom && source.getPixelSize(zoom, latitude) > view.texelSize * LARGEST_TILE_PIXEL) zoom += 1;

  const scale = Math.pow(2, zoom);
  const firstX = Math.floor(source.getX(west) * scale);
  const lastX = Math.floor(source.getX(east) * scale);
  const firstY = Math.floor(source.getY(north) * scale);
  const lastY = Math.floor(source.getY(south) * scale);
  if ((lastX - firstX + 1) * (lastY - firstY + 1) > MAX_TILES) return Promise.resolve([]);

  const requests = [];
  for (let y = firstY; y <= lastY; ++y) {
    if (!source.hasRow(zoom, y)) continue;
    for (let x = firstX; x <= lastX; ++x) {
      requests.push(loadImage(source.getTileAddress(zoom, x, y)).then(image => ({ zoom, x, y, image })));
    }
  }
  return Promise.all(requests);
}

function drawTiles(ctx, source, tiles, view) {
  tiles.forEach(tile => {
    if (tile.image) drawTile(ctx, source, tile, view);
  });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 * Draws a tile where it belongs on the picture
 */
function drawTile(ctx, source, tile, view) {
  const scale = Math.pow(2, tile.zoom);
  const size = source.tileSize;
  const tileOnPicture = source.getPixelSize(tile.zoom, view.box[1]) * size / view.texelSize;
  const pieces = Math.max(1, Math.min(8, Math.ceil(tileOnPicture / PIECE_SIZE)));
  const step = size / pieces;

  for (let row = 0; row < pieces; ++row) {
    for (let col = 0; col < pieces; ++col) {
      const corner = getPlaceOnPicture(source, view, (tile.x + col / pieces) / scale, (tile.y + row / pieces) / scale);
      const right = getPlaceOnPicture(source, view, (tile.x + (col + 1) / pieces) / scale, (tile.y + row / pieces) / scale);
      const bottom = getPlaceOnPicture(source, view, (tile.x + col / pieces) / scale, (tile.y + (row + 1) / pieces) / scale);
      // Is the piece on the picture at all?
      const farthest = view.size + Math.abs(right[0] - corner[0]) + Math.abs(bottom[1] - corner[1]);
      if (Math.abs(corner[0] - view.size / 2) > farthest || Math.abs(corner[1] - view.size / 2) > farthest) continue;

      ctx.setTransform(
        (right[0] - corner[0]) / step, (right[1] - corner[1]) / step,
        (bottom[0] - corner[0]) / step, (bottom[1] - corner[1]) / step,
        corner[0], corner[1]
      );
      // The pieces overlap by a part of a pixel, otherwise thin lines are
      // left between them
      const overlap = 0.5;
      ctx.drawImage(tile.image, col * step, row * step, step, step, -overlap, -overlap, step + 2 * overlap, step + 2 * overlap);
    }
  }
}

/**
 * `mapX, mapY` is a position on the map of the source. Gives the pixel of
 * the picture where that place is.
 */
function getPlaceOnPicture(source, view, mapX, mapY) {
  const [x, y] = view.projection.project(source.getLongitude(mapX), source.getLatitude(mapY));
  return [
    (x - view.x) / view.texelSize + view.size / 2,
    view.size / 2 - (y - view.y) / view.texelSize
  ];
}

/**
 * `imagery` is a record of ../lib/rovers.js
 */
function createMercatorSource(imagery) {
  return {
    tileSize: 256,
    minZoom: imagery.minzoom,
    maxZoom: imagery.maxzoom,
    bounds: imagery.bounds,
    isGray: false,
    // Position on the map, where the side of a zoom zero tile is 1
    getX: longitude => (longitude + 180) / 360,
    getY: latitude => {
      const sine = Math.sin(latitude * DEGREES);
      return 0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI);
    },
    getLongitude: x => x * 360 - 180,
    getLatitude: y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / DEGREES,
    getPixelSize: (zoom, latitude) => 360 * METERS_PER_DEGREE * Math.cos(latitude * DEGREES) / (256 * Math.pow(2, zoom)),
    getTileAddress(zoom, x, y) {
      // NASA counts rows of tiles from the South
      const row = Math.pow(2, zoom) - 1 - y;
      return imagery.tiles.replace('{z}', zoom).replace('{x}', x).replace('{y}', row);
    },
    hasRow: (zoom, y) => y >= 0 && y < Math.pow(2, zoom)
  };
}

/**
 * Resolves with the picture, or with `null` when it cannot be loaded
 */
function loadImage(address) {
  let request = rememberedTiles.get(address);
  // the tile goes to the end of the line of those who are to be forgotten
  rememberedTiles.delete(address);
  if (!request) {
    request = new Promise(resolve => {
      const image = new Image();
      // Without it the video card is not allowed to have the picture
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => {
        rememberedTiles.delete(address);
        resolve(null);
      };
      image.src = address;
    });
  }
  rememberedTiles.set(address, request);
  if (rememberedTiles.size > MAX_REMEMBERED_TILES) rememberedTiles.delete(rememberedTiles.keys().next().value);
  return request;
}
