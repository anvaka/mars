/**
 * Tells where the pictures of a poster go.
 *
 * Everything is measured in the units of the poster: it is always
 * POSTER_WIDTH units wide, whether it is the small one on the screen or the
 * large one for print.
 *
 * A poster with one picture is laid out by hand, the way it looks best. For
 * more pictures the layout is counted: they make a grid, and of all the
 * grids we take the one where the pictures are the largest. So there is no
 * layout to design for two moments, for the twelve months of a year, or for
 * the thirty one days of a month.
 */
export const POSTER_WIDTH = 900;
export const POSTER_HEIGHT = 1200;

// The kinds of posters, see ./posterDescription.js
export const MOMENT = 'moment';
export const PLACE = 'place';

// The only map of a place sits in a frame, and the words go below it
const PLACE_MAP = { x: 60, y: 60, width: 780, height: 868 };
// The only globe takes the upper part of the poster
const GLOBE = { x: POSTER_WIDTH / 2, y: 438, radius: 292 };

// Where several globes go. The middle of it is where the only globe is.
const GLOBES_AREA = { x: 70, y: 86, width: 760, height: 704 };
// How much of its cell a globe takes. The rest is the air between the globes.
const GLOBE_IN_CELL = 0.84;
// The glow around a globe needs some room in the picture of the map too
const GLOBE_PICTURE = 1.1;
// Between the maps of the places
const MAPS_GAP = 26;

// A grid with no empty cells looks better than the one with slightly larger
// pictures: we give up to this part of the size for it.
const PRICE_OF_FULL_GRID = 0.12;

/**
 * Returns the layout of a poster with `count` pictures of the given kind:
 *
 * - `cells` - array with a cell for every picture:
 *   - `map` is the rectangle of its map, `{x, y, width, height}`;
 *   - `globe` (for the `moment`) is the circle that the globe should take,
 *     `{x, y, radius}`;
 *   - `caption` is where the words about the picture go: `{x, y}` of the
 *     middle of their baseline.
 * - `captionSize` - the size of the letters of the captions;
 * - `captionWidth` - how wide a caption can be.
 *
 * When the last row of the grid is not full, it is centered, unless the
 * pictures are a row of days (`isSeries`): those are read like a calendar.
 */
export function getLayout(kind, count = 1, isSeries = false) {
  if (count <= 1) {
    if (kind === MOMENT) {
      return { cells: [{ map: { x: 0, y: 0, width: POSTER_WIDTH, height: POSTER_HEIGHT }, globe: GLOBE }] };
    }
    return { cells: [{ map: PLACE_MAP }] };
  }
  return kind === MOMENT ? layOutGlobes(count, isSeries) : layOutMaps(count);
}

function layOutGlobes(count, isSeries) {
  const area = GLOBES_AREA;
  const measure = (columns, rows) => {
    // A globe and its caption below
    const room = Math.min(area.width / columns, area.height / rows);
    const captionSize = clamp(room * 0.075, 8.5, 13);
    const band = captionSize * 2.6;
    return { captionSize, band, size: Math.min(area.width / columns, area.height / rows - band) };
  };
  const grid = chooseGrid(count, (columns, rows) => measure(columns, rows).size);
  const { captionSize, band, size } = measure(grid.columns, grid.rows);
  const radius = size * GLOBE_IN_CELL / 2;
  const top = area.y + (area.height - grid.rows * (size + band)) / 2;

  const cells = [];
  for (let i = 0; i < count; ++i) {
    const row = Math.floor(i / grid.columns);
    const x = getColumnStart(i, count, grid, area, size, 0, isSeries) + size / 2;
    const y = top + row * (size + band) + size / 2;
    const half = radius * GLOBE_PICTURE;
    cells.push({
      map: { x: x - half, y: y - half, width: half * 2, height: half * 2 },
      globe: { x, y, radius },
      caption: { x, y: y + radius + captionSize * 2.1 }
    });
  }
  return { cells, captionSize, captionWidth: size * 0.96 };
}

function layOutMaps(count) {
  const area = PLACE_MAP;
  const measure = (columns, rows) => {
    const width = (area.width + MAPS_GAP) / columns - MAPS_GAP;
    const room = (area.height + MAPS_GAP) / rows - MAPS_GAP;
    const captionSize = clamp(Math.min(width, room) * 0.045, 9, 15);
    const band = captionSize * 2.3;
    return { captionSize, band, width, height: room - band };
  };
  const grid = chooseGrid(count, (columns, rows) => {
    const cell = measure(columns, rows);
    return Math.min(cell.width, cell.height);
  });
  const { captionSize, band, width, height } = measure(grid.columns, grid.rows);

  const cells = [];
  for (let i = 0; i < count; ++i) {
    const row = Math.floor(i / grid.columns);
    const x = getColumnStart(i, count, grid, area, width, MAPS_GAP, false);
    const y = area.y + row * (height + band + MAPS_GAP);
    cells.push({
      map: { x, y, width, height },
      caption: { x: x + width / 2, y: y + height + captionSize * 1.75 }
    });
  }
  return { cells, captionSize, captionWidth: width };
}

/**
 * Finds how many columns and rows the grid should have. `getSize(columns,
 * rows)` tells how large a picture of such a grid is.
 */
function chooseGrid(count, getSize) {
  const grids = [];
  for (let columns = 1; columns <= count; ++columns) {
    const rows = Math.ceil(count / columns);
    // The same number of rows with less columns has larger pictures
    if (columns > 1 && Math.ceil(count / (columns - 1)) === rows) continue;
    grids.push({ columns, rows, size: getSize(columns, rows), spare: columns * rows - count });
  }

  const largest = Math.max(...grids.map(grid => grid.size));
  return grids
    .filter(grid => grid.size >= largest * (1 - PRICE_OF_FULL_GRID))
    .sort((a, b) => a.spare - b.spare || b.size - a.size)[0];
}

/**
 * Tells where the cell with the given index starts, from the left
 */
function getColumnStart(index, count, grid, area, width, gap, isSeries) {
  const row = Math.floor(index / grid.columns);
  const column = index % grid.columns;
  const gridWidth = grid.columns * (width + gap) - gap;
  const inRow = Math.min(grid.columns, count - row * grid.columns);
  // A row that is not full is moved to the middle
  const shift = isSeries ? 0 : (grid.columns - inRow) * (width + gap) / 2;
  return area.x + (area.width - gridWidth) / 2 + shift + column * (width + gap);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
