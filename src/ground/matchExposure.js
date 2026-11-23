/**
 * Finds how much brighter or darker every photo of a panorama should be made,
 * so that all of them look like they were taken with the same exposure.
 *
 * The camera of a rover picks the exposure anew for every shot: a shot with
 * a bright rover deck in it comes out darker than its neighbor that has only
 * the land. Neighbor shots overlap, so we take the places that both of them
 * see, and compare how bright these places are on each one. That gives a
 * ratio for every pair of neighbors, and then we look for the gains that
 * satisfy all the ratios in the best way.
 *
 * Red, green and blue are matched separately. The color of the sky changes
 * during the day, and with the dust in the air from day to day, and this
 * way a photo also gets the tint of its neighbors.
 */
import { getWorldDirection } from './loadRoverPhotos.js';

const DEGREES = Math.PI / 180;
// The sky is cut into cells of this many degrees. Two photos are compared by
// the cells that both of them see.
const CELL_SIZE = 2;
// A cell is good for the comparison if a photo has at least this many pixels in it
const MIN_PIXELS_IN_CELL = 3;
// Two photos are compared if they share at least this many cells
const MIN_SHARED_CELLS = 8;
// Too dark and too bright pixels tell nothing about the exposure
const DARKEST = 12;
const BRIGHTEST = 240;
// The corners of a photo are too dark to be trusted. This is the distance
// from the center of the sensor, 1 is its corner.
const FARTHEST_FROM_CENTER = 0.9;
// A shot of the sky is compared with the others only by what is this many
// degrees above the horizon. Such shots are often taken on another day and at
// another hour than the shots of the land: the land is lit differently there,
// and the sky is much the same.
const SKY_STARTS_AT = 2;
// How strongly the gains are pulled to one. It only matters for the photos
// that have nothing to be compared with.
const STIFFNESS = 0.01;

/**
 * @param {Array} frames - see ./loadRoverPhotos.js
 * @param {Function} getPicture - takes a tile and gives a small copy of its
 * picture: `{width, height, pixels}`, where the pixels are red, green, blue
 * and opacity (0..255) of each pixel, row after row. Gives nothing if the
 * tile has no picture.
 *
 * Returns `{gain, isCompared}` for each frame. The gain is `[red, green, blue]`,
 * and `isCompared` tells if the frame had a neighbor to be compared with. If
 * it had none, its gain is one.
 */
export function matchExposure(frames, getPicture) {
  const cells = frames.map(frame => getCells(frame, getPicture));
  const compared = new Set();
  const gains = [0, 1, 2].map(channel => matchChannel(frames, cells, channel, compared));
  return frames.map((frame, index) => ({
    gain: gains.map(ofChannel => ofChannel[index]),
    isCompared: compared.has(index)
  }));
}

/**
 * Tells the color of the sky on the photos, after their exposure is matched:
 * `gains` are the `gain` of every frame, as `matchExposure()` gave them.
 * Returns `[red, green, blue]`, each is 0..1, or nothing when no photo has
 * enough sky.
 */
export function getSkyColor(frames, getPicture, gains) {
  const cells = frames.map(frame => getCells(frame, getPicture));
  // Hills may be a few degrees high, so we look above them. But a panorama of
  // a plain often ends right above the horizon, and then we take what it has.
  return getColorAbove(SKY_STARTS_AT + 2 * CELL_SIZE) || getColorAbove(SKY_STARTS_AT);

  function getColorAbove(lowest) {
    const total = [0, 0, 0];
    let count = 0;
    cells.forEach((ofFrame, index) => {
      ofFrame.forEach(cell => {
        if (cell.elevation < lowest) return;
        count += 1;
        for (let channel = 0; channel < 3; ++channel) {
          total[channel] += cell.brightness[channel] + Math.log(gains[index][channel]);
        }
      });
    });
    if (count < MIN_SHARED_CELLS) return null;
    return total.map(sum => Math.min(1, Math.exp(sum / count) / 255));
  }
}

