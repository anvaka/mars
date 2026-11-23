/**
 * Compares our simple astronomy (src/lib/marsFromEarth.js and
 * src/lib/marsTime.js) with the ephemeris of JPL:
 *
 *     node tools/check_mars_from_earth.mjs
 *
 * The numbers below are the answers of the Horizons system
 * (https://ssd.jpl.nasa.gov/horizons/) for Mars seen from the center of
 * Earth: the part of the disc that is lit (percent), the place in the middle
 * of the disc, the place where the Sun is overhead (degrees, longitude
 * points West), and the distance (astronomical units).
 */
import { seeMarsFromEarth } from '../src/lib/marsFromEarth.js';
import { getMarsTime } from '../src/lib/marsTime.js';

const HORIZONS = [
  ['1969-07-20T20:17:00Z', 90.71939, 51.505487, 11.951080, 20.500934, -5.786684, 0.59124993666983],
  ['1990-03-15T08:00:00Z', 92.17198, 234.238018, -16.060317, 264.194380, -2.277480, 1.84209241928304],
  ['2003-08-27T09:51:00Z', 99.80949, 122.224614, -19.012240, 124.282160, -23.673300, 0.37271867296113],
  ['2015-02-14T20:30:00Z', 96.79256, 259.075941, -26.294417, 236.529851, -23.593653, 2.17289071639540],
  ['2020-10-13T23:00:00Z', 99.96610, 157.136196, -20.709220, 156.636874, -22.785350, 0.41921599350712],
  ['2026-11-22T12:00:00Z', 89.58145, 71.326978, 22.308924, 108.831916, 10.695730, 1.25143645827662],
  ['2040-06-01T00:00:00Z', 91.73498, 274.841574, 19.638778, 239.147745, 25.285530, 1.82338768718413]
];
const KM_IN_ASTRONOMICAL_UNIT = 149597870.7;
// The poster is a picture of a globe, where a degree is a couple of pixels
const LARGEST_ERROR_IN_DEGREES = 0.5;

let worst = 0;
HORIZONS.forEach(([time, lit, longitudeWest, latitude, sunLongitudeWest, sunLatitude, distance]) => {
  const date = new Date(time);
  const seen = seeMarsFromEarth(date);
  // What we see has happened when the light has left Mars
  const sun = getMarsTime(new Date(date.getTime() - seen.lightTime * 1000));

  const errors = {
    longitude: getAngle(seen.longitude, -longitudeWest),
    latitude: seen.latitude - latitude,
    sunLongitude: getAngle(sun.subsolarLongitude, -sunLongitudeWest),
    sunLatitude: sun.subsolarLatitude - sunLatitude
  };
  const litError = seen.litFraction * 100 - lit;
  const distanceError = (seen.distance / KM_IN_ASTRONOMICAL_UNIT / distance - 1) * 100;
  Object.values(errors).forEach(error => { worst = Math.max(worst, Math.abs(error)); });

  console.log(time, Object.entries(errors).map(([name, error]) => `${name} ${error.toFixed(2)}°`).join(', ') +
    `, lit ${litError.toFixed(2)}%, distance ${distanceError.toFixed(3)}%`);
});

console.log(`The largest error is ${worst.toFixed(2)}°`);
if (worst > LARGEST_ERROR_IN_DEGREES) {
  console.error(`It should not be larger than ${LARGEST_ERROR_IN_DEGREES}°`);
  process.exit(1);
}

function getAngle(a, b) {
  return ((a - b + 540) % 360) - 180;
}
