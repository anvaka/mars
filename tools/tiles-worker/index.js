/**
 * Gives out tiles of a PMTiles file that lives in an R2 bucket.
 *
 * A PMTiles file can be read by the browser directly: it asks for pieces of
 * the file, first for the index and then for the tile. That works, but it is
 * slow: the public address of a bucket is throttled, the index takes a few
 * requests before the first tile comes, and a piece of a five gigabyte file
 * cannot be kept in the Cloudflare cache.
 *
 * This worker sits next to the bucket and does the reading there. A browser
 * asks for a regular tile:
 *
 *   /mars-dem-v1/5/10/12.webp   - a tile of `mars-dem-v1.pmtiles`
 *   /mars-dem-v1.json           - what zoom levels the file has (TileJSON)
 *
 * Every answer is small and never changes, so it is remembered both by the
 * Cloudflare cache and by the browser. When the tiles are built again, they
 * should get a new file name (`mars-dem-v2.pmtiles`), and not replace the old
 * file: the name is the only thing that tells the caches apart.
 *
 * The worker also passes along the raw photos of the rovers:
 *
 *   /nasa/mars2020-raw-images/pub/ods/.../NLF_2009_..._800.jpg
 *
 * is the same picture as https://mars.nasa.gov/mars2020-raw-images/pub/ods/...
 * NASA lets a website show these pictures, but not read their pixels (there
 * are no CORS headers), and the website needs the pixels to draw the photos
 * in WebGL. A picture never changes, so it is remembered the same way.
 */
import { PMTiles, EtagMismatch } from 'pmtiles';

const TILE_PATH = /^\/([\w-]+)\/(\d+)\/(\d+)\/(\d+)(?:\.\w+)?$/;
const DESCRIPTION_PATH = /^\/([\w-]+)\.json$/;
// Only the raw images of Perseverance and Curiosity, and nothing else from
// NASA: this is not a proxy for the entire internet.
const PHOTO_PATH = /^\/nasa\/((?:mars2020-raw-images|msl-raw-images)\/[\w./-]+\.(?:jpe?g|png))$/i;
const PHOTO_SOURCE = 'https://mars.nasa.gov/';

// Numbers come from the PMTiles specification
const TILE_TYPES = {
  1: { type: 'application/x-protobuf', extension: 'mvt' },
  2: { type: 'image/png', extension: 'png' },
  3: { type: 'image/jpeg', extension: 'jpg' },
  4: { type: 'image/webp', extension: 'webp' },
  5: { type: 'image/avif', extension: 'avif' }
};

const FOREVER = 'public, max-age=31536000, immutable';
const DAY = 'public, max-age=86400';

// A worker stays in memory between the requests, and so do the indexes of
// the files it has read.
const archives = new Map();

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: getHeaders() });
    if (request.method !== 'GET' && request.method !== 'HEAD') return reply(405, 'Only GET is supported');

    // Anything after "?" does not change the answer, and should not make
    // a new record in the cache.
    const url = new URL(request.url);
    const cacheKey = new Request(url.origin + url.pathname);
    const cache = caches.default;

    const remembered = await cache.match(cacheKey);
    if (remembered) return withHeader(remembered, 'x-tile-cache', 'hit');

    let response;
    try {
      response = await serve(url, env);
    } catch (e) {
      console.error(e);
      return reply(500, 'Could not read the tiles');
    }

    if (response.status === 200) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return withHeader(response, 'x-tile-cache', 'miss');
  }
};

async function serve(url, env) {
  const tile = TILE_PATH.exec(url.pathname);
  if (tile) return serveTile(env, tile[1], Number(tile[2]), Number(tile[3]), Number(tile[4]));

  const description = DESCRIPTION_PATH.exec(url.pathname);
  if (description) return serveDescription(env, description[1], url.origin);

  const photo = PHOTO_PATH.exec(url.pathname);
  if (photo) return servePhoto(photo[1]);

  return reply(404, 'Try /name/zoom/x/y');
}

async function servePhoto(path) {
  const answer = await fetch(PHOTO_SOURCE + path, { headers: { accept: 'image/*' } });
  if (answer.status === 404) return reply(404, 'There is no such photo');
  if (!answer.ok) return reply(502, 'NASA did not give the photo: ' + answer.status);

  const type = answer.headers.get('content-type') || '';
  if (!type.startsWith('image/')) return reply(502, 'NASA gave something that is not a photo');

  return new Response(answer.body, {
    headers: getHeaders({ 'content-type': type, 'cache-control': FOREVER })
  });
}

async function serveTile(env, name, zoom, x, y) {
  const archive = getArchive(env, name);
  const header = await getHeader(archive);
  if (!header) return reply(404, 'There are no such tiles');
  if (zoom < header.minZoom || zoom > header.maxZoom) return reply(404, 'There is no such zoom level');

  const tile = await archive.getZxy(zoom, x, y);
  if (!tile) return reply(404, 'There is no such tile');

  return new Response(tile.data, {
    headers: getHeaders({ 'content-type': getTileType(header).type, 'cache-control': FOREVER })
  });
}

async function serveDescription(env, name, origin) {
  const header = await getHeader(getArchive(env, name));
  if (!header) return reply(404, 'There are no such tiles');

  const description = {
    tilejson: '3.0.0',
    tiles: [`${origin}/${name}/{z}/{x}/{y}.${getTileType(header).extension}`],
    minzoom: header.minZoom,
    maxzoom: header.maxZoom,
    bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat]
  };
  return new Response(JSON.stringify(description), {
    headers: getHeaders({ 'content-type': 'application/json', 'cache-control': DAY })
  });
}

function getTileType(header) {
  return TILE_TYPES[header.tileType] || { type: 'application/octet-stream', extension: 'bin' };
}

function getArchive(env, name) {
  let archive = archives.get(name);
  if (!archive) {
    archive = new PMTiles(createBucketSource(env.BUCKET, name + '.pmtiles'));
    archive.name = name;
    archives.set(name, archive);
  }
  return archive;
}

/**
 * Resolves with the header of the file, or with nothing when there is no
 * such file in the bucket.
 */
function getHeader(archive) {
  return archive.getHeader().catch(e => {
    // Anyone can ask for any name. Those that do not exist are not worth
    // remembering.
    archives.delete(archive.name);
    if (e instanceof FileNotFound) return null;
    throw e;
  });
}

class FileNotFound extends Error {}

/**
 * Lets PMTiles library read pieces of a file in the bucket.
 */
function createBucketSource(bucket, key) {
  return {
    getKey() {
      return key;
    },

    async getBytes(offset, length, signal, etag) {
      const object = await bucket.get(key, {
        range: { offset, length },
        // The library remembers the index of the file. If the file has been
        // replaced since then, the index is wrong, and it has to know.
        onlyIf: etag ? { etagMatches: etag } : undefined
      });
      if (!object) throw new FileNotFound(key);
      if (!object.body) throw new EtagMismatch();

      return { data: await object.arrayBuffer(), etag: object.etag };
    }
  };
}

function reply(status, message) {
  return new Response(message, { status, headers: getHeaders({ 'cache-control': 'no-store' }) });
}

function getHeaders(headers) {
  // The tiles are read by a script of a website that lives at another address
  return new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-max-age': '86400',
    ...headers
  });
}

function withHeader(response, name, value) {
  const copy = new Response(response.body, response);
  copy.headers.set(name, value);
  return copy;
}
