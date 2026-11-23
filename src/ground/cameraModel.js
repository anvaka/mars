/**
 * Tells which direction each pixel of a rover photo looks at.
 *
 * NASA publishes a "camera model" with every raw image of a rover. The model
 * is called CAHVORE, after the names of its parameters:
 *
 * - C - where the camera is
 * - A - the direction the camera looks at
 * - H, V - horizontal and vertical directions of the picture, mixed with the
 *   focal length and the position of the picture's center
 * - O, R - optical axis and the coefficients of the lens distortion
 * - E - how the entrance of the lens moves (matters only for close objects,
 *   we ignore it)
 *
 * The math follows `cmod_cahvore_2d_to_3d()` of the JPL camera model library.
 * Simpler models (CAHV, CAHVOR) are the special cases of it.
 */

const PERSPECTIVE = 1;
const FISHEYE = 2;

/**
 * Parses the camera description of the raw images API.
 *
 * @param {String} components - "C;A;H;V;O;R;E;type;parameter", where the
 * vectors look like "(x,y,z)"
 */
export function parseCameraModel(components) {
  const parts = String(components || '').split(';');
  const vectors = parts.filter(part => part.indexOf('(') >= 0).map(parseVector);
  if (vectors.length < 4 || vectors.some(vector => vector.length !== 3 || vector.some(Number.isNaN))) {
    return null;
  }

  const [c, a, h, v] = vectors;
  const model = { c, a, h, v, o: vectors[4] || a, r: vectors[5] || [0, 0, 0], linearity: 1 };

  if (vectors.length >= 7) {
    // Only the full model tells what kind of lens it is
    const numbers = parts.filter(part => part.indexOf('(') < 0).map(Number.parseFloat);
    const type = Math.round(numbers[0]);
    if (type === FISHEYE) model.linearity = 0;
    else if (type !== PERSPECTIVE && Number.isFinite(numbers[1])) model.linearity = numbers[1];
  }
  return model;
}

export function parseVector(text) {
  return String(text).replace(/[()\s]/g, '').split(',').map(Number.parseFloat);
}

/**
 * Returns unit vector of the direction that pixel `x, y` of the picture looks
 * at. The vector is in the same coordinate frame as the model (rover's frame).
 */
export function getPixelDirection(model, x, y) {
  const { a, h, v, o, r } = model;

  // Direction of the pixel, as if there was no lens distortion:
  const ideal = cross(subtract(v, scale(a, y)), subtract(h, scale(a, x)));
  const sign = dot(a, cross(v, h)) < 0 ? -1 : 1;
  const direction = scale(ideal, sign);

  // Split it into the part along the optical axis and the part across it
  const along = dot(direction, o);
  const across = subtract(direction, scale(o, along));
  const acrossLength = length(across);
  const distorted = acrossLength / along;
  if (!(distorted > 1e-8)) return normalize(o);

  // The lens moves pixels away from the axis, according to the polynomial
  // with coefficients R. Find where the pixel was before that:
  let tangent = distorted;
  for (let i = 0; i < 20; ++i) {
    const t2 = tangent * tangent;
    const t4 = t2 * t2;
    const value = (1 + r[0]) * tangent + r[1] * tangent * t2 + r[2] * tangent * t4 - distorted;
    const derivative = (1 + r[0]) + 3 * r[1] * t2 + 5 * r[2] * t4;
    const step = value / derivative;
    tangent -= step;
    if (Math.abs(step) < 1e-9) break;
  }

  // The meaning of what we have found depends on the lens. For a regular
  // lens it is a tangent of the angle from the axis, for a fisheye lens it
  // is the angle itself.
  let angle = tangent;
  if (model.linearity > 1e-6) angle = Math.atan(model.linearity * tangent) / model.linearity;
  else if (model.linearity < -1e-6) angle = Math.asin(model.linearity * tangent) / model.linearity;

  return normalize(add(
    scale(across, Math.sin(angle) / acrossLength),
    scale(o, Math.cos(angle))
  ));
}

/**
 * Rotates a vector by a quaternion `[w, x, y, z]`.
 */
export function rotate(quaternion, vector) {
  const [w, x, y, z] = quaternion;
  const axis = [x, y, z];
  const t = scale(cross(axis, vector), 2);
  return add(add(vector, scale(t, w)), cross(axis, t));
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a, factor) {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

export function length(a) {
  return Math.sqrt(dot(a, a));
}

export function normalize(a) {
  return scale(a, 1 / length(a));
}
