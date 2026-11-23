/**
 * Draws everything of a poster that is not a map: the paper, the frames
 * and the words. The maps lie between the two layers that are drawn here,
 * the background and the overlay.
 *
 * The same code draws the small poster on the screen and the large picture
 * for print, so everything is measured in the units of the poster (see
 * ./posterLayout.js), and the caller scales the canvas.
 *
 * A poster is described by an object:
 *
 * - `kind` - `moment` (globes on a dark sky) or `place` (framed maps on paper)
 * - `title` - the largest words
 * - `lines` - array of smaller lines under the title
 * - `cells` - the pictures, as ./posterLayout.js has placed them. Each may
 *   have a `text`: the words about that very picture.
 * - `captionSize`, `captionWidth` - how large these words are
 * - `scale` - for the only map of a `place`: the scale bar, `{length, label}`
 */
import { POSTER_WIDTH, POSTER_HEIGHT, MOMENT } from './posterLayout.js';

const FONT = '"Avenir Next", Avenir, "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';
const CREDITS = 'Elevation: MOLA and HRSC  ·  anvaka.github.io/mars';
const CENTER = POSTER_WIDTH / 2;

const SKY_COLOR = '#07070b';
const STAR_COLOR = '#f1e9dc';
const PAPER_COLOR = '#f2ede3';
const INK_COLOR = '#2b2622';

// Where the name of a place is written, under its map
const PLACE_TITLE = 1012;
const PLACE_WORDS_WIDTH = 780;

/**
 * What is behind the maps
 */
export function drawBackground(ctx, poster) {
  if (poster.kind !== MOMENT) {
    ctx.fillStyle = PAPER_COLOR;
    ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
    return;
  }

  ctx.fillStyle = SKY_COLOR;
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  drawStars(ctx);

  poster.cells.forEach(({ globe }) => {
    if (!globe) return;
    // The thin air of Mars catches the light around the planet
    const glow = ctx.createRadialGradient(globe.x, globe.y, globe.radius * 0.96, globe.x, globe.y, globe.radius * 1.16);
    glow.addColorStop(0, 'rgba(255, 176, 128, 0.26)');
    glow.addColorStop(0.35, 'rgba(255, 150, 100, 0.09)');
    glow.addColorStop(1, 'rgba(255, 150, 100, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(globe.x, globe.y, globe.radius * 1.16, 0, Math.PI * 2);
    ctx.fill();
  });
}

/**
 * What is in front of the maps
 */
export function drawOverlay(ctx, poster) {
  if (poster.kind === MOMENT) drawMomentOverlay(ctx, poster);
  else drawPlaceOverlay(ctx, poster);
}

function drawMomentOverlay(ctx, poster) {
  const quiet = 'rgba(243, 234, 217, 0.8)';
  poster.cells.forEach(({ globe, caption, text }) => {
    if (globe) {
      // A ball is darker towards its edge. Without it the globe is a flat disc.
      const shade = ctx.createRadialGradient(globe.x, globe.y, globe.radius * 0.55, globe.x, globe.y, globe.radius);
      shade.addColorStop(0, 'rgba(0, 0, 0, 0)');
      shade.addColorStop(0.75, 'rgba(0, 0, 0, 0.16)');
      shade.addColorStop(1, 'rgba(0, 0, 0, 0.62)');
      ctx.fillStyle = shade;
      ctx.beginPath();
      // The edge of a small globe is thinner
      ctx.arc(globe.x, globe.y, globe.radius + Math.min(0.6, globe.radius * 0.004), 0, Math.PI * 2);
      ctx.fill();
    }
    if (caption && text) {
      drawText(ctx, text, caption.x, caption.y, {
        size: poster.captionSize, weight: 500, spacing: 0.22, color: quiet, maxWidth: poster.captionWidth
      });
    }
  });

  const ink = '#f3ead9';
  let y = 874;
  drawText(ctx, poster.title, CENTER, y, { size: 44, weight: 500, spacing: 0.22, color: ink, maxWidth: 760 });
  y += 34;
  ctx.fillStyle = 'rgba(243, 234, 217, 0.5)';
  ctx.fillRect(CENTER - 22, y, 44, 1);
  y += 40;
  (poster.lines || []).forEach(line => {
    drawText(ctx, line, CENTER, y, { size: 14.5, weight: 500, spacing: 0.26, color: quiet, maxWidth: 780 });
    y += 30;
  });

  drawText(ctx, CREDITS, CENTER, POSTER_HEIGHT - 34, { size: 8.5, weight: 500, spacing: 0.22, color: 'rgba(243, 234, 217, 0.36)' });
}

function drawPlaceOverlay(ctx, poster) {
  const quiet = 'rgba(43, 38, 34, 0.66)';
  const isOnly = poster.cells.length === 1;
  poster.cells.forEach(({ map, caption, text }) => {
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = isOnly ? 1.2 : 0.9;
    ctx.strokeRect(map.x, map.y, map.width, map.height);
    if (caption && text) {
      drawText(ctx, text, caption.x, caption.y, {
        size: poster.captionSize, weight: 600, spacing: 0.2, color: INK_COLOR, maxWidth: poster.captionWidth
      });
    }
  });

  let line = PLACE_TITLE;
  drawText(ctx, poster.title, CENTER, line, { size: 54, weight: 600, spacing: 0.16, color: INK_COLOR, maxWidth: PLACE_WORDS_WIDTH });
  line += 20;
  (poster.lines || []).forEach((text, index) => {
    line += index === 0 ? 22 : 28;
    drawText(ctx, text, CENTER, line, { size: index === 0 ? 15 : 12.5, weight: 500, spacing: 0.24, color: quiet, maxWidth: PLACE_WORDS_WIDTH });
  });

  if (poster.scale && isOnly) {
    const map = poster.cells[0].map;
    drawScale(ctx, poster.scale, map.x + map.width, map.y + map.height + 22);
  }
  drawText(ctx, CREDITS, CENTER, POSTER_HEIGHT - 30, { size: 8.5, weight: 500, spacing: 0.22, color: 'rgba(43, 38, 34, 0.42)' });
}

/**
 * The scale bar that ends at the given point: a line with two ticks, and
 * its length in words on its left.
 */
function drawScale(ctx, scale, right, y) {
  const left = right - scale.length;
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, y - 4);
  ctx.lineTo(left, y);
  ctx.lineTo(right, y);
  ctx.lineTo(right, y - 4);
  ctx.stroke();
  drawText(ctx, scale.label, left - 10, y + 1, { size: 9.5, weight: 500, spacing: 0.2, color: 'rgba(43, 38, 34, 0.66)', align: 'right' });
}

