/**
 * Routes of the rovers.
 *
 * For those that still drive NASA publishes the routes for its own "Where is
 * the rover" maps, and updates them after every drive:
 *
 * https://science.nasa.gov/mission/mars-2020-perseverance/location-map/
 * https://science.nasa.gov/mission/msl-curiosity/location-map/
 *
 * The routes of Spirit and Opportunity will not change anymore. They are
 * stored with the website (`public/data/rovers`), and are made from the
 * archives by tools/build_rover_archive.py
 */
import { getRoverSounds } from './roverSounds.js';

const LAYERS_URL = 'https://mars.nasa.gov/mmgis-maps/';
const ARCHIVE_URL = new URL('.', document.baseURI).href + 'data/rovers/';
// Pieces of a route that are this close (in degrees, about 600 meters) are
// drawn as one line. Anything farther is not a pause between two drives.
const LARGEST_GAP_IN_ROUTE = 0.01;

export const ROVERS = {
  M20: {
    name: 'Perseverance',
    // Where to look for the rover on the map
    home: [77.35, 18.45],
    // Photos of the land around the route, taken from the orbit. These are
    // the base maps of the NASA's own rover maps.
    imagery: [{
      tiles: LAYERS_URL + 'M20/Layers/M20_HiRISE_RGB_CTX_mosaic_25cm_v7_Merge_LERC_clip/{z}/{x}/{y}.png',
      bounds: [77.15751489, 18.23712426, 77.51146566, 18.52055001],
      minzoom: 10,
      maxzoom: 19,
      // Sharp enough to paint the land of the ground view with
      isDetailed: true,
      attribution: 'NASA/JPL-Caltech/University of Arizona'
    }]
  },
  MSL: {
    name: 'Curiosity',
    home: [137.4, -4.68],
    imagery: [{
      tiles: LAYERS_URL + 'MSL/Layers/MSL_CTX_ortho_mosaic_6m/{z}/{x}/{y}.png',
      bounds: [135.97876221689464, -7.84409099977539, 139.48590357790334, -3.39706499423008],
      minzoom: 6,
      maxzoom: 13,
      attribution: 'NASA/JPL-Caltech/MSSS'
    }, {
      tiles: LAYERS_URL + 'MSL/Layers/MSL_Gale_HiRISE-LRGB_78quads/{z}/{x}/{y}.png',
      bounds: [137.32672354505786, -4.87560429259321, 137.4785574965306, -4.55506331169111],
      minzoom: 10,
      maxzoom: 18,
      isDetailed: true,
      attribution: 'NASA/JPL-Caltech/University of Arizona'
    }]
  },
  MERA: {
    name: 'Spirit',
    home: [175.5, -14.59],
    // The route comes from the archive, and no map of NASA shows the land around it
    isArchived: true,
    imagery: []
  },
  MERB: {
    name: 'Opportunity',
    home: [-5.43, -2.1],
    isArchived: true,
    imagery: []
  }
};

const loaded = new Map();

/**
 * Resolves with the route of a rover:
 *
 * - `track` - GeoJSON with the line of the route, see `joinTrack()`
 * - `stops` - places where the rover stopped after each drive, from the first
 *   to the latest one: `{index, site, drive, sol, lastSol, longitude, latitude, heading}`
 * - `sounds` - what the rover has recorded with its microphones, and where:
 *   `[{sound, stop}]`, see ./roverSounds.js
 */
export function loadRover(id) {
  if (!loaded.has(id)) {
    const base = `${LAYERS_URL}${id}/Layers/json/${id}_`;
    const request = ROVERS[id].isArchived ? loadJSON(ARCHIVE_URL + id + '.json').then(archive => {
      return makeRover(id, getArchivedTrack(archive), getArchivedStops(archive));
    }) : Promise.all([loadJSON(base + 'waypoints.json'), loadJSON(base + 'traverse.json')])
      .then(([waypoints, track]) => makeRover(id, track, getStops(waypoints)));
    // If it did not work out, we want to try again the next time
    request.catch(() => loaded.delete(id));
    loaded.set(id, request);
  }
  return loaded.get(id);
}

function makeRover(id, track, stops) {
  // Mark the stops where we have something to listen to
  const sounds = getRoverSounds(id, stops);
  sounds.forEach(record => {
    record.stop.hasSound = true;
    record.stop.sounds = (record.stop.sounds || []).concat(record.sound.title);
  });

  return {
    id,
    name: ROVERS[id].name,
    imagery: ROVERS[id].imagery,
    track: joinTrack(track),
    stops,
    sounds
  };
}

/**
 * NASA gives a route as hundreds of short lines, one per drive. The map
 * drops lines that are shorter than a pixel, and from afar that is most of
 * them: the route falls apart. So we join the drives into one line.
 */
function joinTrack(track) {
  const lines = [];
  let last;
  track.features.forEach(feature => {
    const geometry = feature.geometry;
    if (!geometry) return;
    const pieces = geometry.type === 'LineString' ? [geometry.coordinates] :
      geometry.type === 'MultiLineString' ? geometry.coordinates : [];

    pieces.forEach(piece => {
      if (!piece.length) return;
      const line = lines[lines.length - 1];
      const [longitude, latitude] = piece[0];
      const isNear = last &&
        Math.hypot(longitude - last[0], latitude - last[1]) < LARGEST_GAP_IN_ROUTE;
      if (isNear) piece.forEach(point => line.push(point));
      else lines.push(piece.slice());
      last = piece[piece.length - 1];
    });
  });

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiLineString', coordinates: lines }
  };
}

/**
 * GeoJSON with the stops of a rover, for the map
 */
export function getStopsCollection(rover) {
  return {
    type: 'FeatureCollection',
    features: rover.stops.map(stop => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [stop.longitude, stop.latitude] },
      properties: {
        rover: rover.id,
        index: stop.index,
        sol: stop.sol,
        isLatest: stop.index === rover.stops.length - 1,
        hasSound: !!stop.hasSound,
        // What can be heard at the stop: "Wind, Laser shots"
        sounds: (stop.sounds || []).join(', '),
        label: `${rover.name} · sol ${stop.sol}`
      }
    }))
  };
}

export function findStop(rover, site, drive) {
  return rover.stops.find(stop => stop.site === site && stop.drive === drive);
}

function getStops(waypoints) {
  const stops = waypoints.features
    .map(feature => feature.properties)
    .filter(stop => Number.isFinite(stop.lon) && Number.isFinite(stop.lat))
    .sort((a, b) => (a.site - b.site) || (a.drive - b.drive))
    .map((stop, index) => ({
      index,
      site: stop.site,
      drive: stop.drive,
      sol: stop.sol,
      longitude: stop.lon,
      latitude: stop.lat,
      heading: stop.yaw
    }));

  stops.forEach((stop, index) => {
    const next = stops[index + 1];
    // The rover stays until the day of the next drive. Nobody knows how long
    // it is going to stay at the latest stop.
    stop.lastSol = next ? next.sol : stop.sol + 30;
  });
  return stops;
}

/**
 * The archive keeps the route as a plain list of points, and only the stops
 * where the rover looked around.
 */
function getArchivedTrack(archive) {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: archive.track } }]
  };
}

function getArchivedStops(archive) {
  return archive.stops.map((stop, index) => ({
    index,
    site: stop.site,
    drive: stop.drive,
    sol: stop.sol,
    lastSol: stop.lastSol,
    longitude: stop.lon,
    latitude: stop.lat,
    // Nobody wrote down where the rover looked, so we look to the North
    heading: 0
  }));
}

function loadJSON(url) {
  return fetch(url).then(response => {
    if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
    return response.json();
  });
}
