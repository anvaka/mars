import themes from './themes.js';
import { getElevationAt } from '../tiles.js';

/**
 * Returns array of `{elevation, color}` stops for a theme. The stops are sorted
 * from the lowest to the highest elevation (in meters).
 */
export function getColorStops(themeName) {
  const steps = (themes[themeName] || themes.RED).colorRamp;
  const total = steps.reduce((sum, step) => sum + (step.size || 0), 0);

  let covered = 0;
  return steps.map(step => {
    const stop = {
      elevation: getElevationAt(covered / total),
      color: step.value
    };
    covered += step.size || 0;
    return stop;
  });
}

/**
 * Makes an expression for the `color-relief-color` property of the map.
 */
export function createColorReliefExpression(themeName) {
  const expression = ['interpolate', ['linear'], ['elevation']];
  getColorStops(themeName).forEach(stop => {
    expression.push(stop.elevation, stop.color);
  });

  return expression;
}
