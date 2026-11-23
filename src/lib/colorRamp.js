import themes from './themes.js';

/**
 * Returns array of `{elevation, color}` stops for a theme. The stops are sorted
 * from the lowest to the highest elevation (in meters).
 */
export function getColorStops(themeName) {
  return getTheme(themeName).colors.map(([kilometers, color]) => ({
    elevation: kilometers * 1000,
    color
  }));
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

/**
 * Gives the theme with the given name. A name we do not know (an old link
 * may have one) gives the theme the map opens with.
 */
export function getTheme(themeName) {
  return themes[themeName] || themes[DEFAULT_THEME];
}

export const DEFAULT_THEME = Object.keys(themes)[0];
