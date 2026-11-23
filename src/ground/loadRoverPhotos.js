/**
 * Finds photos that a rover took from a place where it stopped, and picks
 * those that make a good panorama.
 *
 * The photos come from the navigation cameras (Navcam). They sit on top of the
 * rover's mast and look around after every drive. NASA publishes the raw
 * images along with the description of where the camera was looking:
 *
 * https://mars.nasa.gov/mars2020/multimedia/raw-images/
 * https://mars.nasa.gov/msl/multimedia/raw-images/
 *
 * Spirit and Opportunity have no such lists. Their photos are in the archive
 * of the Planetary Data System, and tools/build_rover_archive.py makes the
 * lists that are stored with the website.
 */
import { parseCameraModel, parseVector, getPixelDirection, rotate, normalize, add, subtract, cross, dot } from './cameraModel.js';
import { getMarsTime, getLocalSolarTime, getSunDirection } from '../lib/marsTime.js';

const PAGE_SIZE = 100;
// The rover may stay at one place for weeks, and take thousands of photos
const MAX_PAGES = 3;
// Shots of one panorama follow each other within this many milliseconds
const MAX_PAUSE_IN_SERIES = 10 * 60 * 1000;
const DEGREES = Math.PI / 180;
// The glare of the Sun gets into a picture even when the Sun itself is this
// many degrees outside of it
const SUN_GLARE = 5;
// Tiles of one shot overlap a little. If the gap between two tiles is smaller
// than this share of a tile, they are neighbors.
const TILE_GAP = 0.05;
const ARCHIVE_URL = new URL('.', document.baseURI).href + 'data/rovers/';

/**
 * Each rover has its own list of raw images. A feed knows how to ask for the
 * images, and how to read the answer.
 */
const FEEDS = {
  // Perseverance
  M20: {
    // Navcam sensor is 5120 x 3840 pixels. One shot is often sent to Earth
    // as several smaller tiles.
    sensorWidth: 5120,
    sensorHeight: 3840,
    // The lens is very wide, a dozen of shots covers everything around
    maxFrames: 14,
    // Shots that look closer than this many degrees to each other show the
    // same thing. We take only one of them.
    minAngleBetweenFrames: 40,
    // The lens of Navcam makes the picture darker away from its center: a
    // half of the brightness is lost at the sides, and two thirds in the
    // corners. If `r` is the distance from the center of the sensor (1 in the
    // corner), the brightness is `exp(-(a * r^2 + b * r^4 + c * r^6))`, and
    // here are `a`, `b` and `c`. They were measured on the places that two
    // neighbor shots of a panorama both see (ten shots of sols 2009 and 2022).
    // For the other rovers tools/measure_vignette.py does the same.
    // The fourth number is how much of the correction is taken back, see
    // `keepBrightness()`. Nothing is taken back here: these shots are made
    // brighter at the sides and stay as they are in the center.
    vignette: [1.369, -0.823, 0.594, 0],

    getUrl(sol, lastSol, page) {
      return 'https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json' +
        `&num=${PAGE_SIZE}&page=${page}&order=sol+asc&search=NAVCAM_LEFT` +
        `&condition_2=${sol}:sol:gte&condition_3=${lastSol}:sol:lte` +
        '&extended=sample_type::full';
    },

    hasMore(answer, page) {
      return (page + 1) * PAGE_SIZE < answer.total_results;
    },

    getImages(answer) {
      return (answer.images || []).map(image => {
        const details = image.extended || {};
        const [width, height] = parseVector(details.dimension);
        const scaleFactor = Number.parseFloat(details.scaleFactor);
        return {
          site: Number(image.site),
          drive: Number(image.drive),
          sol: image.sol,
          moment: details.sclk,
          // The first three letters of image id tell what kind of picture it
          // is. We prefer the color ones (NLF). NLE is the raw sensor
          // readout that looks like a chessboard, so it is not here at all.
          priority: { NLF: 0, NLG: 1, NLR: 2, NLB: 3 }[image.imageid.slice(0, 3)],
          rect: details.subframeRect,
          scaleFactor,
          width,
          height,
          model: image.camera && image.camera.camera_model_component_list,
          attitude: image.attitude,
          url: getPerseveranceImageUrl(image.image_files || {}, scaleFactor),
          date: new Date(image.date_taken_utc + 'Z'),
          localTime: image.date_taken_mars,
          link: image.link
        };
      });
    }
  },

  // Curiosity
  MSL: {
    sensorWidth: 1024,
    sensorHeight: 1024,
    // The lens is narrow, so the rover takes many shots
    maxFrames: 40,
    minAngleBetweenFrames: 20,
    // A third of the brightness is lost at the sides, and almost a half in
    // the corners (62 pairs of shots from six stops, sols 650 to 3400)
    vignette: keepBrightness([0.791, 0.286, -0.454]),

    getUrl(sol, lastSol, page) {
      return 'https://mars.nasa.gov/api/v1/raw_image_items/?order=sol+asc' +
        `&per_page=${PAGE_SIZE}&page=${page}&condition_1=msl:mission` +
        `&condition_2=${sol}:sol:gte&condition_3=${lastSol}:sol:lte` +
        '&search=NAV_LEFT_A%7CNAV_LEFT_B&extended=thumbnail::sample_type::noteq';
    },

    hasMore(answer) {
      return !!answer.more;
    },

    getImages(answer) {
      return (answer.items || []).map(image => {
        const rect = parseVector(image.subframe_rect);
        const scaleFactor = Number.parseFloat(image.scale_factor) || 1;
        return {
          site: Number(image.site),
          drive: Number(image.drive),
          sol: image.sol,
          moment: image.spacecraft_clock,
          // Every shot also comes as a tiny preview, which we skip
          priority: /^(full|subframe)$/.test(image.extended && image.extended.sample_type) ? 0 : undefined,
          rect: image.subframe_rect,
          scaleFactor,
          width: rect[2] / scaleFactor,
          height: rect[3] / scaleFactor,
          model: image.camera_model_component_list,
          attitude: image.attitude,
          url: image.https_url,
          date: new Date(image.date_taken),
          localTime: image.extended && image.extended.lmst,
          link: 'https://mars.nasa.gov' + image.link
        };
      });
    }
  },

  // Spirit. Its navigation cameras, and those of Opportunity, are of the same
  // design as Curiosity has, and their lenses darken the picture as much.
  // Each one was measured on its own shots: ten stops, 91 and 64 pairs.
  MERA: createArchiveFeed('MERA-photos.json', keepBrightness([1.056, -1.026, 0.673])),
  // Opportunity
  MERB: createArchiveFeed('MERB-photos.json', keepBrightness([0.534, 0.644, -0.644]))
};

