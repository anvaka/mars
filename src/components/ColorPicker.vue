<template>
<div class='vue-colorpicker' @click='showPicker = true' v-click-outside='hide' >
  <span class='vue-colorpicker-btn' :style='btnStyle' ref='triggerButton'></span>
  <div class='vue-colorpicker-panel' v-show='showPicker' :style="{left: panelLeft, top: panelTop}">
    <sketch-picker :model-value='modelValue' @update:model-value='changeColor'></sketch-picker>
  </div>
</div>
</template>

<script>
import { SketchPicker } from 'vue-color'
import ClickOutside from './clickOutside.js'

export default {
  name: 'vue-colorpicker',
  components: { SketchPicker },
  directives: { ClickOutside },
  props: {
    // Color in {r, g, b, a} format
    modelValue: {
      type: Object,
    },
  },
  emits: ['update:modelValue', 'change'],
  data () {
    return {
      showPicker: false,
      panelLeft: '0px',
      panelTop: '0px'
    }
  },
  computed: {
    isTransparent () {
      return !this.modelValue || this.modelValue.a === 0;
    },
    btnStyle () {
      if (this.isTransparent) {
        return {
          background: '#eee',
          backgroundImage: 'linear-gradient(45deg, rgba(0,0,0,.25) 25%, transparent 0, transparent 75%,rgba(0,0,0,.25)0), linear-gradient(45deg, rgba(0,0,0,.25)25%,transparent 0, transparent 75%,rgba(0,0,0,.25)0)',
          backgroundPosition: '0 0, 11px 11px',
          backgroundSize: '22px 22px'
        }
      }
      let {r, g, b, a} = this.modelValue;
      return {
        background: `rgba(${r}, ${g}, ${b}, ${a})`
      }
    },
  },
  watch: {
    showPicker(newVal) {
      if (!newVal) return;

      const PICKER_WIDTH = 220;
      const PANEL_HEIGHT = 320;
      let triggerRect = this.$refs.triggerButton.getBoundingClientRect();
      let desiredLeft = triggerRect.x;
      let desiredTop = triggerRect.bottom;
      if (triggerRect.y + PANEL_HEIGHT > window.innerHeight) {
        desiredTop = Math.max(0, window.innerHeight - PANEL_HEIGHT);
        desiredLeft += 36; // so that the selector button is still visible;
      }
      if (desiredLeft + PICKER_WIDTH > window.innerWidth) {
        desiredLeft = Math.max(0, window.innerWidth - PICKER_WIDTH);
      } 
      this.panelLeft = desiredLeft + 'px';
      this.panelTop = desiredTop + 'px';
    }
  },

  methods: {
    hide () {
      this.showPicker = false;
    },
    changeColor (color) {
      this.$emit('update:modelValue', color)
      this.$emit('change', color)
    }
  }
}
</script>

<style lang="stylus" scoped>
.vue-colorpicker {
  display: inline-block;
  box-sizing: border-box;
  padding: 6px;
  font-size: 0;
  cursor: pointer;
  &-btn {
    display: inline-block;
    width: 30px;
    height: 22px;
    border: 1px solid #666;
    background: #FFFFFF;
  }

  .vue-colorpicker-panel {
    position: fixed;
  }
}
</style>