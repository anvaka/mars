/**
 * Loads elevation of the land around a point, so that we can stand there and
 * look around.
 *
 * Mountains are visible from hundreds of kilometers, but only the land nearby
 * needs to be detailed. So the terrain is stored as several square images of
 * elevation ("levels"). Each next level covers larger area with larger pixels.
 *
 * The first levels are so detailed that only a few places of Mars have such
 * data (see ../lib/detailedElevation.js). Elsewhere they stay empty.
 *
 * Every level is drawn in the local projection, see ./localProjection.js
 */
import { getDemTileMaxZoom } from '../tiles.js';
import { loadTileElevation, ELEVATION_TILE_SIZE } from '../lib/elevationTiles.js';
import { DETAILED_TILE_SIZE } from '../lib/detailedElevation.js';
import { MARS_RADIUS } from './localProjection.js';

const DEGREES = Math.PI / 180;
const MARS_CIRCUMFERENCE = 2 * Math.PI * MARS_RADIUS;
const MAX_MERCATOR_LATITUDE = 85.0511287798;

// The elevation model of the planet has one sample per this many meters,
// there is no point in asking for tiles more detailed than that
const SOURCE_RESOLUTION = 200;
const SOURCE_MAX_ZOOM = 9;

// To tell a hollow from a hilltop we compare a place with the land this many
// pixels around it
const HOLLOW_RADII = [2, 8];

/**
 * `size` is the number of pixels along the side of a level, `texelSize` is the
 * size of a pixel in meters. Ordered from the most detailed one.
 */
export const PATCH_LEVELS = [
  { size: 1024, texelSize: 2.5, isDetailed: true },  // 1.3km in each direction
  { size: 1024, texelSize: 10, isDetailed: true },   // 5km
  { size: 1024, texelSize: 40, isDetailed: true },   // 20km
  { size: 1024, texelSize: 160 },  // 82km
  { size: 512, texelSize: 640 },   // 164km
  { size: 512, texelSize: 2560 },  // 655km
];

export const LARGEST_LEVEL_SIZE = 1024;

/**
 * The elevation tiles do not reach the poles
 */
export const MAX_GROUND_LATITUDE = 82;

/**
 * Loads one level of the patch. The options are:
 *
 * - `x`, `y` - where the center of the level is on the patch, in meters.
 *   The center of the patch by default.
 * - `area` - the detailed area to take the elevation from (see
 *   ../lib/detailedElevation.js). Otherwise it comes from the tiles of the
 *   entire planet.
 * - `getKnownHeight(x, y)` - gives elevation of a place that the area does
 *   not have.
 *
 * Resolves with
 *
 * - `heights` - elevation in meters, `size * size` values. The first row is
 *   the southernmost one, the first value in a row is the westernmost one.
 * - `slopes` - four values per pixel: how fast the elevation grows towards
 *   the East and towards the North, how deep the place sits below the land
 *   around it (see `getHollows()`), and a spare one.
 * - `min`, `max` - range of the elevation
 * - `x`, `y`, `halfExtent` - where the level is on the patch
 */