/**
 * A feed of a rover whose photos are listed in a file that is stored with
 * the website. The file tells
 *
 * - `images` - where the pictures are
 * - `size` - how many pixels wide they are
 * - `places` - the photos of every stop: {"site_drive": [{file, sol, time, localTime, camera}]}.
 *   The `camera` is already turned the way the rover stood, so the rover
 *   itself counts as not tilted.
 */
function createArchiveFeed(fileName, vignette) {
  let request;

  return {
    // The navigation cameras of these rovers are the same as Curiosity has
    sensorWidth: 1024,
    sensorHeight: 1024,
    maxFrames: 40,
    minAngleBetweenFrames: 20,
    vignette,

    loadImages(place) {
      if (!request) {
        request = fetch(ARCHIVE_URL + fileName).then(response => {
          if (!response.ok) throw new Error('Could not load the list of photos: ' + response.status);
          return response.json();
        });
        // If it did not work out, we want to try again the next time
        request.catch(() => { request = null; });
      }

      return request.then(archive => {
        const photos = archive.places[place.site + '_' + place.drive] || [];
        const scaleFactor = this.sensorWidth / archive.size;
        return photos.map(photo => ({
          site: place.site,
          drive: place.drive,
          sol: photo.sol,
          moment: photo.time,
          priority: 0,
          rect: `(1,1,${this.sensorWidth},${this.sensorHeight})`,
          scaleFactor,
          width: archive.size,
          height: archive.size,
          model: photo.camera,
          attitude: '(1,0,0,0)',
          url: archive.images + photo.file + '.jpg',
          date: new Date(photo.time),
          // The same form as the other feeds have
          localTime: 'M' + photo.localTime,
          link: archive.images + photo.file + '.jpg'
        }));
      });
    }
  };
}

