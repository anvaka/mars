/**
 * Everything we know about the named places of Mars: mountains, craters,
 * valleys, landing sites. The list is made by tools/build_labels.py from the
 * Gazetteer of Planetary Nomenclature, and is loaded when it is first needed.
 *
 * Each feature is `{id, name, type, class, lon, lat, size, box, many, named, wiki}`:
 *
 * - `type` is how astronomers call this kind of feature ("Mons", "Crater")
 * - `size` is its largest dimension in kilometers
 * - `box` is the rectangle that holds it: [west, south, east, north]
 * - `many` is set when one name is given to several things ("Tharsis Montes")
 * - `named` tells what the feature is named after
 * - `wiki` is the title of the Wikipedia article about it
 *
 * Landing sites also have `year` of the landing, and a few words `about` them.
 */
const FEATURES_URL = new URL('.', document.baseURI).href + 'data/mars-features.json';
const DEGREES = Math.PI / 180;
const KM_PER_DEGREE = 3396.19 * DEGREES;
// The map does not show the land closer to the poles than this
const MAX_MAP_LATITUDE = 85;

/**
 * The names of the feature types are Latin. This is what they are in plain
 * words: for one feature, and for several of them under one name. Long and
 * narrow features are measured along, the others - across.
 */
const KINDS = {
  'Crater': ['Crater', 'Craters'],
  'Mons': ['Mountain', 'Mountains'],
  'Tholus': ['Domed mountain', 'Domed mountains'],
  'Patera': ['Irregular crater', 'Irregular craters'],
  'Vallis': ['Valley', 'Valleys', 'long'],
  'Chasma': ['Canyon', 'Canyons', 'long'],
  'Fossa': ['Trough', 'Troughs', 'long'],
  'Labyrinthus': ['Maze of valleys', 'Maze of valleys'],
  'Catena': ['Chain of craters', 'Chains of craters', 'long'],
  'Chaos': ['Chaotic terrain', 'Chaotic terrain'],
  'Terra': ['Highlands', 'Highlands'],
  'Planitia': ['Lowland plain', 'Lowland plains'],
  'Planum': ['Plateau', 'Plateaus'],
  'Vastitas': ['Vast lowland plain', 'Vast lowland plains'],
  'Mensa': ['Mesa', 'Mesas'],
  'Dorsum': ['Ridge', 'Ridges', 'long'],
  'Cavus': ['Pit', 'Pits'],
  'Rupes': ['Cliff', 'Cliffs', 'long'],
  'Collis': ['Hill', 'Hills'],
  'Sulcus': ['Furrows and ridges', 'Furrows and ridges'],
  'Scopulus': ['Irregular cliff', 'Irregular cliffs', 'long'],
  'Labes': ['Landslide', 'Landslides'],
  'Unda': ['Dunes', 'Dunes'],
  'Palus': ['Small plain', 'Small plains'],
  'Lingula': ['Tongue of a plateau', 'Tongues of a plateau'],
  'Serpens': ['Winding ridge', 'Winding ridges', 'long'],
  'Fluctus': ['Flow terrain', 'Flow terrain'],
  'Macula': ['Dark spot', 'Dark spots'],
  // A bright or dark marking seen through a telescope. It was named before
  // spacecraft showed the terrain, and does not follow it.
  'Albedo Feature': ['Region of the old telescope maps', 'Regions of the old telescope maps']
};

let request;

/**
 * Resolves with array of all the features.
 */
export function loadFeatures() {
  if (!request) {
    request = fetch(FEATURES_URL).then(response => {
      if (!response.ok) throw new Error('Could not load the list of Mars features: ' + response.status);
      return response.json();
    }).then(features => {
      features.forEach(feature => {
        feature.searchName = simplify(feature.name);
      });
      return features;
    }).catch(e => {
      // let the next call try again
      request = null;
      throw e;
    });
  }
  return request;
}

/**
 * Resolves with the feature that has the given id, if there is one.
 */
export function findFeature(id) {
  return loadFeatures().then(features => features.find(feature => String(feature.id) === String(id)));
}

/**
 * Resolves with features whose names match what the visitor has typed. The
 * better matches go first, and among the equal ones - the larger features.
 */
export function searchFeatures(text, limit = 8) {
  const query = simplify(text);
  if (!query) return Promise.resolve([]);

  return loadFeatures().then(features => {
    const found = [];
    features.forEach(feature => {
      const quality = getMatchQuality(feature.searchName, query);
      if (quality) found.push({ feature, quality });
    });

    return found.sort((a, b) => {
      return (b.quality - a.quality) || (getImportance(b.feature) - getImportance(a.feature));
    }).slice(0, limit).map(match => match.feature);
  });
}

function getMatchQuality(name, query) {
  const at = name.indexOf(query);
  if (at < 0) return 0;
  if (name.length === query.length) return 4;
  if (at === 0) return 3;
  // "mons" finds "Olympus Mons" before it finds "Simonsen"
  if (name[at - 1] === ' ') return 2;
  return 1;
}

function getImportance(feature) {
  // People look for rovers more often than for craters of the same name
  return feature.class === 'landing' ? 10000 : (feature.size || 0);
}

