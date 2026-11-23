/**
 * Sounds of Mars. Perseverance is the first rover that carries microphones,
 * and NASA has published a few of its recordings:
 *
 * https://science.nasa.gov/mission/mars-2020-perseverance/sounds-of-mars/
 *
 * Each recording is listed with the day (sol) when it was made, which tells
 * us where the rover was at that moment.
 *
 * We keep our own copies of the recordings, so that they do not depend on
 * where NASA keeps its files: `VITE_SOUNDS` in the `.env` file is the folder
 * with the copies, and they have the names that NASA gave them. Without the
 * folder the recordings are played from the website of NASA.
 */
const NASA_FILES_URL = 'https://assets.science.nasa.gov/content/dam/science/psd/mars/downloadable_items/';
const OUR_FILES_URL = import.meta.env.VITE_SOUNDS;
const PAGES_URL = 'https://science.nasa.gov/resource/';
const SUPERCAM_CREDIT = 'NASA/JPL-Caltech/LANL/CNES/CNRS/ISAE-Supaero';

const SOUNDS = {
  M20: [{
    sol: 1,
    title: 'Wind',
    description: 'The first sound recorded on the surface of Mars, 18 hours after the landing. ' +
      'The microphone was still folded on the deck, so the wind is muffled.',
    url: getFileUrl('4/5/45825_SCAM_MIC_SOL001_RUN001.mp3'),
    page: PAGES_URL + 'first-audio-recording-of-sounds-on-mars/',
    credit: SUPERCAM_CREDIT
  }, {
    sol: 12,
    title: 'Laser shots',
    description: 'The rover fires its laser 30 times at a rock three meters away, to learn what the rock is made of.',
    url: getFileUrl('4/5/45831_SCAM_MIC_SOL012_RUN001.mp3'),
    page: PAGES_URL + 'first-acoustic-recording-of-laser-shots-on-mars/',
    credit: SUPERCAM_CREDIT
  }, {
    sol: 16,
    title: 'Driving',
    description: 'Metal wheels roll over the rocks. These are 90 seconds from a 16 minutes long recording.',
    url: getFileUrl('4/5/45857_FILTERED_HIGHLIGHTS_-_Sol16RoverDriveHighlights.mp3'),
    page: PAGES_URL + 'sounds-of-perseverance-mars-rover-driving-sol-16-90-second-highlights/',
    credit: 'NASA/JPL-Caltech'
  }, {
    sol: 215,
    title: 'Dust devil',
    description: 'A whirlwind of dust, at least 118 meters tall, passes right over the rover.',
    url: getFileUrl('4/7/47821_PIA25657.wav'),
    page: PAGES_URL + 'nasas-perseverance-records-a-martian-dust-devil/',
    credit: 'NASA/JPL-Caltech/LANL/CNES/CNRS/INTA-CSIC/Space Science Institute/ISAE-Supaero'
  }]
};

/**
 * Lists the recordings of a rover along with the stops where they were made:
 * `[{sound, stop}]`. The `stops` are described in ./rovers.js
 */
export function getRoverSounds(roverId, stops) {
  return (SOUNDS[roverId] || []).map(sound => {
    // The rover was at the stop from the day it came there, until the day of
    // the next drive. It spent the first days at the place where it landed.
    const stop = stops.find((stop, index) => {
      const cameBefore = index === 0 || stop.sol <= sound.sol;
      return cameBefore && sound.sol < stop.lastSol;
    });
    return { sound, stop };
  }).filter(record => record.stop);
}

/**
 * The address of a recording: `path` is where NASA keeps it.
 */
function getFileUrl(path) {
  if (!OUR_FILES_URL) return NASA_FILES_URL + path;
  return OUR_FILES_URL.replace(/\/?$/, '/') + path.split('/').pop();
}
