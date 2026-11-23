/**
 * Colors of the map. Each theme paints elevation its own way: `colors` is a
 * list of `[elevation in kilometers, color]`, from the lowest to the highest,
 * and the map blends the neighbors for everything in between.
 *
 * Mars is 30 kilometers tall, from the floor of Hellas to the top of Olympus
 * Mons, but almost all of its land lies between -5 and +4 kilometers: the
 * northern plains are near -4, the southern highlands are near +2. Only the
 * giant volcanoes go above 8. A palette that is spread evenly over the 30
 * kilometers spends most of its colors on four mountains, and leaves a couple
 * of dark ones for the rest of the planet. So every theme here has most of
 * its colors below 5 kilometers.
 *
 * The colors go with the shading of the slopes (see ../getMarsStyle.js): no
 * theme is as dark as a shadow, nor as bright as a sunlit slope, otherwise
 * the shade would not be visible there.
 *
 * The first theme is the one the map opens with. The last color of a theme
 * has to be at 21 kilometers or below: the 8 bit elevation tiles (see
 * ../tiles.js) cannot store more, and a color above that makes the map paint
 * the entire planet with it.
 */
export default {
  // Mars the way we imagine it: rust in the plains, sand on the mountains
  OCHRE: {
    labelColor: "#ffffff",
    haloColor: "#000000",
    colors: [
      [-8.5, "#2E130D"],
      [-5.5, "#5A2413"],
      [-2.5, "#8C3A1E"],
      [0.5, "#B5552B"],
      [3.5, "#CF7A3E"],
      [8, "#E0A262"],
      [14, "#EDC690"],
      [21, "#F7E3BF"]
    ]
  },
  // Mars with the ocean it may have had 3.5 billion years ago. The water
  // stands at -2.54 kilometers: this is the level that the ancient river
  // deltas share (Di Achille and Hynek, 2010). It covers a third of the planet.
  OCEAN: {
    labelColor: "#ffffff",
    haloColor: "#000000",
    colors: [
      [-8.5, "#0E2A4D"],
      [-6, "#164470"],
      [-4.5, "#1F5F8C"],
      [-3.2, "#2F7FA3"],
      [-2.56, "#4F9FB6"],
      [-2.52, "#A04A27"],
      [-1, "#B45B2C"],
      [0.5, "#C46F35"],
      [2, "#D18541"],
      [3.5, "#DB9A52"],
      [8, "#E7B878"],
      [14, "#F0D19E"],
      [21, "#F8E7C6"]
    ]
  },
  // The colors of the sky after the sunset
  DUSK: {
    labelColor: "#ffffff",
    haloColor: "#000000",
    colors: [
      [-8.5, "#1B1A3A"],
      [-6, "#2A2857"],
      [-4.5, "#3D3877"],
      [-3, "#5A4590"],
      [-1.5, "#7D4F9A"],
      [0, "#A2588F"],
      [1.5, "#C2637E"],
      [3, "#DA7A6C"],
      [5, "#E99A6A"],
      [8, "#F2BC7C"],
      [12, "#F7D79C"],
      [21, "#FBEFCB"]
    ]
  },
  // Almost no color, for those who want to see the shape of the land. The
  // gray is warm, because the light and the shadows on the slopes are warm.
  STONE: {
    labelColor: "#ffffff",
    haloColor: "#000000",
    colors: [
      [-8.5, "#3B3835"],
      [-4.5, "#5F5B57"],
      [-1.5, "#807B76"],
      [1.5, "#A19C95"],
      [5, "#BEB9B1"],
      [10, "#D7D2C9"],
      [21, "#EFEBE2"]
    ]
  }
};
