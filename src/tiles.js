/**
 * Describes where the map data comes from.
 *
 * There are three sources of elevation:
 *
 * 1. A tile server, when VITE_DEM_TILES points to one. It gives out tiles of
 *    the PMTiles file below one by one, which is the fastest way to get them.
 *    See tools/tiles-worker
 * 2. A PMTiles file, when VITE_DEM_PMTILES points to one. Its tiles hold 16 bit
 *    "terrarium" encoded elevation, see tools/build_dem_tiles.py
 * 3. Otherwise - a MapBox tileset with 8 bit grayscale tiles, where 0 is the
 *    lowest point of Mars, and 255 is the highest one.
 */
import { addProtocol } from 'maplibre-gl';
import { PMTiles, Protocol } from 'pmtiles';
import { MAPBOX_TOKEN } from './token.js';

// https://geology.com/articles/highest-point-on-mars.shtml
export const MIN_ELEVATION = -8200;
export const MAX_ELEVATION = 21229;
export const ELEVATION_RANGE = MAX_ELEVATION - MIN_ELEVATION;

const DEM_TILESET = 'anvaka.8ctdbgc9';
const access = `access_token=${MAPBOX_TOKEN}`;

// The deepest point of the 16 bit elevation model is a bit lower than the
// commonly cited one:
const LOWEST_POINT = -8528;

/**
 * "Terrarium" is the way to store elevation with a precision of a meter in
 * the colors of a picture.
 */
const terrarium = {
  decodeElevation(r, g, b) {
    return r * 256 + g + b / 256 - 32768;
  },

  encodeElevation(elevation) {
    const value = Math.round(elevation) + 32768;
    return `rgb(${value >> 8}, ${value & 255}, 0)`;
  },

  getElevationAt(t) {
    return LOWEST_POINT + (MAX_ELEVATION - LOWEST_POINT) * t;
  }
};

const pmtilesUrl = import.meta.env.VITE_DEM_PMTILES &&
  new URL(import.meta.env.VITE_DEM_PMTILES, window.location.href).href;

const tileServerUrl = import.meta.env.VITE_DEM_TILES &&
  new URL(import.meta.env.VITE_DEM_TILES, window.location.href).href.replace(/\/$/, '');

// If the tile server does not answer (its free plan has a daily limit), the
// PMTiles file still works. It is slower, but it is a map.
const dem = tileServerUrl ? createTileServerDem(tileServerUrl, pmtilesUrl && (() => createPMTilesDem(pmtilesUrl))) :
  pmtilesUrl ? createPMTilesDem(pmtilesUrl) : createMapBoxDem();

/**
 * True when elevation is known with a meter of precision. The 8 bit tiles
 * have a step every 115 meters, and shading turns those steps into stairs.
 */
export const hasPreciseElevation = !!(tileServerUrl || pmtilesUrl);

/**
 * Resolves with `raster-dem` source definition for the Mars elevation tiles.
 */
export const loadDemSource = dem.loadSource;

/**
 * Resolves with an image of a single elevation tile.
 */
export const loadDemTile = dem.loadTile;

/**
 * Deepest zoom level at which `loadDemTile()` still gives a tile. Valid after
 * the source is loaded.
 */
export const getDemTileMaxZoom = dem.getTileMaxZoom;

/**
 * Converts color of a tile pixel to elevation in meters.
 */
export const decodeElevation = dem.decodeElevation;

/**
 * Gives a color that has to be stored in a tile to represent the elevation.
 */
export const encodeElevation = dem.encodeElevation;

/**
 * Maps 0..1 to elevation between the lowest and the highest point that the
 * tiles are able to store.
 */
export const getElevationAt = dem.getElevationAt;

/**
 * @param {String} url - address of the tiles on the server, without ".json"
 * @param {Function} [createReserve] - makes the source of elevation to use
 * when the server is not available
 */
