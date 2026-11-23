/**
 * Tells how Mars is seen from Earth at a given moment: which side of the
 * planet is turned to us, how far it is, and how much of its disc is lit.
 *
 * The planets are placed on their orbits by the "Approximate Positions of
 * the Planets" of JPL (E. M. Standish), which are good for the years from
 * 1800 to 2050:
 * https://ssd.jpl.nasa.gov/planets/approx_pos.html
 *
 * The way Mars is turned comes from the report of the IAU working group on
 * cartographic coordinates: where its North pole points, and how fast the
 * planet spins around it.
 *
 * Compared with the ephemeris of JPL (Horizons) the center of the disc is
 * within half a degree, see tools/check_mars_from_earth.mjs
 */
const DEGREES = Math.PI / 180;
const MILLISECONDS_IN_DAY = 86400000;
// Terrestrial time runs ahead of UTC, see ./marsTime.js
const TT_MINUS_UTC = 69.184;
const KM_IN_ASTRONOMICAL_UNIT = 149597870.7;
const LIGHT_SPEED_KM_PER_SECOND = 299792.458;
// The equator of Earth is tilted to its orbit by this many degrees (J2000)
const OBLIQUITY = 23.43928;

// Each row is a value at the start of 2000, and how much it changes in a
// century: the size of the orbit (astronomical units), how stretched it is,
// its tilt, the mean longitude of the planet, the longitude of the point
// that is the closest to the Sun, and of the point where the orbit crosses
// the orbit of Earth going North (all in degrees).
const EARTH = [
  [1.00000261, 0.00000562],
  [0.01671123, -0.00004392],
  [-0.00001531, -0.01294668],
  [100.46457166, 35999.37244981],
  [102.93768193, 0.32327364],
  [0, 0]
];
const MARS = [
  [1.52371034, 0.00001847],
  [0.09339410, 0.00007882],
  [1.84969142, -0.00813131],
  [-4.55343205, 19140.30268499],
  [-23.94362959, 0.44441088],
  [49.55953891, -0.29257343]
];

/**
 * Returns:
 *
 * - `longitude`, `latitude` - the place on Mars that is in the middle of the
 *   disc when it is looked at from Earth, in degrees. Longitude points East.
 * - `distance` - from Earth to Mars, in kilometers
 * - `lightTime` - how long the light travels that far, in seconds. What is
 *   seen from Earth has happened on Mars that long ago.
 * - `litFraction` - the part of the disc that is lit by the Sun, from 0 to 1
 */
export function seeMarsFromEarth(date = new Date()) {
  const days = date.getTime() / MILLISECONDS_IN_DAY + 2440587.5 - 2451545.0 + TT_MINUS_UTC / 86400;
  const earth = getPosition(EARTH, days);

  // We see Mars where it was when the light has left it
  let lightDays = 0;
  let mars;
  let toEarth;
  for (let i = 0; i < 3; ++i) {
    mars = getPosition(MARS, days - lightDays);
    toEarth = subtract(earth, mars);
    lightDays = length(toEarth) * KM_IN_ASTRONOMICAL_UNIT / LIGHT_SPEED_KM_PER_SECOND / 86400;
  }

  const daysOnMars = days - lightDays;
  const centuries = daysOnMars / 36525;
  // Where the North pole of Mars points to, and how far the planet has
  // turned around it:
  const poleRightAscension = (317.68143 - 0.1061 * centuries) * DEGREES;
  const poleDeclination = (52.88650 - 0.0609 * centuries) * DEGREES;
  const primeMeridian = 176.630 + 350.89198226 * daysOnMars;

  const pole = [
    Math.cos(poleDeclination) * Math.cos(poleRightAscension),
    Math.cos(poleDeclination) * Math.sin(poleRightAscension),
    Math.sin(poleDeclination)
  ];
  // The equator of Mars crosses the equator of Earth here, going North:
  const node = [-Math.sin(poleRightAscension), Math.cos(poleRightAscension), 0];
  const quarterAfterNode = cross(pole, node);

  const direction = normalize(toEquator(toEarth));
  const fromNode = Math.atan2(dot(direction, quarterAfterNode), dot(direction, node)) / DEGREES;

  // The Sun, Mars and Earth make a triangle. The angle at Mars tells how
  // much of the lit half is turned to Earth.
  const toSun = normalize(mars.map(value => -value));
  const phaseCosine = dot(normalize(toEarth), toSun);

  return {
    longitude: normalizeLongitude(fromNode - primeMeridian),
    latitude: Math.asin(dot(direction, pole)) / DEGREES,
    distance: length(toEarth) * KM_IN_ASTRONOMICAL_UNIT,
    lightTime: lightDays * 86400,
    litFraction: (1 + phaseCosine) / 2
  };
}

/**
 * Where a planet is relative to the Sun, in astronomical units. The first
 * axis points to where the Sun is seen from Earth at the March equinox, and
 * the third one sticks out of the orbit of Earth (ecliptic of J2000).
 *
 * `days` are counted from the noon of January 1, 2000
 */
function getPosition(orbit, days) {
  const centuries = days / 36525;
  const [size, eccentricity, tilt, longitude, perihelion, node] = orbit.map(([value, change]) => value + change * centuries);

  const fromNodeToPerihelion = (perihelion - node) * DEGREES;
  const meanAnomaly = normalizeLongitude(longitude - perihelion) * DEGREES;
  // Kepler's equation tells where the planet is on its ellipse
  let anomaly = meanAnomaly + eccentricity * Math.sin(meanAnomaly);
  for (let i = 0; i < 8; ++i) {
    anomaly -= (anomaly - eccentricity * Math.sin(anomaly) - meanAnomaly) / (1 - eccentricity * Math.cos(anomaly));
  }
  // In the plane of the orbit, the first axis points to the perihelion
  const x = size * (Math.cos(anomaly) - eccentricity);
  const y = size * Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(anomaly);

  const cosW = Math.cos(fromNodeToPerihelion);
  const sinW = Math.sin(fromNodeToPerihelion);
  const cosNode = Math.cos(node * DEGREES);
  const sinNode = Math.sin(node * DEGREES);
  const cosTilt = Math.cos(tilt * DEGREES);
  const sinTilt = Math.sin(tilt * DEGREES);

  return [
    (cosW * cosNode - sinW * sinNode * cosTilt) * x + (-sinW * cosNode - cosW * sinNode * cosTilt) * y,
    (cosW * sinNode + sinW * cosNode * cosTilt) * x + (-sinW * sinNode + cosW * cosNode * cosTilt) * y,
    sinW * sinTilt * x + cosW * sinTilt * y
  ];
}

/**
 * Turns a vector from the plane of the orbit of Earth to the plane of its equator
 */
function toEquator([x, y, z]) {
  const cos = Math.cos(OBLIQUITY * DEGREES);
  const sin = Math.sin(OBLIQUITY * DEGREES);
  return [x, y * cos - z * sin, y * sin + z * cos];
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function length(a) {
  return Math.sqrt(dot(a, a));
}

function normalize(a) {
  const size = length(a);
  return [a[0] / size, a[1] / size, a[2] / size];
}

function normalizeLongitude(angle) {
  return ((((angle + 180) % 360) + 360) % 360) - 180;
}