/**
 * @param {String} roverId - 'M20' for Perseverance, 'MSL' for Curiosity,
 * 'MERA' for Spirit, 'MERB' for Opportunity
 * @param {Object} place - where the rover stopped
 * @param {Number} place.site, place.drive - how NASA names the stop
 * @param {Number} place.sol - the day when the rover came there
 * @param {Number} [place.lastSol] - the day when it left
 * @param {Number} [place.longitude, place.latitude] - where it is on Mars. We
 * need it to know where the Sun was.
 *
 * Resolves with array of frames. Each frame is one shot of the camera:
 *
 * - `tiles` - the pictures it consists of: `{url, width, height, model, attitude, isOuter, shot}`.
 *   `isOuter` tells which sides of the tile (`left`, `top`, `right`, `bottom`)
 *   are the sides of the entire shot, and not a border with another tile.
 *   `shot` is where the entire shot is, in pixels of the tile: `{left, top, width, height}`.
 *   Neighbor tiles overlap, and `overlap` tells how many pixels at each side
 *   of the tile belong to the neighbor. `vignette` tells how the lens darkens
 *   the shot away from its center (four numbers), see the feeds above. `lens` tells where
 *   that center is, in pixels of the tile: `{centerX, centerY, radius}`, the
 *   radius is the distance from the center to the corner of the sensor.
 * - `direction` - where the shot looks at: [north, east, down]
 * - `date` - when it was taken (Earth time), `sol` and `localTime` - the same
 *   moment on Mars
 * - `link` - the page of the image on NASA website
 * - `seesSun` - the Sun is in the picture. The camera makes everything else
 *   dark on such a shot, and whoever shows it has to make it brighter.
 */
export function loadRoverPhotos(roverId, place) {
  const feed = FEEDS[roverId];
  if (!feed) return Promise.resolve([]);

  const lastSol = Number.isFinite(place.lastSol) ? place.lastSol : place.sol;
  const request = feed.loadImages ? feed.loadImages(place) : loadPages(feed, place.sol, lastSol, 0, []);
  return request.then(images => {
    const atPlace = images.filter(image => image.site === place.site && image.drive === place.drive);
    const frames = getFrames(atPlace, feed);
    frames.forEach(frame => { frame.seesSun = seesSun(frame, place); });
    return pickFrames(frames, feed);
  });
}

export function hasRoverPhotos(roverId) {
  return roverId in FEEDS;
}

function loadPages(feed, sol, lastSol, page, collected) {
  return fetch(feed.getUrl(sol, lastSol, page)).then(response => {
    if (!response.ok) throw new Error('NASA did not give the list of photos: ' + response.status);
    return response.json();
  }).then(answer => {
    const images = collected.concat(feed.getImages(answer));
    if (feed.hasMore(answer, page) && page + 1 < MAX_PAGES) {
      return loadPages(feed, sol, lastSol, page + 1, images);
    }
    return images;
  });
}

/**
 * Groups the tiles by the shot they belong to.
 */
function getFrames(images, feed) {
  const shots = new Map();

  images.forEach(image => {
    if (image.priority === undefined) return;
    const tile = getTile(image);
    if (!tile) return;

    // The same shot comes in several kinds (color, single channel) and
    // sizes. Each of them is a candidate.
    const key = [image.moment, image.priority, image.scaleFactor].join('/');
    let shot = shots.get(key);
    if (!shot) {
      shot = {
        moment: image.moment,
        priority: image.priority,
        tiles: new Map(),
        sol: image.sol,
        date: image.date,
        localTime: parseLocalTime(image.localTime),
        link: image.link,
      };
      shots.set(key, shot);
    }
    // A tile may be sent several times. The last one wins.
    shot.tiles.set(image.rect, tile);
  });

  // Now leave the best candidate for every moment
  const best = new Map();
  shots.forEach(shot => {
    shot.tiles = Array.from(shot.tiles.values());
    markOuterSides(shot.tiles);
    shot.tiles.forEach(tile => {
      tile.vignette = feed.vignette;
      tile.lens = getLens(tile, feed);
    });
    shot.coverage = shot.tiles.reduce((sum, tile) => sum + tile.sensorArea, 0) /
      (feed.sensorWidth * feed.sensorHeight);
    shot.direction = normalize(shot.tiles.reduce((sum, tile) => add(sum, tile.direction), [0, 0, 0]));

    const current = best.get(shot.moment);
    if (!current || compareFrames(shot, current) < 0) best.set(shot.moment, shot);
  });

  return Array.from(best.values());
}

function getTile(image) {
  const model = parseCameraModel(image.model);
  const attitude = parseVector(image.attitude);
  const rect = parseVector(image.rect);
  const { width, height } = image;
  const isValid = model && attitude.length === 4 && rect.length === 4 &&
    width > 0 && height > 0 && image.url && !Number.isNaN(image.date.getTime());
  if (!isValid) return null;

  return {
    url: image.url,
    width,
    height,
    model,
    attitude,
    rect,
    sensorArea: rect[2] * rect[3],
    direction: getWorldDirection(model, attitude, width / 2, height / 2)
  };
}

