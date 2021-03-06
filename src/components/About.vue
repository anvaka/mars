<template>
  <div class='about'>
    <div class='background absolute' @click.prevent='close'></div>
    <div class='content'>
      <h3>Peaks on Mars <a class='close bold' href='#' @click.prevent='close'>close</a></h3>
      <p>
        This website allows you to pick any region on Mars and print its high points in artistic, joyful manner.
      </p>
      <p>
        I have created this map from <a target='_blank' href='https://astrogeology.usgs.gov/search/map/Mars/Topography/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2'>
        NASA's digital elevation model</a>. Then I generated the labels from <a href='https://planetarynames.wr.usgs.gov/Page/MARS/target' target="_blank">Gazetteer of Planetary Nomenclature</a>.
      </p>
      <p>By no means I'm an expert in Mars. Please <a href='https://twitter.com/anvaka'>let me know</a> if you find any errors on the map, and I'd be happy
      to fix it.</p>

      <h3>Bonus</h3>
      <p>After the map is generated you can print it on a mug to create a memorable gift.
         This would would also support yours humble author of this website :).</p>
      <ul>
        <li>
          Stay tuned for updates on <a href='https://twitter.com/anvaka' class='highlighted'>Twitter.</a>
        </li>
        <li>
          Read the source code on <a href='https://github.com/anvaka/mars' class='highlighted'>GitHub.</a>
        </li>
        <li>
          Explore <a href='https://anvaka.github.io/peak-map/'>Peaks on Earth.</a>
        </li>
      </ul>
      <p>With passion,<br/> Anvaka</p>
      <a href='#' @click.prevent='close' class='large-close bold'>
        close
      </a>
    </div>
  </div>
</template>
<script>
export default {
  mounted() {
    this.closeHandler = (e) => {
      if (e.keyCode === 27) {
        e.preventDefault();
        this.close();
      }
    }
    document.addEventListener('keyup', this.closeHandler);
  },
  beforeDestroy() {
    document.removeEventListener('keyup', this.closeHandler);
  },
  methods: {
    close() {
      this.$emit('close');
    }
  }
}
</script>

<style lang='stylus'>
.about {
  z-index: 4;
  position: fixed;
  overflow-y: auto;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  .close {
    position: absolute;
    right: 15px;
    font-size: 12px;
  }
  .large-close {
    width: 100%;
    height: 32px;
    display: block;
    text-align: center;
  }
  .content {
    position: absolute;
    background-color: #fff;
    width: 400px;
    padding: 14px;
    h3 {
      margin: 0;
      font-weight: normal;
    }
  }
}
.background {
  position: absolute;
  background-color: rgba(99, 99, 99, 0.8);
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
@media (max-width: 800px) {
  .about {
    justify-content: initial;
  }
  .about .content {
    width: 100%;
    border: none;
  }
}
</style>