/**
 * Words in capitals with air between the letters. The canvas of some
 * browsers cannot space the letters, so we place each of them ourselves.
 *
 * `spacing` is a part of the font size. With `maxWidth` the words that do
 * not fit get smaller.
 */
function drawText(ctx, text, x, y, options) {
  const letters = Array.from(String(text || '').toUpperCase());
  if (!letters.length) return;

  let size = options.size;
  let widths;
  let total;
  for (;;) {
    ctx.font = `${options.weight || 400} ${size}px ${FONT}`;
    widths = letters.map(letter => ctx.measureText(letter).width + size * options.spacing);
    // No air after the last letter
    total = widths.reduce((sum, width) => sum + width, 0) - size * options.spacing;
    if (!options.maxWidth || total <= options.maxWidth || size < 8) break;
    size *= 0.96;
  }

  let at = options.align === 'right' ? x - total : options.align === 'left' ? x : x - total / 2;
  ctx.fillStyle = options.color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  letters.forEach((letter, index) => {
    ctx.fillText(letter, at, y);
    at += widths[index];
  });
}

/**
 * A few stars, the same on every poster.
 */
function drawStars(ctx) {
  let seed = 20261122;
  const random = () => {
    // A small generator of numbers that always gives the same row of them
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  ctx.fillStyle = STAR_COLOR;
  for (let i = 0; i < 230; ++i) {
    const x = random() * POSTER_WIDTH;
    const y = random() * POSTER_HEIGHT;
    const brightness = random();
    // Most of the stars are faint
    ctx.globalAlpha = 0.08 + 0.5 * brightness * brightness * brightness;
    ctx.beginPath();
    ctx.arc(x, y, 0.35 + 0.75 * brightness * brightness, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