/**
 * Tells where the center of the sensor is relative to a tile.
 */
/**
 * Undoing the darkening of a lens makes a photo brighter everywhere but in
 * its very center, and the photos of the black and white cameras are often
 * bright already: the land turns plain white. So for them the correction is
 * shifted: the sides get brighter, the center gets darker, and the photo as
 * a whole stays as bright as it was.
 *
 * Takes the three numbers of a lens (see `vignette` of the feeds), and adds
 * the fourth: the average of `a * r^2 + b * r^4 + c * r^6` over the sensor.
 */
function keepBrightness(vignette) {
  const [a, b, c] = vignette;
  // These are the averages of r^2, r^4 and r^6 over a square whose corner is at r = 1
  return [a, b, c, a / 3 + b * 7 / 45 + c * 3 / 35];
}

function getLens(tile, feed) {
  // The first pixel of the sensor has number one
  const [x, y, width, height] = tile.rect;
  const scaleX = tile.width / width;
  const scaleY = tile.height / height;
  return {
    centerX: (1 + feed.sensorWidth / 2 - x) * scaleX,
    centerY: (1 + feed.sensorHeight / 2 - y) * scaleY,
    radius: Math.hypot(feed.sensorWidth, feed.sensorHeight) / 2 * scaleX
  };
}

/**
 * Finds which sides of the tiles have no other tile behind them.
 */
function markOuterSides(tiles) {
  const shotLeft = Math.min(...tiles.map(tile => tile.rect[0]));
  const shotTop = Math.min(...tiles.map(tile => tile.rect[1]));
  const shotRight = Math.max(...tiles.map(tile => tile.rect[0] + tile.rect[2]));
  const shotBottom = Math.max(...tiles.map(tile => tile.rect[1] + tile.rect[3]));

  tiles.forEach(tile => {
    const [x, y, width, height] = tile.rect;
    // The picture of a tile can be smaller than the piece of the sensor it shows
    const scaleX = tile.width / width;
    const scaleY = tile.height / height;
    tile.shot = {
      left: (shotLeft - x) * scaleX,
      top: (shotTop - y) * scaleY,
      width: (shotRight - shotLeft) * scaleX,
      height: (shotBottom - shotTop) * scaleY
    };

    const gapX = width * TILE_GAP;
    const gapY = height * TILE_GAP;
    // A neighbor is a tile that covers the point right behind the middle of
    // the side.
    const getNeighbor = (pointX, pointY) => tiles.find(other => {
      const [left, top, otherWidth, otherHeight] = other.rect;
      return other !== tile &&
        left <= pointX && pointX <= left + otherWidth &&
        top <= pointY && pointY <= top + otherHeight;
    });
    const neighbors = {
      left: getNeighbor(x - gapX, y + height / 2),
      right: getNeighbor(x + width + gapX, y + height / 2),
      top: getNeighbor(x + width / 2, y - gapY),
      bottom: getNeighbor(x + width / 2, y + height + gapY)
    };
    // What two tiles share is split between them in halves
    const getOverlap = (neighbor, shared) => neighbor ? Math.max(0, shared(neighbor.rect)) / 2 : 0;

    tile.isOuter = {
      left: !neighbors.left,
      right: !neighbors.right,
      top: !neighbors.top,
      bottom: !neighbors.bottom
    };
    tile.overlap = {
      left: getOverlap(neighbors.left, other => other[0] + other[2] - x) * scaleX,
      right: getOverlap(neighbors.right, other => x + width - other[0]) * scaleX,
      top: getOverlap(neighbors.top, other => other[1] + other[3] - y) * scaleY,
      bottom: getOverlap(neighbors.bottom, other => y + height - other[1]) * scaleY
    };
  });
}

/**
 * Tells if the Sun was in the picture, or right next to it.
 */
function seesSun(frame, place) {
  if (!Number.isFinite(place.longitude) || !Number.isFinite(place.latitude)) return false;

  const marsTime = getMarsTime(frame.date);
  const sun = getSunDirection(place.latitude, marsTime.subsolarLatitude, getLocalSolarTime(marsTime, place.longitude));
  if (sun.up < 0) return false;
  const toSun = [sun.north, sun.east, -sun.up];
  return frame.tiles.some(tile => isInTile(tile, toSun, Math.tan(SUN_GLARE * DEGREES)));
}

