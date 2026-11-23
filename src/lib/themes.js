export default {
  RED: {
    labelColor: "#ffffff",
    haloColor: "#000000",
    colorRamp: [
      {
        size: 0.5,
        value: "#000000"
      },
      {
        size: 1,
        value: "#441807"
      },
      {
        size: 1,
        value: "#BF451C"
      },
      {
        size: 1,
        value: "#E57D27"
      },
      {
        size: 1,
        value: "#FBA529"
      },
      {
        size: 0,
        value: "#FFFFFF"
      }
    ]
  },
  GREEN: {
    labelColor: "#000000",
    haloColor: "#FFFFFF",
    colorRamp: [
      {
        size: 1,
        value: "#000000"
      },
      {
        size: 1,
        value: "#16005E"
      },
      {
        size: 1,
        value: "#1B1170"
      },
      {
        size: 1,
        value: "#004489"
      },
      {
        size: 1,
        value: "#1B7AA0"
      },
      {
        size: 1,
        value: "#28A8AF"
      },
      {
        size: 1,
        value: "#00C1B6"
      },
      {
        size: 1,
        value: "#00D7BC"
      },
      {
        size: 1,
        value: "#49EBCD"
      },
      {
        size: 1,
        value: "#41DFBB"
      },
      {
        size: 1,
        value: "#00B689"
      },
      {
        size: 1,
        value: "#00A666"
      },
      {
        size: 1,
        value: "#009967"
      },
      {
        size: 1,
        value: "#277F57"
      },
      {
        size: 1,
        value: "#005B2C"
      },
      {
        size: 1,
        value: "#004700"
      },
      {
        size: 1,
        value: "#004F00"
      },
      {
        size: 1,
        value: "#006400"
      },
      {
        size: 1,
        value: "#3E6F27"
      },
      {
        size: 1,
        value: "#527724"
      },
      {
        size: 1,
        value: "#64842B"
      },
      {
        size: 1,
        value: "#609100"
      },
      {
        size: 1,
        value: "#84A900"
      },
      {
        size: 1,
        value: "#8BB500"
      },
      {
        size: 1,
        value: "#A5CA00"
      },
      {
        size: 1,
        value: "#C2D558"
      },
      {
        size: 1,
        value: "#DBE974"
      },
      {
        size: 1,
        value: "#F7F57B"
      },
      {
        size: 1,
        value: "#FFF4A3"
      },
      {
        size: 1,
        value: "#FFE391"
      },
      {
        size: 1,
        value: "#FFCA78"
      },
      {
        size: 1,
        value: "#F8B966"
      },
      {
        size: 1,
        value: "#E89C40"
      },
      {
        size: 1,
        value: "#D9831F"
      },
      {
        size: 1,
        value: "#BF6E1C"
      },
      {
        size: 1,
        value: "#AF6222"
      },
      {
        size: 1,
        value: "#824F2A"
      },
      {
        size: 1,
        value: "#684024"
      },
      {
        size: 1,
        value: "#4F2B07"
      },
      {
        size: 0,
        value: "#4F2B07"
      }
    ]
  },
  GRAY: {
    labelColor: "#ffffff",
    haloColor: "#000000",
    colorRamp: [
      {
        size: 1,
        value: "#000000"
      },
      {
        value: "#FFFFFF"
      }
    ]
  },
  HAZE: {
    labelColor: "#FFFFFF",
    haloColor: "#000000",
    colorRamp: [
      {
        size: 1,
        value: "#000000"
      },
      {
        size: 1,
        value: "#495086"
      },
      {
        size: 1,
        value: "#BBC6E9"
      },
      {
        size: 1,
        value: "#CD8684"
      },
      {
        size: 1,
        value: "#EDDDC3"
      },
      {
        size: 1,
        value: "#FDFCE8"
      },
      {
        size: 0,
        value: "#FEFEFE"
      },
    ]
  },
  // Made to go with the shading of the slopes. The shade has to be visible
  // on every color, so the palette never gets as dark as a shadow, nor as
  // bright as a sunlit slope. Half of the colors are spent on the lowest
  // third of the elevations: this is where most of the land is.
  OCHRE: {
    labelColor: "#ffffff",
    haloColor: "#000000",
    colorRamp: [
      { size: 3, value: "#2E130D" },
      { size: 3, value: "#5A2413" },
      { size: 3, value: "#8C3A1E" },
      { size: 3, value: "#B5552B" },
      { size: 4.5, value: "#CF7A3E" },
      { size: 6, value: "#E0A262" },
      { size: 7.2, value: "#EDC690" },
      { size: 0, value: "#F7E3BF" }
    ]
  }
};
