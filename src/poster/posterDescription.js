/**
 * What a poster is about, in a form that fits into a link.
 *
 * A poster is a sheet with one or several pictures of the same kind, and the
 * words under them. It is described by an object:
 *
 * - `kind` - what every picture shows: `moment` (the globe as it was seen
 *   from Earth) or `place` (a map of a named place);
 * - `moments` - for the `moment`: the moments, see `parseMoment()`;
 * - `span` - for the `moment`: `moment` shows the moments as they are,
 *   `month` shows every day of their month, `year` every month of their year;
 * - `places` - for the `place`: ids of the places, see ../lib/features.js;
 * - `hasNames` - for the `place`: true if the names are on the map;
 * - `words` - what the visitor wants to be written on the poster;
 * - `camera` - `[longitude, latitude, zoom]` if the visitor has turned the
 *   only picture of the poster their own way. The zoom is of a poster that is
 *   one pixel per unit large, see `POSTER_WIDTH` in ./posterLayout.js.
 *
 * The number of the pictures is not a choice of its own: it follows from
 * what is shown. One date is one globe, a month of it is thirty of them, and
 * the layout is counted for any number (see ./posterLayout.js).
 *
 * In the address bar the same goes as
 * `?poster=moment&date=2027-02-19T2100-0800&span=month&words=Hello`. The
 * values have no symbols that an address has to escape, so that a link can
 * be read and changed by hand.
 */
import { MOMENT, PLACE } from './posterLayout.js';

export const SPANS = ['moment', 'month', 'year'];
// A sheet with more pictures than this has them too small to see anything
export const MOST_PICTURES = 36;
// What the address bar is cleared from when the poster is closed
export const ADDRESS_KEYS = ['poster', 'date', 'span', 'place', 'names', 'words', 'camera'];

// Between the items of a list. The address does not escape it.
const SEPARATOR = '_';
// Our model of the Solar system holds for these years, see ../lib/marsFromEarth.js
const FIRST_YEAR = 1800;
const LAST_YEAR = 2050;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Reads a moment that is written as "2027-02-19T2100-0800": the date and the
 * time as a clock on the wall has shown them, and how far that clock was
 * from Greenwich. Colons are fine too, and everything after the date may be
 * left out: the time is then the noon, and the clock is the one of the visitor.
 *
 * Returns `{year, month, day, hour, minute, offset}` (`offset` is in minutes,
 * positive to the East), or nothing if this is not a moment.
 *
 * We keep the clock on the wall and not just the instant, because this is
 * what gets printed: a wedding at 15:30 in Paris stays at 15:30 for those
 * who open the link in Tokyo, and they see the same side of Mars.
 */
export function parseMoment(text) {
  // A plus sign in an address is often read as a space
  const match = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):?(\d\d))?(?:(Z)|([+\- ])(\d\d):?(\d\d))?$/.exec(String(text).trim());
  if (!match) return null;

  const moment = {
    year: +match[1],
    month: +match[2],
    day: +match[3],
    hour: match[4] === undefined ? 12 : +match[4],
    minute: match[5] === undefined ? 0 : +match[5]
  };
  if (moment.year < FIRST_YEAR || moment.year > LAST_YEAR) return null;
  if (moment.month < 1 || moment.month > 12 || moment.day < 1 || moment.day > getDaysInMonth(moment.year, moment.month)) return null;
  if (moment.hour > 23 || moment.minute > 59) return null;

  if (match[6]) moment.offset = 0;
  else if (match[7]) moment.offset = (match[7] === '-' ? -1 : 1) * (+match[8] * 60 + +match[9]);
  else moment.offset = getOffsetHere(moment);
  return moment;
}

/**
 * Writes the moment the way `parseMoment()` reads it
 */
export function writeMoment(moment) {
  const offset = Math.abs(moment.offset);
  // The plus sign has to be escaped in an address. A clock to the East of
  // Greenwich cannot avoid it, the clock of Greenwich can.
  const zone = offset ? (moment.offset < 0 ? '-' : '+') + pad(Math.floor(offset / 60)) + pad(offset % 60) : 'Z';
  return `${moment.year}-${pad(moment.month)}-${pad(moment.day)}T${pad(moment.hour)}${pad(moment.minute)}${zone}`;
}

/**
 * The instant of the moment
 */
export function getDate(moment) {
  return new Date(Date.UTC(moment.year, moment.month - 1, moment.day, moment.hour, moment.minute) - moment.offset * 60000);
}

/**
 * The moment that the clock of the visitor shows for the given instant
 */
export function getMoment(date = new Date()) {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    offset: getOffset(date)
  };
}

/**
 * Turns the moments that the visitor has chosen into the moments of the
 * pictures: with the `month` span every moment becomes all days of its
 * month, with the `year` - the same day of every month of its year.
 *
 * The clock stays the same for the whole row, even if the clocks of the
 * place were moved for the summer meanwhile. So the pictures are exactly a
 * day apart, and Mars turns evenly from one to the next.
 */
