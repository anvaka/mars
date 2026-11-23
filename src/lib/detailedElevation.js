/**
 * A few places of Mars have an elevation model that is a hundred times more
 * detailed than the one of the entire planet: those where the rovers drive.
 * Their tiles are made by tools/build_detail_dem_tiles.py, and given out by
 * the same server that gives the regular tiles (tools/tiles-worker).
 *
 * `VITE_DEM_DETAIL_TILES` lists the addresses of such tiles, separated by
 * commas. Each address answers with a description when ".json" is added.
 */
import { decodeElevation } from '../tiles.js';

/**
 * A tile of a detailed area is this many pixels wide
 */
export const DETAILED_TILE_SIZE = 512;

const MAX_CACHED_TILES = 64;

const addresses = (import.meta.env.VITE_DEM_DETAIL_TILES || '')
  .split(',').map(address => address.trim().replace(/\/$/, '')).filter(Boolean);

let areasRequest;
let decodeContext;

/**
 * Resolves with the list of detailed areas. Each of them is
 *
 * - `bounds` - [west, south, east, north] in degrees
 * - `minZoom`, `maxZoom` - zoom levels of its tiles
 * - `loadTile(zoom, x, y)` - resolves with `Float32Array` of elevation in
 *   meters, row by row from the north west corner of the tile. Resolves with
 *   `null` when the area has no such tile.
 */
export function loadDetailedAreas() {
  if (!areasRequest) {
    areasRequest = Promise.all(addresses.map(loadArea)).then(areas => areas.filter(Boolean));
  }
  return areasRequest;
}

/**
 * Gives the area that has the place, if there is one
 */
export function findDetailedArea(areas, longitude, latitude) {
  return areas.find(area => {
    const [west, south, east, north] = area.bounds;
    return longitude > west && longitude < east && latitude > south && latitude < north;
  });
}

function loadArea(address) {
  return fetch(address + '.json').then(response => {
    if (!response.ok) throw new Error('The server answered ' + response.status);
    return response.json();
  }).then(description => {
    return createArea(description.tiles[0], description.bounds, description.minzoom, description.maxzoom);
  }).catch(e => {
    // The land is still there, it is just not that detailed
    console.warn('Could not load the detailed elevation from ' + address, e);
    return null;
  });
}

function createArea(tilesAddress, bounds, minZoom, maxZoom) {
  const tiles = new Map();
  const [west, south, east, north] = bounds;

  return { bounds, minZoom, maxZoom, loadTile };

  function loadTile(zoom, x, y) {
    if (zoom < minZoom || zoom > maxZoom || !hasTile(zoom, x, y)) return Promise.resolve(null);

    const key = zoom + '/' + x + '/' + y;
    let tile = tiles.get(key);
    // the tile goes to the end of the line of those who are to be forgotten
    tiles.delete(key);
    if (!tile) {
      const address = tilesAddress.replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
      tile = fetch(address).then(response => {
        if (!response.ok) throw new Error('The server answered ' + response.status);
        return response.blob();
      }).then(blob => {
        // Elevation is stored in the colors, we need them exactly as they are
        return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      }).then(decodeTile).catch(e => {
        console.warn('Could not load detailed elevation tile ' + key, e);
        tiles.delete(key);
        return null;
      });
    }
    tiles.set(key, tile);
    if (tiles.size > MAX_CACHED_TILES) tiles.delete(tiles.keys().next().value);
    return tile;
  }

  function hasTile(zoom, x, y) {
    // The area is made of entire tiles, so a tile is either inside or outside
    const tilesInRow = Math.pow(2, zoom);
    const longitude = (x + 0.5) / tilesInRow * 360 - 180;
    const latitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / tilesInRow))) * 180 / Math.PI;
    return longitude > west && longitude < east && latitude > south && latitude < north;
  }
}

function decodeTile(image) {
  const size = DETAILED_TILE_SIZE;
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