function matchChannel(frames, cells, channel, compared) {
  const pairs = [];

  for (let i = 0; i < frames.length; ++i) {
    for (let j = i + 1; j < frames.length; ++j) {
      // The third part of a direction is how much it goes down
      const onlySky = frames[i].direction[2] < 0 || frames[j].direction[2] < 0;
      const differences = [];
      cells[i].forEach((seen, cell) => {
        const other = cells[j].get(cell);
        if (!other || (onlySky && seen.elevation < SKY_STARTS_AT)) return;
        differences.push(seen.brightness[channel] - other.brightness[channel]);
      });
      if (differences.length < MIN_SHARED_CELLS) continue;

      // A part of the rover seen from two sides, or a shadow that has moved,
      // makes some cells very different. The median does not notice them.
      differences.sort((a, b) => a - b);
      pairs.push({ i, j, difference: differences[differences.length >> 1], weight: differences.length });
      compared.add(i).add(j);
    }
  }

  return solve(frames.length, pairs).map(Math.exp);
}

/**
 * Makes a map: cell of the sky -> how bright (as a logarithm) its red, green
 * and blue are on the frame, and how high over the horizon the cell is.
 */
function getCells(frame, getPicture) {
  const sums = new Map();

  frame.tiles.forEach(tile => {
    const picture = getPicture(tile);
    if (!picture) return;

    const { width, height, pixels } = picture;
    const [a, b, c, level] = tile.vignette || [0, 0, 0, 0];
    for (let row = 0; row < height; ++row) {
      for (let column = 0; column < width; ++column) {
        const offset = (row * width + column) * 4;
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        if (Math.min(red, green, blue) < DARKEST || Math.max(red, green, blue) > BRIGHTEST) continue;

        const x = (column + 0.5) / width * tile.width;
        const y = (row + 0.5) / height * tile.height;
        const fromCenter = Math.hypot(x - tile.lens.centerX, y - tile.lens.centerY) / tile.lens.radius;
        if (fromCenter > FARTHEST_FROM_CENTER) continue;

        const [north, east, down] = getWorldDirection(tile.model, tile.attitude, x, y);
        const azimuth = Math.floor(Math.atan2(east, north) / DEGREES / CELL_SIZE);
        const elevation = Math.floor(-Math.asin(down) / DEGREES / CELL_SIZE);
        const cell = azimuth * 1000 + elevation;

        // What the pixel would be without the darkening of the lens
        const r2 = fromCenter * fromCenter;
        const lens = a * r2 + b * r2 * r2 + c * r2 * r2 * r2 - level;

        let sum = sums.get(cell);
        if (!sum) {
          sum = { total: [0, 0, 0], count: 0, elevation: elevation * CELL_SIZE };
          sums.set(cell, sum);
        }
        sum.total[0] += Math.log(red) + lens;
        sum.total[1] += Math.log(green) + lens;
        sum.total[2] += Math.log(blue) + lens;
        sum.count += 1;
      }
    }
  });

  const cells = new Map();
  sums.forEach((sum, cell) => {
    if (sum.count >= MIN_PIXELS_IN_CELL) {
      cells.set(cell, { brightness: sum.total.map(total => total / sum.count), elevation: sum.elevation });
    }
  });
  return cells;
}

/**
 * Each pair says: "frame `i` is brighter than frame `j` by `difference`"
 * (everything is in logarithms). We look for the gains `g` that make
 * `g[i] - g[j] + difference` as close to zero as possible for all the pairs
 * at once. This is the method of least squares, and it ends up with a system
 * of linear equations.
 */
function solve(count, pairs) {
  const matrix = [];
  for (let i = 0; i < count; ++i) {
    matrix.push(new Float64Array(count + 1));
    matrix[i][i] = STIFFNESS;
  }

  pairs.forEach(({ i, j, difference, weight }) => {
    matrix[i][i] += weight;
    matrix[j][j] += weight;
    matrix[i][j] -= weight;
    matrix[j][i] -= weight;
    // The last column is the right side of the equations
    matrix[i][count] -= weight * difference;
    matrix[j][count] += weight * difference;
  });

  // Gaussian elimination. The matrix is small: a dozen of frames or two.
  for (let column = 0; column < count; ++column) {
    let pivot = column;
    for (let row = column + 1; row < count; ++row) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];

    for (let row = column + 1; row < count; ++row) {
      const factor = matrix[row][column] / matrix[column][column];
      for (let k = column; k <= count; ++k) matrix[row][k] -= factor * matrix[column][k];
    }
  }

  const gains = new Array(count).fill(0);
  for (let row = count - 1; row >= 0; --row) {
    let value = matrix[row][count];
    for (let k = row + 1; k < count; ++k) value -= matrix[row][k] * gains[k];
    gains[row] = value / matrix[row][row];
  }
  return gains;
}