export function getPictureMoments(moments, span) {
  const pictures = [];
  moments.forEach(moment => {
    if (span === 'month') {
      const days = getDaysInMonth(moment.year, moment.month);
      for (let day = 1; day <= days; ++day) pictures.push({ ...moment, day });
    } else if (span === 'year') {
      for (let month = 1; month <= 12; ++month) {
        // The 31st does not happen every month
        pictures.push({ ...moment, month, day: Math.min(moment.day, getDaysInMonth(moment.year, month)) });
      }
    } else {
      pictures.push(moment);
    }
  });
  return pictures.slice(0, MOST_PICTURES);
}

/**
 * Finds the words for the moments of a poster: what all the moments share
 * is said once, and what makes them different is said under each picture.
 *
 * Returns `{date, time, captions}`:
 *
 * - `date` - the part of the date that they share: "19 February 2027" for a
 *   single moment, "February 2027" for the days of a month, "2027" for the
 *   days of a year, and nothing for the days of different years;
 * - `time` - the time, if it is the same for all, and is not in the captions;
 * - `captions` - array with the rest of the date for every moment: "19",
 *   "19 Feb", "19 February 2027". It is empty for a single moment.
 */
export function describeMoments(moments) {
  const first = moments[0];
  const isSame = field => moments.every(moment => moment[field] === first[field]);
  const getTime = moment => `${pad(moment.hour)}:${pad(moment.minute)}`;

  if (moments.length === 1) {
    return { date: `${first.day} ${MONTHS[first.month - 1]} ${first.year}`, time: getTime(first), captions: [] };
  }

  let date = '';
  let getCaption;
  if (isSame('year') && isSame('month')) {
    date = `${MONTHS[first.month - 1]} ${first.year}`;
    getCaption = moment => String(moment.day);
  } else if (isSame('year')) {
    date = String(first.year);
    getCaption = moment => `${moment.day} ${MONTHS[moment.month - 1].slice(0, 3)}`;
  } else {
    getCaption = moment => `${moment.day} ${MONTHS[moment.month - 1]} ${moment.year}`;
  }

  // The time is said once when there is a date to say it with
  const hasSharedTime = isSame('hour') && isSame('minute') && Boolean(date);
  return {
    date,
    time: hasSharedTime ? getTime(first) : '',
    captions: moments.map(moment => hasSharedTime ? getCaption(moment) : `${getCaption(moment)}  ·  ${getTime(moment)}`)
  };
}

/**
 * Reads the description of a poster from the address bar: `query` is an
 * object with everything that the address has. Returns nothing if the
 * address is not about a poster. What cannot be read is left out, and the
 * poster starts with its own choice there.
 */
export function parsePoster(query) {
  const kind = query && query.poster;
  if (kind !== MOMENT && kind !== PLACE) return null;

  // The address turns "2027" and "true" into a number and a flag
  const read = key => (query[key] === undefined || query[key] === null ? '' : String(query[key]));
  const list = key => read(key).split(SEPARATOR).filter(Boolean);

  const description = { kind, words: read('words') };
  if (kind === MOMENT) {
    description.moments = list('date').map(parseMoment).filter(Boolean).slice(0, MOST_PICTURES);
    description.span = SPANS.includes(read('span')) ? read('span') : SPANS[0];
  } else {
    description.places = list('place').slice(0, MOST_PICTURES);
    description.hasNames = read('names') === 'true' || read('names') === '1';
  }

  const camera = list('camera').map(Number);
  if (camera.length === 3 && camera.every(Number.isFinite)) description.camera = camera;
  return description;
}

/**
 * Writes the description for the address bar. Returns an object with a
 * value for each of `ADDRESS_KEYS`; those that are not needed are `undefined`.
 */
export function writePoster(description) {
  const isMoment = description.kind === MOMENT;
  const camera = description.camera;
  return {
    poster: description.kind,
    date: isMoment ? description.moments.map(writeMoment).join(SEPARATOR) : undefined,
    span: isMoment && description.span !== SPANS[0] ? description.span : undefined,
    place: isMoment || !description.places.length ? undefined : description.places.join(SEPARATOR),
    names: !isMoment && description.hasNames ? 1 : undefined,
    words: description.words || undefined,
    camera: camera ? [camera[0].toFixed(3), camera[1].toFixed(3), camera[2].toFixed(2)].join(SEPARATOR) : undefined
  };
}

export function getDaysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * How far the clock of the visitor is from Greenwich at the given moment of
 * that clock, in minutes
 */
function getOffsetHere(moment) {
  return getOffset(new Date(moment.year, moment.month - 1, moment.day, moment.hour, moment.minute));
}

function getOffset(date) {
  // Before the time zones every town had a clock of its own, seconds apart
  // from the others. Minutes are enough for us.
  return Math.round(-date.getTimezoneOffset()) || 0;
}

function pad(number) {
  return (number < 10 ? '0' : '') + number;
}
