/**
 * Gives elevation tiles as plain arrays of meters, and remembers those it
 * has already decoded.
 */
import { loadDemTile, decodeElevation, getDemTileMaxZoom } from '../tiles.js';

export const ELEVATION_TILE_SIZE = 256;

// Both the ground view and the shading of the map ask for the same tiles
// again and again: when we walk, and when the Sun moves.
const tileCache = new Map();
const MAX_CACHED_TILES = 200;
let decodeContext;

/**
 * Resolves with `Float32Array` of elevation in meters, row by row from the
 * north west corner of the tile. Resolves with `null` if there is no such tile.
 */
export function loadTileElevation(zoom, x, y) {
  const key = zoom + '/' + x + '/' + y;
  let tile = tileCache.get(key);
  if (tile) {
    // move it to the end of the line of those who are to be forgotten
    tileCache.delete(key);
    tileCache.set(key, tile);
    return tile;
  }

  tile = loadDemTile(zoom, x, y).then(decodeTile).catch(e => {
    console.warn('Could not load elevation tile ' + key, e);
    tileCache.delete(key);
    return null;
  });
  tileCache.set(key, tile);
  if (tileCache.size > MAX_CACHED_TILES) {
    tileCache.delete(tileCache.keys().next().value);
  }

  return tile;
}

function decodeTile(image) {
  const size = ELEVATION_TILE_SIZE;
  if (!decodeContext) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    decodeContext = canvas.getContext('2d', { willReadFrequently: true });
    decodeContext.imageSmoothingEnabled = false;
  }
  decodeContext.clearRect(0, 0, size, size);
  decodeContext.drawImage(image, 0, 0, size, size);
  if (image.close) image.close();

  const pixels = decodeContext.getImageData(0, 0, size, size).data;
  const elevation = new Float32Array(size * size);
  for (let i = 0; i < elevation.length; ++i) {
    elevation[i] = decodeElevation(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]);
  }
  return elevation;
}

/**
 * Resolves with the elevation of a place in meters, or with `null` when it
 * is not known.
 */
export function loadElevationAt(longitude, latitude) {
  const size = ELEVATION_TILE_SIZE;
  const zoom = getDemTileMaxZoom();
  const tilesInRow = Math.pow(2, zoom);

  const sinLat = Math.sin(latitude * Math.PI / 180);
  // Position on the web mercator map, where both sides go from 0 to 1
  const mapX = ((longitude + 180) / 360 % 1 + 1) % 1;
  const mapY = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  if (!(mapY >= 0 && mapY < 1)) return Promise.resolve(null);

  const tileX = Math.floor(mapX * tilesInRow);
  const tileY = Math.floor(mapY * tilesInRow);
  return loadTileElevation(zoom, tileX, tileY).then(elevation => {
    if (!elevation) return null;
    const x = Math.min(size - 1, Math.floor((mapX * tilesInRow - tileX) * size));
    const y = Math.min(size - 1, Math.floor((mapY * tilesInRow - tileY) * size));
    return elevation[y * size + x];
  });
}

/**
 * Finds the lowest and the highest elevation of an area: `box` is [west,
 * south, east, north] in degrees, and `contains(longitude, latitude)` tells
 * which points of the box belong to the area. Resolves with `{min, max}` in
 * meters, or with `null` when nothing is known.
 *
 * A large area is measured with less detailed tiles: the sharpest peaks get a
 * bit lower, but we do not download half of the planet.
 */
export function loadElevationRange(box, contains) {
  const size = ELEVATION_TILE_SIZE;
  const [west, south, east, north] = box;
  const left = (west + 180) / 360;
  const right = (east + 180) / 360;
  const top = getMercatorY(north);
  const bottom = getMercatorY(south);
  if (!(right > left && bottom > top)) return Promise.resolve(null);

  // The area should be about this many pixels along its longest side
  const span = Math.max(right - left, bottom - top);
  const zoom = Math.max(0, Math.min(getDemTileMaxZoom(), Math.floor(Math.log2(RANGE_RESOLUTION / (span * size)))));
  const tilesInRow = Math.pow(2, zoom);
  const worldSize = tilesInRow * size;

  const firstX = Math.floor(left * worldSize);
  const lastX = Math.ceil(right * worldSize);
  const firstY = Math.max(0, Math.floor(top * worldSize));
  const lastY = Math.min(worldSize, Math.ceil(bottom * worldSize));

  const range = { min: Infinity, max: -Infinity };
  const requests = [];
  for (let tileY = Math.floor(firstY / size); tileY * size < lastY; ++tileY) {
    for (let tileX = Math.floor(firstX / size); tileX * size < lastX; ++tileX) {
      // The area may lie across the 180th meridian, where the tiles start over
      const wrappedX = ((tileX % tilesInRow) + tilesInRow) % tilesInRow;
      requests.push(loadTileElevation(zoom, wrappedX, tileY).then(elevation => {
        if (!elevation) return;

        const fromX = Math.max(firstX, tileX * size), toX = Math.min(lastX, (tileX + 1) * size);
        const fromY = Math.max(firstY, tileY * size), toY = Math.min(lastY, (tileY + 1) * size);
        for (let y = fromY; y < toY; ++y) {
          const latitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / worldSize))) * 180 / Math.PI;
          for (let x = fromX; x < toX; ++x) {
            const longitude = (x + 0.5) / worldSize * 360 - 180;
            if (!contains(longitude, latitude)) continue;

            const value = elevation[(y - tileY * size) * size + (x - tileX * size)];
            if (value < range.min) range.min = value;
            if (value > range.max) range.max = value;
          }
        }
      }));
    }
  }

  return Promise.all(requests).then(() => range.max >= range.min ? range : null);
}

const RANGE_RESOLUTION = 512;

function getMercatorY(latitude) {
  const sinLat = Math.sin(latitude * Math.PI / 180);
  return 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
}