function createTileServerDem(url, createReserve) {
  let tiles;
  let maxZoom = 0;
  let reserve;

  // Both the map and our own code (the shading, the ground view) need the
  // same tiles. To download each of them once, the map gets the tiles from
  // us, and we remember those that were asked for recently.
  const downloads = new Map();
  const MAX_REMEMBERED_TILES = 128;
  const PROTOCOL = 'marsdem';

  addProtocol(PROTOCOL, request => {
    // "marsdem://zoom/x/y"
    const [zoom, x, y] = request.url.split('/').slice(-3).map(Number);
    return download(zoom, x, y).then(blob => blob.arrayBuffer()).then(data => ({ data }));
  });

  function download(zoom, x, y) {
    const key = zoom + '/' + x + '/' + y;
    let tile = downloads.get(key);
    // the tile goes to the end of the line of those who are to be forgotten
    downloads.delete(key);

    if (!tile) {
      const tileUrl = tiles.replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
      tile = fetch(tileUrl).then(response => {
        if (!response.ok) throw new Error(`No tile at ${key}`);
        return response.blob();
      });
      tile.catch(() => downloads.delete(key));
    }

    downloads.set(key, tile);
    if (downloads.size > MAX_REMEMBERED_TILES) downloads.delete(downloads.keys().next().value);
    return tile;
  }

  return {
    loadSource() {
      // The server describes its tiles in TileJSON format
      return fetch(url + '.json').then(response => {
        if (!response.ok) {
          throw new Error('Could not load elevation tiles description: ' + response.status);
        }
        return response.json();
      }).then(tileJSON => {
        tiles = tileJSON.tiles[0];
        maxZoom = tileJSON.maxzoom;
        return {
          type: 'raster-dem',
          tiles: [PROTOCOL + '://{z}/{x}/{y}'],
          tileSize: 256,
          minzoom: tileJSON.minzoom,
          maxzoom: tileJSON.maxzoom,
          encoding: 'terrarium'
        };
      }).catch(e => {
        if (!createReserve) throw e;
        console.warn('The tile server is not available, reading the tiles file directly', e);
        reserve = createReserve();
        return reserve.loadSource();
      });
    },

    loadTile(zoom, x, y) {
      if (reserve) return reserve.loadTile(zoom, x, y);

      return download(zoom, x, y).then(readExactPixels);
    },

    getTileMaxZoom() {
      return reserve ? reserve.getTileMaxZoom() : maxZoom;
    },

    ...terrarium
  };
}

function createPMTilesDem(url) {
  const archive = new PMTiles(url);
  const protocol = new Protocol();
  protocol.add(archive);
  addProtocol('pmtiles', protocol.tile);

  let maxZoom = 0;

  return {
    loadSource() {
      return archive.getHeader().then(header => {
        maxZoom = header.maxZoom;
        return {
          type: 'raster-dem',
          url: 'pmtiles://' + url,
          tileSize: 256,
          encoding: 'terrarium'
        };
      });
    },

    loadTile(zoom, x, y) {
      return archive.getZxy(zoom, x, y).then(tile => {
        if (!tile) throw new Error(`No tile at ${zoom}/${x}/${y}`);
        return readExactPixels(new Blob([tile.data]));
      });
    },

    getTileMaxZoom() {
      return maxZoom;
    },

    ...terrarium
  };
}

/**
 * Elevation is stored in the colors, so we need the pixels of a tile
 * exactly as they are stored.
 */
function readExactPixels(blob) {
  return createImageBitmap(blob, {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none'
  });
}

function createMapBoxDem() {
  const tiles = `https://api.mapbox.com/v4/${DEM_TILESET}/{z}/{x}/{y}.pngraw?${access}`;

  return {
    loadSource() {
      // Only tileset knows how deep its tiles go, so we have to ask:
      return fetch(`https://api.mapbox.com/v4/${DEM_TILESET}.json?secure&${access}`)
        .then(response => {
          if (!response.ok) {
            throw new Error('Could not load elevation tiles description: ' + response.status);
          }
          return response.json();
        }).then(tileJSON => ({
          type: 'raster-dem',
          tiles: [tiles],
          tileSize: 256,
          minzoom: tileJSON.minzoom,
          maxzoom: tileJSON.maxzoom,
          // elevation = red * redFactor - baseShift:
          encoding: 'custom',
          redFactor: ELEVATION_RANGE / 256,
          greenFactor: 0,
          blueFactor: 0,
          baseShift: -MIN_ELEVATION
        }));
    },

    loadTile(zoom, x, y) {
      const url = tiles.replace('{z}', zoom).replace('{x}', x).replace('{y}', y);

      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.crossOrigin = 'anonymous';
        img.src = url;
      });
    },

    getTileMaxZoom() {
      // MapBox upscales tiles on the server when asked to go deeper than the
      // tileset goes.
      return 22;
    },

    decodeElevation: decode,

    encodeElevation(elevation) {
      let value = Math.round(256 * (elevation - MIN_ELEVATION) / ELEVATION_RANGE);
      value = Math.max(0, Math.min(255, value));
      return `rgb(${value}, ${value}, ${value})`;
    },

    getElevationAt(t) {
      // 255 is the largest value a tile can have. Going even one step above
      // makes the map render the entire planet with the last color of the ramp
      return decode(255 * t);
    }
  };

  function decode(r) {
    // all channels are the same, so we don't care which component to take
    return r * ELEVATION_RANGE / 256 + MIN_ELEVATION;
  }
}