export function loadPatchLevel(projection, levelIndex, options = {}) {
  const { size, texelSize } = PATCH_LEVELS[levelIndex];
  const { area, getKnownHeight } = options;
  const levelX = options.x || 0;
  const levelY = options.y || 0;

  const tileSize = area ? DETAILED_TILE_SIZE : ELEVATION_TILE_SIZE;
  const zoom = area ? getDetailedZoom(projection.latitude, texelSize, area) : getTileZoom(projection.latitude, texelSize);
  const loadTile = area ? area.loadTile : loadTileElevation;
  const worldSize = tileSize * Math.pow(2, zoom);
  const tilesInRow = Math.pow(2, zoom);

  // First we find where each pixel of the level is on the tiles
  const count = size * size;
  const tileX = new Float64Array(count);
  const tileY = new Float64Array(count);
  const centerX = (projection.longitude + 180) / 360 * worldSize;

  const lonLat = [0, 0];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let row = 0; row < size; ++row) {
    const y = levelY + (row + 0.5 - size / 2) * texelSize;
    for (let col = 0; col < size; ++col) {
      const x = levelX + (col + 0.5 - size / 2) * texelSize;
      projection.unproject(x, y, lonLat);
      const longitude = lonLat[0];
      const latitude = lonLat[1];

      // Longitude wraps around the planet. We count from the center of the
      // patch, to keep neighbors together.
      let dLon = longitude - projection.longitude;
      if (dLon > 180) dLon -= 360;
      if (dLon < -180) dLon += 360;
      const px = centerX + dLon / 360 * worldSize;
      const py = getMercatorY(latitude) * worldSize;

      const index = row * size + col;
      tileX[index] = px;
      tileY[index] = py;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }

  // Each sample is a mix of four pixels around it, thus half a pixel margin:
  const firstTileX = Math.floor((minX - 0.5) / tileSize);
  const lastTileX = Math.floor((maxX + 0.5) / tileSize);
  const firstTileY = Math.max(0, Math.floor((minY - 0.5) / tileSize));
  const lastTileY = Math.min(tilesInRow - 1, Math.floor((maxY + 0.5) / tileSize));
  const columns = lastTileX - firstTileX + 1;
  const rows = lastTileY - firstTileY + 1;

  const mosaicWidth = columns * tileSize;
  const mosaicHeight = rows * tileSize;
  const mosaic = new Float32Array(mosaicWidth * mosaicHeight);
  // A missing tile of the planet stays flat. A missing tile of a detailed
  // area is filled from the less detailed levels.
  if (area) mosaic.fill(NaN);

  const requests = [];
  let tilesCount = 0;
  for (let ty = 0; ty < rows; ++ty) {
    for (let tx = 0; tx < columns; ++tx) {
      const wrappedX = (((firstTileX + tx) % tilesInRow) + tilesInRow) % tilesInRow;
      requests.push(loadTile(zoom, wrappedX, firstTileY + ty).then(elevation => {
        if (!elevation) return;
        tilesCount += 1;
        for (let y = 0; y < tileSize; ++y) {
          const from = y * tileSize;
          mosaic.set(elevation.subarray(from, from + tileSize), (ty * tileSize + y) * mosaicWidth + tx * tileSize);
        }
      }));
    }
  }

  return Promise.all(requests).then(() => {
    const heights = new Float32Array(count);
    const offsetX = firstTileX * tileSize + 0.5;
    const offsetY = firstTileY * tileSize + 0.5;
    let min = Infinity, max = -Infinity;

    for (let i = 0; i < count; ++i) {
      const fx = clamp(tileX[i] - offsetX, 0, mosaicWidth - 1);
      const fy = clamp(tileY[i] - offsetY, 0, mosaicHeight - 1);
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(x0 + 1, mosaicWidth - 1);
      const y1 = Math.min(y0 + 1, mosaicHeight - 1);
      const wx = fx - x0;
      const wy = fy - y0;

      const top = mosaic[y0 * mosaicWidth + x0] * (1 - wx) + mosaic[y0 * mosaicWidth + x1] * wx;
      const bottom = mosaic[y1 * mosaicWidth + x0] * (1 - wx) + mosaic[y1 * mosaicWidth + x1] * wx;
      let height = top * (1 - wy) + bottom * wy;
      if (height !== height) {
        // Not a number: the area ends here
        const col = i % size;
        const row = (i - col) / size;
        height = getKnownHeight ?
          getKnownHeight(levelX + (col + 0.5 - size / 2) * texelSize, levelY + (row + 0.5 - size / 2) * texelSize) : 0;
      }

      heights[i] = height;
      if (height < min) min = height;
      if (height > max) max = height;
    }

    return {
      index: levelIndex,
      size,
      texelSize,
      halfExtent: size * texelSize / 2,
      x: levelX,
      y: levelY,
      heights,
      slopes: getSlopes(heights, size, texelSize),
      min,
      max,
      tilesCount
    };
  });
}

/**
 * Gives elevation at `x, y` of a loaded level. The coordinates are in meters
 * from the center of the patch.
 */
export function sampleLevel(level, x, y) {
  const { size, heights } = level;
  const fx = clamp((x - level.x) / level.texelSize + size / 2 - 0.5, 0, size - 1);
  const fy = clamp((y - level.y) / level.texelSize + size / 2 - 0.5, 0, size - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, size - 1);
  const y1 = Math.min(y0 + 1, size - 1);
  const wx = fx - x0;
  const wy = fy - y0;

  const bottom = heights[y0 * size + x0] * (1 - wx) + heights[y0 * size + x1] * wx;
  const top = heights[y1 * size + x0] * (1 - wx) + heights[y1 * size + x1] * wx;
  return bottom * (1 - wy) + top * wy;
}

