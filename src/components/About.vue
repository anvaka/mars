<template>
  <div class='about' @click.self='close'>
    <div class='content' role='dialog' aria-modal='true' aria-labelledby='about-title'>
      <div class='header'>
        <h3 id='about-title'>Peaks on Mars</h3>
        <a href='#' class='close' title='Close' aria-label='Close' @click.prevent='close'>&times;</a>
      </div>
      <div class='text'>
        <p>
          This is a map of Mars that you can explore the way you explore a map of Earth: find a place, read
          about it, and then go and stand there.
        </p>
        <ul class='what'>
          <li>
            <b>Find a place.</b> Type the name of a crater, a mountain or a rover into the search, or click a name
            on the map. The round badges mark the places where our machines have landed.
          </li>
          <li>
            <b>Stand on the surface.</b> The button with a figure puts you on any place of the map. Along the routes
            of Perseverance, Curiosity, Spirit and Opportunity you see what the rovers saw: their own photos, stop
            by stop. At a few stops of Perseverance you can also hear Mars.
          </li>
          <li>
            <b>Make a poster.</b> The button with a framed picture draws Mars the way it was seen from Earth at
            a moment that matters to you, or a map of the place you like. You can download the picture, or order it
            as a print, which also supports your humble author of this website :).
          </li>
          <li>
            <b>Change the colors.</b> Click the elevation legend. One of the themes fills Mars with the ocean it
            may have had billions of years ago.
          </li>
        </ul>
        <p>
          The night on the globe and the shadows of the mountains are where they are on Mars right now.
        </p>

        <h3>Where it all comes from</h3>
        <p>
          The land is <a target='_blank' href='https://astrogeology.usgs.gov/search/map/Mars/Topography/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2'>
          the digital elevation model</a> that blends the measurements of NASA's and ESA's orbiters. The names are from the
          <a href='https://planetarynames.wr.usgs.gov/Page/MARS/target' target='_blank'>Gazetteer of Planetary Nomenclature</a>,
          and their stories are from Wikipedia. The routes and the photos of the rovers are from NASA/JPL-Caltech. The land
          under your feet is painted with photos taken from the orbit: the mosaic of the
          <a href='https://murray-lab.caltech.edu/CTX/' target='_blank'>Murray Lab</a> and the HiRISE camera.
        </p>
        <p>By no means I'm an expert in Mars. Please <a href='https://twitter.com/anvaka'>let me know</a> if you find any errors on the map, and I'd be happy
        to fix it.</p>

        <ul>
          <li>
            Stay tuned for updates on <a href='https://twitter.com/anvaka' class='highlighted'>Twitter.</a>
          </li>
          <li>
            See my other projects at <a href='https://anvaka.com' class='highlighted'>anvaka.com</a>
          </li>
          <li>
            Read the source code on <a href='https://github.com/anvaka/mars' class='highlighted'>GitHub.</a>
          </li>
          <li>
            Explore <a href='https://anvaka.github.io/peak-map/'>Peaks on Earth.</a>
          </li>
        </ul>
        <p>With passion,<br/> Anvaka</p>
      </div>
    </div>
  </div>
</template>
<script>
export default {
  emits: ['close'],
  mounted() {
    this.closeHandler = (e) => {
      if (e.keyCode === 27) {
        e.preventDefault();
        this.close();
      }
    }
    document.addEventListener('keyup', this.closeHandler);
  },
  beforeUnmount() {
    document.removeEventListener('keyup', this.closeHandler);
  },
  methods: {
    close() {
      this.$emit('close');
    }
  }
}
</script>

<style lang='stylus' scoped>
primary-action-color = #ff4081;
text-color = #2c3e50;
quiet-color = #6b7882;

// The map is dimmed behind the card. A click on it closes the card.
.about {
  position: fixed;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 24px 16px;
  background: rgba(20, 20, 24, 0.62);
}

// The card never gets taller than the screen: its text is what scrolls,
// and the title with the cross stays where it is.
.content {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 520px;
  max-height: 100%;
  border-radius: 10px;
  overflow: hidden;
  background: white;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45);
  font-size: 15px;
  line-height: 1.5;
  color: text-color;
}

.header {
  flex: none;
  display: flex;
  align-items: center;
  padding: 14px 12px 12px 20px;
  border-bottom: 1px solid #e6e9ec;
  h3 {
    flex: 1;
    margin: 0;
    font-size: 20px;
    font-weight: 600;
  }
  .close {
    width: 36px;
    height: 36px;
    line-height: 34px;
    text-align: center;
    font-size: 24px;
    color: quiet-color;
    text-decoration: none;
    &:hover {
      color: primary-action-color;
    }
  }
}

.text {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  // The page behind should not move when the text is at its end
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 16px 20px 20px;
  p {
    margin: 0 0 12px;
  }
  p:last-child {
    margin-bottom: 0;
  }
  h3 {
    margin: 22px 0 8px;
    font-size: 16px;
    font-weight: 600;
  }
  ul {
    margin: 0 0 12px;
    padding-left: 20px;
  }
  li {
    margin-bottom: 4px;
  }
  .what li {
    margin-bottom: 8px;
  }
  a {
    color: primary-action-color;
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }
}

// On a phone the card takes the entire screen
@media (max-width: 700px) {
  .about {
    padding: 0;
  }
  .content {
    max-width: none;
    height: 100%;
    border-radius: 0;
  }
}
</style>
