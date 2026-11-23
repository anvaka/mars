/**
 * The ground view lives on a flat sheet of paper that touches Mars at the
 * place where we stand. Every point of the planet is drawn on the sheet at its
 * true distance and true direction from us. Cartographers call this
 * "azimuthal equidistant projection".
 *
 * `x` grows to the East, `y` grows to the North, both are in meters.
 */

// Elevation of the map is counted from the sphere of this radius (in meters)
export const MARS_RADIUS = 3396190;

const DEGREES = Math.PI / 180;

export function createLocalProjection(centerLongitude, centerLatitude) {
  const lon0 = centerLongitude * DEGREES;
  const sinLat0 = Math.sin(centerLatitude * DEGREES);
  const cosLat0 = Math.cos(centerLatitude * DEGREES);

  return {
    longitude: centerLongitude,
    latitude: centerLatitude,
    project,
    unproject,
  };

  /**
   * Longitude and latitude in degrees to `[x, y]` in meters
   */
  function project(longitude, latitude) {
    const lat = latitude * DEGREES;
    const dLon = longitude * DEGREES - lon0;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const cosDLon = Math.cos(dLon);

    const cosAngle = sinLat0 * sinLat + cosLat0 * cosLat * cosDLon;
    const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
    const scale = angle < 1e-9 ? MARS_RADIUS : MARS_RADIUS * angle / Math.sin(angle);

    return [
      scale * cosLat * Math.sin(dLon),
      scale * (cosLat0 * sinLat - sinLat0 * cosLat * cosDLon)
    ];
  }

  /**
   * `x, y` in meters to `[longitude, latitude]` in degrees. Pass `result`
   * array to avoid making a new one on every call.
   */
  function unproject(x, y, result = [0, 0]) {
    const distance = Math.sqrt(x * x + y * y);
    if (distance < 1e-6) {
      result[0] = centerLongitude;
      result[1] = centerLatitude;
      return result;
    }

    const angle = distance / MARS_RADIUS;
    const sinAngle = Math.sin(angle);
    const cosAngle = Math.cos(angle);

    const sinLat = cosAngle * sinLat0 + y * sinAngle * cosLat0 / distance;
    const latitude = Math.asin(Math.max(-1, Math.min(1, sinLat)));
    const longitude = lon0 + Math.atan2(
      x * sinAngle,
      distance * cosLat0 * cosAngle - y * sinLat0 * sinAngle
    );

    result[0] = normalizeLongitude(longitude / DEGREES);
    result[1] = latitude / DEGREES;
    return result;
  }
}

export function normalizeLongitude(longitude) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}