/**
 * Tells if a tile looks at the given direction. The sides of a tile are
 * considered straight, which is not true for a fisheye lens, but it is close.
 */
function isInTile(tile, direction, margin) {
  const { model, attitude, width, height } = tile;
  const center = tile.direction;
  const ahead = dot(direction, center);
  if (ahead <= 0) return false;

  const left = getWorldDirection(model, attitude, 0, height / 2);
  const right = getWorldDirection(model, attitude, width, height / 2);
  const top = getWorldDirection(model, attitude, width / 2, 0);
  // Imagine a flat screen in front of the camera. Every direction hits it at
  // some point, and we check if our point is between the sides of the tile.
  const screenRight = normalize(cross(cross(center, subtract(right, left)), center));
  const screenDown = cross(center, screenRight);
  const onScreen = (vector, axis) => dot(vector, axis) / dot(vector, center);

  const x = onScreen(direction, screenRight);
  const y = onScreen(direction, screenDown);
  const halfWidth = Math.abs(onScreen(right, screenRight));
  const halfHeight = Math.abs(onScreen(top, screenDown));
  return Math.abs(x) <= halfWidth + margin && Math.abs(y) <= halfHeight + margin;
}

/**
 * Tells where a pixel of a tile looks at, as [north, east, down] unit vector.
 */
export function getWorldDirection(model, attitude, x, y) {
  // The camera model is given relative to the rover, and the attitude tells
  // how the rover is turned relative to the land.
  return rotate(attitude, getPixelDirection(model, x, y));
}

function getPerseveranceImageUrl(files, scaleFactor) {
  // A tile of a full resolution shot covers a small piece of the sky. A small
  // picture is enough for it, and there are sixteen of them in the shot.
  if (scaleFactor <= 1) return files.small || files.medium;
  if (scaleFactor <= 2) return files.medium || files.large;
  return files.large || files.medium;
}

function parseLocalTime(text) {
  // "Sol-01021M12:58:59.486"
  const match = /M(\d+):(\d+):([\d.]+)/.exec(text || '');
  if (!match) return null;
  return Number.parseFloat(match[1]) + Number.parseFloat(match[2]) / 60 + Number.parseFloat(match[3]) / 3600;
}

function compareFrames(a, b) {
  // Complete shots go first, then color ones, then those with fewer tiles
  // to download, then the earlier ones.
  const coverage = Math.round(b.coverage * 10) - Math.round(a.coverage * 10);
  if (coverage) return coverage;
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.tiles.length !== b.tiles.length) return a.tiles.length - b.tiles.length;
  return a.date - b.date;
}

/**
 * Takes the best frames that look in different directions.
 */
function pickFrames(frames, feed) {
  const minCosine = Math.cos(feed.minAngleBetweenFrames * DEGREES);
  const picked = [];

  // A black and white shot among the color ones looks like a mistake, so
  // all the frames are of the same kind: the best one that we have.
  const bestKind = Math.min(...frames.map(frame => frame.priority));
  frames = frames.filter(frame => frame.priority === bestKind);

  // Frames of one panorama are taken within minutes, with the same light.
  // They look better together than frames from different days.
  const panorama = new Set(getLargestSeries(frames));
  frames.sort((a, b) => {
    return (panorama.has(b) - panorama.has(a)) || compareFrames(a, b);
  }).forEach(frame => {
    if (picked.length >= feed.maxFrames) return;
    const isNew = picked.every(other => dot(other.direction, frame.direction) < minCosine);
    if (isNew) picked.push(frame);
  });

  // The first frame is drawn over the others. A shot of the land is exposed
  // for the land, and a shot of the sky makes the land dark, so the shots that
  // look down go first.
  return picked.sort((a, b) => looksUp(a) - looksUp(b));
}

function looksUp(frame) {
  // The third part of a direction is how much it goes down
  return frame.direction[2] < 0 ? 1 : 0;
}

/**
 * Finds the longest run of complete frames that were taken one after another.
 */
function getLargestSeries(frames) {
  const byTime = frames.filter(frame => frame.coverage > 0.9).sort((a, b) => a.date - b.date);
  let largest = [];
  let current = [];

  byTime.forEach((frame, index) => {
    const previous = byTime[index - 1];
    if (previous && frame.date - previous.date > MAX_PAUSE_IN_SERIES) current = [];
    current.push(frame);
    if (current.length > largest.length) largest = current;
  });
  return largest;
}
