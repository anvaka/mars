/**
 * Tells where the Sun is relative to Mars at a given moment on Earth.
 *
 * This is the Mars24 algorithm by Allison and McEwen:
 * https://www.giss.nasa.gov/tools/mars24/help/algorithm.html
 *
 * The step names in the comments (A-2, B-1, ...) match the names on that page.
 * Longitudes here point East, as they do on our map.
 */
const DEGREES = Math.PI / 180;
const MILLISECONDS_IN_DAY = 86400000;

// Terrestrial time runs ahead of UTC. The difference grows with every leap
// second. The last one was added on December 31, 2016.
const TT_MINUS_UTC = 69.184;

// One day on Mars (sol) is this many days on Earth
export const SOL_IN_EARTH_DAYS = 1.0274912517;

// From one spring equinox of Mars to the next, in days of Earth
const YEAR_IN_EARTH_DAYS = 686.9726;
// Mars Year 1 began on April 11, 1955
const START_OF_YEAR_1 = Date.UTC(1955, 3, 11);

// Other planets pull Mars a little bit: [amplitude in degrees, period in
// years, phase in degrees]
const PERTURBERS = [
  [0.0071, 2.2353, 49.409],
  [0.0057, 2.7543, 168.173],
  [0.0039, 1.1177, 191.837],
  [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704],
  [0.0020, 2.4694, 95.528],
  [0.0018, 32.8493, 49.095],
];

/**
 * Returns the state of Mars clock and calendar:
 *
 * - `solarLongitude` (Ls) - season, in degrees. 0 is the Northern spring
 *   equinox, 90 is the Northern summer solstice, and so on.
 * - `subsolarLongitude`, `subsolarLatitude` - point on Mars where the Sun is
 *   right above the head, in degrees
 * - `coordinatedTime` - mean solar time at the prime meridian (MTC), in hours
 * - `equationOfTime` - how far the real Sun is ahead of the mean one, in hours
 * - `solDate` - number of sols since December 29, 1873 (MSD)
 * - `sunDistance` - distance to the Sun in astronomical units
 */
export function getMarsTime(date = new Date(), ttMinusUtc = TT_MINUS_UTC) {
  // A-2, A-5: days since noon of January 1, 2000 (Terrestrial Time)
  const julianDate = 2440587.5 + date.getTime() / MILLISECONDS_IN_DAY + ttMinusUtc / 86400;
  const days = julianDate - 2451545.0;

  // B-1: mean anomaly, the position of Mars on its orbit, if the orbit was a circle
  const meanAnomaly = (19.3871 + 0.52402073 * days) * DEGREES;
  // B-2: angle of the "fictitious mean sun"
  const meanSun = 270.3871 + 0.524038496 * days;
  // B-3
  let perturbation = 0;
  PERTURBERS.forEach(([amplitude, period, phase]) => {
    perturbation += amplitude * Math.cos((0.985626 * days / period + phase) * DEGREES);
  });
  // B-4: the orbit is an ellipse. This is how far Mars is from where it
  // would have been on the circle
  const equationOfCenter = (10.691 + 3.0e-7 * days) * Math.sin(meanAnomaly) +
    0.623 * Math.sin(2 * meanAnomaly) +
    0.050 * Math.sin(3 * meanAnomaly) +
    0.005 * Math.sin(4 * meanAnomaly) +
    0.0005 * Math.sin(5 * meanAnomaly) +
    perturbation;
  // B-5
  const solarLongitude = normalizeDegrees(meanSun + equationOfCenter);
  const ls = solarLongitude * DEGREES;

  // C-1
  const equationOfTimeDegrees = 2.861 * Math.sin(2 * ls) -
    0.071 * Math.sin(4 * ls) +
    0.002 * Math.sin(6 * ls) -
    equationOfCenter;
  // C-2
  const solDate = (julianDate - 2451549.5) / SOL_IN_EARTH_DAYS + 44796.0 - 0.0009626;
  const coordinatedTime = normalizeHours(24 * solDate);
  // C-5. The original formula gives West longitude.
  const subsolarLongitudeWest = coordinatedTime * 15 + equationOfTimeDegrees + 180;

  // D-1
  const subsolarLatitude = Math.asin(0.42565 * Math.sin(ls)) / DEGREES + 0.25 * Math.sin(ls);
  // D-2
  const sunDistance = 1.52367934 * (1.00436 -
    0.09309 * Math.cos(meanAnomaly) -
    0.004336 * Math.cos(2 * meanAnomaly) -
    0.00031 * Math.cos(3 * meanAnomaly) -
    0.00003 * Math.cos(4 * meanAnomaly));

  return {
    date,
    solarLongitude,
    subsolarLongitude: normalizeLongitude(-subsolarLongitudeWest),
    subsolarLatitude,
    coordinatedTime,
    equationOfTime: equationOfTimeDegrees / 15,
    solDate,
    sunDistance,
  };
}