/**
 * Tells if the place is on the level, and not at its very edge, where the
 * shaders already take the elevation from the next level.
 */
export function isInsideLevel(level, x, y) {
  const margin = level.halfExtent - 24 * level.texelSize;
  return Math.abs(x - level.x) < margin && Math.abs(y - level.y) < margin;
}

function getSlopes(heights, size, texelSize) {
  const hollows = getHollows(heights, size, texelSize);
  const slopes = new Float32Array(size * size * 4);
  for (let row = 0; row < size; ++row) {
    const south = Math.max(row - 1, 0);
    const north = Math.min(row + 1, size - 1);
    for (let col = 0; col < size; ++col) {
      const west = Math.max(col - 1, 0);
      const east = Math.min(col + 1, size - 1);
      const index = (row * size + col) * 4;
      slopes[index] = (heights[row * size + east] - heights[row * size + west]) / ((east - west) * texelSize);
      slopes[index + 1] = (heights[north * size + col] - heights[south * size + col]) / ((north - south) * texelSize);
      slopes[index + 2] = hollows[row * size + col];
    }
  }
  return slopes;
}

/**
 * For every pixel tells how deep it sits below the land around it: positive
 * in a hollow, negative on a hilltop, zero on a plain and on an even slope.
 * The depth is divided by the distance, so it is a slope too.
 *
 * This is what makes the bottom of a crater darker than its rim when the Sun
 * is high and nothing casts a shadow: a hollow sees less of the sky.
 */
function getHollows(heights, size, texelSize) {
  // Sum of all the heights above and to the left of each pixel. With it the
  // average of any rectangle takes four numbers.
  const stride = size + 1;
  const sums = new Float64Array(stride * stride);
  for (let row = 0; row < size; ++row) {
    let rowSum = 0;
    for (let col = 0; col < size; ++col) {
      rowSum += heights[row * size + col];
      sums[(row + 1) * stride + col + 1] = sums[row * stride + col + 1] + rowSum;
    }
  }

  const hollows = new Float32Array(size * size);
  HOLLOW_RADII.forEach(radius => {
    for (let row = 0; row < size; ++row) {
      const south = Math.max(row - radius, 0);
      const north = Math.min(row + radius + 1, size);
      for (let col = 0; col < size; ++col) {
        const west = Math.max(col - radius, 0);
        const east = Math.min(col + radius + 1, size);
        const sum = sums[north * stride + east] - sums[south * stride + east] -
          sums[north * stride + west] + sums[south * stride + west];
        const average = sum / ((north - south) * (east - west));
        hollows[row * size + col] += (average - heights[row * size + col]) /
          (radius * texelSize * HOLLOW_RADII.length);
      }
    }
  });
  return hollows;
}

/**
 * Tiles of a detailed area that have a pixel of about the given size
 */
function getDetailedZoom(latitude, texelSize, area) {
  const pixelsAround = MARS_CIRCUMFERENCE * Math.cos(latitude * DEGREES) / (texelSize * 1.05);
  const zoom = Math.ceil(Math.log2(pixelsAround / DETAILED_TILE_SIZE));
  return clamp(zoom, area.minZoom, area.maxZoom);
}

function getTileZoom(latitude, texelSize) {
  // Mercator tiles get more detailed away from the equator, so we need fewer
  // zoom levels there
  const metersPerPixel = Math.max(texelSize, SOURCE_RESOLUTION) * 1.05;
  const pixelsAround = MARS_CIRCUMFERENCE * Math.cos(latitude * DEGREES) / metersPerPixel;
  const zoom = Math.ceil(Math.log2(pixelsAround / ELEVATION_TILE_SIZE));
  return clamp(zoom, 0, Math.min(SOURCE_MAX_ZOOM, getDemTileMaxZoom()));
}

function getMercatorY(latitude) {
  const lat = clamp(latitude, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE) * DEGREES;
  return (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2;
}

function clamp(value, min, max) {
  return value < min ? min : (value > max ? max : value);
}
