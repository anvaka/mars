/**
 * The badges that mark the missions on the map. The map has two thousand
 * names, and all of them are words. A mission is the only thing that is a
 * picture, so it is found at a glance.
 *
 * A rover whose photos we can show gets a large bright badge, it is where a
 * visitor has the most to see. The others get a small dark one.
 */
// The same color as the stops of the rovers, see ./roverLayers.js
const PHOTOS_COLOR = '#ff4081';
const QUIET_COLOR = '#262b36';
// The pictures are this many times larger than they are drawn, for the sharp screens
const SCALE = 3;
// A glyph is drawn inside of a square with this side
const GLYPH_BOX = 24;

export const MISSION_WITH_PHOTOS_ICON = 'mission-photos';
export const ROVER_ICON = 'mission-rover';
export const LANDER_ICON = 'mission-lander';

const ICONS = {
  [MISSION_WITH_PHOTOS_ICON]: () => drawBadge(26, PHOTOS_COLOR, drawRover),
  [ROVER_ICON]: () => drawBadge(19, QUIET_COLOR, drawRover),
  [LANDER_ICON]: () => drawBadge(19, QUIET_COLOR, drawLander)
};

/**
 * Gives the badges to the map.
 *
 * @param {Object} map - maplibre map
 */
export function provideMissionIcons(map) {
  // The map lays out the names as soon as its style is loaded, and the
  // badges have to be there by that time.
  map.once('styledata', () => Object.keys(ICONS).forEach(addIcon));
  // If the map has asked for a badge earlier than that:
  map.on('styleimagemissing', e => {
    if (ICONS[e.id]) addIcon(e.id);
  });

  function addIcon(id) {
    if (!map.hasImage(id)) map.addImage(id, ICONS[id](), { pixelRatio: SCALE });
  }
}

/**
 * A disc of the given size (in pixels of the map) with a white glyph in it.
 */
function drawBadge(size, color, drawGlyph) {
  // Room for the shadow around the disc
  const margin = 3;
  const side = (size + margin * 2) * SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = side;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  const center = size / 2 + margin;

  // The white ring, with a shadow that keeps it visible on the bright land
  ctx.beginPath();
  ctx.arc(center, center, size / 2, 0, Math.PI * 2);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 2.5 * SCALE;
  ctx.shadowOffsetY = 0.5 * SCALE;
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.shadowColor = 'transparent';

  ctx.beginPath();
  ctx.arc(center, center, size / 2 - 1.75, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // The glyph takes the middle of the disc
  const glyphSize = size * 0.74;
  ctx.translate(center - glyphSize / 2, center - glyphSize / 2);
  ctx.scale(glyphSize / GLYPH_BOX, glyphSize / GLYPH_BOX);
  ctx.fillStyle = ctx.strokeStyle = '#ffffff';
  ctx.lineCap = ctx.lineJoin = 'round';
  drawGlyph(ctx);

  return ctx.getImageData(0, 0, side, side);
}

/**
 * A rover seen from its side: the body on six wheels (three are seen), and
 * the mast with the cameras.
 */
function drawRover(ctx) {
  // The body
  ctx.beginPath();
  ctx.roundRect(4, 10.5, 15, 4.6, 1.2);
  ctx.fill();
  // The mast and its head
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(15.5, 10.5);
  ctx.lineTo(15.5, 6);
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(12.6, 3.2, 7.4, 3.8, 1);
  ctx.fill();
  // The legs
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(7, 15);
  ctx.lineTo(5, 18.6);
  ctx.moveTo(11.5, 15);
  ctx.lineTo(11.5, 18.6);
  ctx.moveTo(16, 15);
  ctx.lineTo(18, 18.6);
  ctx.stroke();
  [5, 11.5, 18].forEach(x => {
    ctx.beginPath();
    ctx.arc(x, 19, 2.3, 0, Math.PI * 2);
    ctx.fill();
  });
}

/**
 * A lander: a platform on three legs with a dish on top.
 */
function drawLander(ctx) {
  // The platform
  ctx.beginPath();
  ctx.moveTo(7.5, 9.5);
  ctx.lineTo(16.5, 9.5);
  ctx.lineTo(18.5, 14);
  ctx.lineTo(5.5, 14);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // The legs and the feet
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.moveTo(7, 14);
  ctx.lineTo(4, 20);
  ctx.moveTo(17, 14);
  ctx.lineTo(20, 20);
  ctx.moveTo(12, 14);
  ctx.lineTo(12, 18);
  ctx.moveTo(2.4, 20.2);
  ctx.lineTo(5.6, 20.2);
  ctx.moveTo(18.4, 20.2);
  ctx.lineTo(21.6, 20.2);
  ctx.stroke();
  // The dish
  ctx.beginPath();
  ctx.moveTo(12, 9.5);
  ctx.lineTo(12, 6.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(12, 3.4, 3.6, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}