/**
 * The calendar of Mars. Years are counted the way the scientists do: the
 * year starts at the Northern spring equinox, and Mars Year 1 began on
 * April 11, 1955 (Clancy et al., 2000). Returns `{year, sol}`, where `sol`
 * is the day of that year, starting from 1. A year has 668 or 669 of them.
 */
export function getMarsYear(date = new Date()) {
  // Find when the current year began: the moment when the season was 0.
  // Mars moves faster when it is closer to the Sun, so we get there in a
  // few steps.
  const season = getMarsTime(date).solarLongitude;
  let start = date.getTime() - season / 360 * YEAR_IN_EARTH_DAYS * MILLISECONDS_IN_DAY;
  for (let i = 0; i < 8; ++i) {
    const missed = normalizeLongitude(getMarsTime(new Date(start)).solarLongitude);
    start -= missed / 360 * YEAR_IN_EARTH_DAYS * MILLISECONDS_IN_DAY;
  }

  const sol = Math.floor((date.getTime() - start) / (SOL_IN_EARTH_DAYS * MILLISECONDS_IN_DAY)) + 1;
  const year = Math.round((start - START_OF_YEAR_1) / (YEAR_IN_EARTH_DAYS * MILLISECONDS_IN_DAY)) + 1;
  return { year, sol: Math.max(1, sol) };
}

/**
 * Local solar time in hours: the Sun is at its highest at 12, wherever you are.
 */
export function getLocalSolarTime(marsTime, longitude) {
  return normalizeHours(12 + (longitude - marsTime.subsolarLongitude) / 15);
}

/**
 * Tells where the Sun is in the sky of a place on Mars, when the clock on the
 * wall of that place shows the given local solar time.
 *
 * Returns `{east, north, up}` - unit vector that points to the Sun, and
 * `elevation` and `azimuth` in degrees. The azimuth is counted from the North
 * towards the East.
 */
export function getSunDirection(latitude, subsolarLatitude, localSolarTime) {
  const hourAngle = (localSolarTime - 12) * 15 * DEGREES;
  const lat = latitude * DEGREES;
  const declination = subsolarLatitude * DEGREES;

  const east = -Math.cos(declination) * Math.sin(hourAngle);
  const north = Math.cos(lat) * Math.sin(declination) -
    Math.sin(lat) * Math.cos(declination) * Math.cos(hourAngle);
  const up = Math.sin(lat) * Math.sin(declination) +
    Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);

  return {
    east, north, up,
    elevation: Math.asin(Math.max(-1, Math.min(1, up))) / DEGREES,
    azimuth: normalizeDegrees(Math.atan2(east, north) / DEGREES),
  };
}

/**
 * Human name of the season in the given hemisphere
 */
export function getSeasonName(solarLongitude, latitude) {
  const names = ['spring', 'summer', 'autumn', 'winter'];
  let season = Math.floor(normalizeDegrees(solarLongitude) / 90);
  // Seasons of the South are half a year away:
  if (latitude < 0) season = (season + 2) % 4;
  return names[season];
}

/**
 * Turns 13.5 into "13:30"
 */
export function formatHours(hours) {
  let minutes = Math.round(normalizeHours(hours) * 60) % (24 * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

function normalizeDegrees(angle) {
  return ((angle % 360) + 360) % 360;
}

function normalizeLongitude(angle) {
  return normalizeDegrees(angle + 180) - 180;
}

function normalizeHours(hours) {
  return ((hours % 24) + 24) % 24;
}