function simplify(text) {
  // "Lycus Sulci" and "lýcus  sulci" are the same
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Tells what kind of feature it is in plain words, and how large it is:
 * "Mountain · 89 km across"
 */
export function describeFeature(feature) {
  if (feature.class === 'landing') return `${feature.type} · landed in ${feature.year}`;

  const kind = KINDS[feature.type];
  if (!kind) return feature.type;

  const name = kind[feature.many ? 1 : 0];
  if (!feature.size) return name;

  const size = feature.size < 10 ? feature.size.toFixed(1) : Math.round(feature.size).toLocaleString('en-US');
  return `${name} · ${size} km ${kind[2] || 'across'}`;
}

export function formatCoordinates(feature) {
  const latitude = Math.abs(feature.lat).toFixed(2) + '°' + (feature.lat < 0 ? 'S' : 'N');
  const longitude = Math.abs(feature.lon).toFixed(2) + '°' + (feature.lon < 0 ? 'W' : 'E');
  return latitude + ' ' + longitude;
}

/**
 * Gives the line that goes around the feature, as array of [longitude,
 * latitude] points. Craters are round, so their line is exact. For the others
 * we only know the rectangle they fit in, and the line is an oval inside of
 * it. Returns nothing when the outline would be misleading.
 */
export function getOutline(feature) {
  if (!feature.size) return null;
  if (feature.class === 'crater') return getCircle(feature.lon, feature.lat, feature.size / 2);

  const box = feature.box;
  if (!box) return null;
  const [west, south, east, north] = box;
  // An oval is a poor picture of something that goes around the planet,
  // or over the pole
  if (east - west > 180 || Math.max(Math.abs(south), Math.abs(north)) > MAX_MAP_LATITUDE) return null;

  const points = [];
  for (let i = 0; i <= 72; ++i) {
    const angle = i * 5 * DEGREES;
    points.push([
      (west + east) / 2 + Math.cos(angle) * (east - west) / 2,
      (south + north) / 2 + Math.sin(angle) * (north - south) / 2
    ]);
  }
  return points;
}

/**
 * Circle on a sphere: all the points that are `radius` kilometers away from
 * the center.
 */
function getCircle(longitude, latitude, radius) {
  const distance = radius / KM_PER_DEGREE * DEGREES;
  const sinLat = Math.sin(latitude * DEGREES);
  const cosLat = Math.cos(latitude * DEGREES);

  const points = [];
  for (let i = 0; i <= 72; ++i) {
    const bearing = i * 5 * DEGREES;
    const sinPointLat = sinLat * Math.cos(distance) + cosLat * Math.sin(distance) * Math.cos(bearing);
    const pointLat = Math.asin(Math.max(-1, Math.min(1, sinPointLat)));
    const pointLon = Math.atan2(
      Math.sin(bearing) * Math.sin(distance) * cosLat,
      Math.cos(distance) - sinLat * sinPointLat
    );
    points.push([longitude + pointLon / DEGREES, pointLat / DEGREES]);
  }
  return points;
}

/**
 * Gives the part of the map that shows the entire feature, as
 * [[west, south], [east, north]]. Returns nothing if the size of the feature
 * is not known.
 */
export function getBounds(feature) {
  let box = feature.box;
  if (!box) {
    if (!feature.size) return null;
    const half = feature.size / 2 / KM_PER_DEGREE;
    const halfWidth = half / Math.max(0.1, Math.cos(feature.lat * DEGREES));
    box = [feature.lon - halfWidth, feature.lat - half, feature.lon + halfWidth, feature.lat + half];
  }

  const [west, south, east, north] = box;
  if (east - west > 180) return null;
  return [
    [west, Math.max(south, -MAX_MAP_LATITUDE)],
    [east, Math.min(north, MAX_MAP_LATITUDE)]
  ];
}

/**
 * Describes the land that the feature takes, to measure it: `box` is the
 * rectangle around it ([west, south, east, north]), and `contains(longitude,
 * latitude)` tells if a point of the rectangle belongs to the feature.
 * Returns nothing when we do not know where the feature ends.
 */
export function getArea(feature) {
  if (!feature.size) return null;

  if (feature.class === 'crater') {
    // A bit wider than the crater, to have its rim inside
    const radius = 1.05 * feature.size / 2 / KM_PER_DEGREE;
    const cosLat = Math.cos(feature.lat * DEGREES);
    if (Math.abs(feature.lat) + radius > MAX_MAP_LATITUDE) return null;

    return {
      box: [feature.lon - radius / cosLat, feature.lat - radius, feature.lon + radius / cosLat, feature.lat + radius],
      contains(longitude, latitude) {
        // Small circles are close to flat, no need for the spherical math
        const east = (longitude - feature.lon) * cosLat;
        const north = latitude - feature.lat;
        return east * east + north * north <= radius * radius;
      }
    };
  }

  // The same oval that is drawn on the map
  if (!feature.box || !getOutline(feature)) return null;
  const [west, south, east, north] = feature.box;
  return {
    box: feature.box,
    contains(longitude, latitude) {
      const x = (longitude - (west + east) / 2) / ((east - west) / 2);
      const y = (latitude - (south + north) / 2) / ((north - south) / 2);
      return x * x + y * y <= 1;
    }
  };
}
