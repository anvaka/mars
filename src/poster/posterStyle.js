/**
 * The map that goes into a poster. It is the map of the website
 * (../getMarsStyle.js) with everything that is not a picture taken away.
 *
 * There are two kinds of posters, see ./drawPoster.js:
 *
 * - `moment` is the globe, lit the way it was at a given moment;
 * - `place` is a flat map of a named place, lit from the top left corner,
 *   the way printed maps are.
 */
import {
  getMarsStyle, LABELS_SOURCE, SHADING_LAYER, SUN_SHADING_LAYER, SELECTION_LAYERS, DAY_NIGHT_LAYERS
} from '../getMarsStyle.js';
import { NIGHT_SOURCE, getNightSource } from '../lib/dayNight.js';
import { SUN_RELIEF_SOURCE, getSunReliefSource } from '../lib/sunRelief.js';
import { ELEVATION_TILE_SIZE } from '../lib/elevationTiles.js';

const NIGHT_LAYER = 'night';
// Seen from afar, the night side of a planet is almost black
export const NIGHT_DARKNESS = 0.93;

/**
 * @param {Object} demSource - elevation of Mars, see ../tiles.js
 * @param {Object} poster - what to draw:
 * @param {String} poster.kind - `moment` or `place`
 * @param {Date} poster.sunDate - the moment that lights the globe
 * @param {Boolean} poster.hasNames - true if the names should be on the map
 * @param {Number|String} [poster.titleId] - the feature whose name is the title of
 * the poster, so it is not repeated on the map
 * @param {Number} [detail] - how many times the tiles are more detailed than
 * the screen needs. A picture for print is many times larger than the screen.
 */
export function getPosterStyle(demSource, poster, detail = 1) {
  const isMoment = poster.kind === 'moment';
  const style = getMarsStyle(demSource, isMoment ? 'globe' : 'mercator');
  const tileSize = ELEVATION_TILE_SIZE / detail;

  style.sources['mars-dem'] = { ...demSource, tileSize };
  style.sources[NIGHT_SOURCE] = getNightSource(poster.sunDate, NIGHT_DARKNESS);
  if (style.sources[SUN_RELIEF_SOURCE]) {
    style.sources[SUN_RELIEF_SOURCE] = getSunReliefSource(poster.sunDate, tileSize);
  }

  style.layers = style.layers.filter(layer => {
    if (SELECTION_LAYERS.includes(layer.id)) return false;
    // The mark of the Sun belongs to the map, not to a picture
    if (DAY_NIGHT_LAYERS.includes(layer.id) && layer.id !== NIGHT_LAYER) return false;
    if (layer.source === LABELS_SOURCE) return poster.hasNames;
    return true;
  }).map(layer => {
    const visibility = getVisibility(layer.id, isMoment);
    if (visibility) return { ...layer, layout: { ...layer.layout, visibility } };
    if (layer.source === LABELS_SOURCE && poster.titleId !== null && poster.titleId !== undefined) {
      return { ...layer, filter: ['all', layer.filter, ['!=', ['get', 'id'], poster.titleId]] };
    }
    return layer;
  });

  return style;
}

function getVisibility(layerId, isMoment) {
  if (layerId === SUN_SHADING_LAYER || layerId === NIGHT_LAYER) return isMoment ? 'visible' : 'none';
  if (layerId === SHADING_LAYER) return isMoment ? 'none' : 'visible';
}
