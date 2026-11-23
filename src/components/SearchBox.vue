<template>
  <div class='search-box'>
    <svg class='magnifier' viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'>
      <circle cx='10.5' cy='10.5' r='6.5'/>
      <path d='M15.5 15.5 L21 21'/>
    </svg>
    <input ref='input' type='text' v-model='query' placeholder='Find a crater, a mountain, a rover'
      aria-label='Find a place on Mars' autocomplete='off' autocorrect='off' autocapitalize='off' spellcheck='false'
      @input='search' @focus='onFocus' @blur='isOpen = false'
      @keydown.down.prevent='move(1)' @keydown.up.prevent='move(-1)'
      @keydown.enter.prevent='chooseActive' @keydown.escape.stop='onEscape'>
    <a href='#' class='clear' v-if='query' title='Clear the search' @mousedown.prevent='clear' @click.prevent>&times;</a>

    <ul class='search-results' v-if='isOpen && results.length'>
      <!-- "mousedown" comes before the input loses the focus and hides the list -->
      <li v-for='(feature, index) in results' :key='feature.id' :class='{ active: index === activeIndex }'
        @mousedown.prevent='choose(feature)' @mousemove='activeIndex = index'>
        <span class='name'>{{feature.name}}</span>
        <span class='kind'>{{describe(feature)}}</span>
      </li>
    </ul>
    <div class='search-results nothing' v-else-if='isOpen && message'>{{message}}</div>
  </div>
</template>

<script>
import { loadFeatures, searchFeatures, describeFeature } from '../lib/features.js';

/**
 * Finds a place on Mars by its name. Tells the parent which one is chosen
 * with the `select` event.
 */
export default {
  name: 'SearchBox',
  emits: ['select'],
  data() {
    return {
      query: '',
      results: [],
      activeIndex: 0,
      isOpen: false,
      message: ''
    };
  },

  mounted() {
    this.onKeyDown = e => {
      // "/" is the common shortcut of a search
      const isTyping = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (e.key === '/' && !isTyping && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        this.$refs.input.focus();
      }
    };
    window.addEventListener('keydown', this.onKeyDown);
  },

  beforeUnmount() {
    window.removeEventListener('keydown', this.onKeyDown);
  },

  methods: {
    onFocus() {
      this.isOpen = true;
      // The list of the features is large, so it is not loaded with the
      // website. Now we know it will be needed.
      loadFeatures().catch(() => {});
      this.$refs.input.select();
    },

    search() {
      const query = this.query;
      this.isOpen = true;

      searchFeatures(query).then(results => {
        // The visitor could have typed more while we were looking
        if (query !== this.query) return;
        this.results = results;
        this.activeIndex = 0;
        this.message = query.trim() && !results.length ? 'No place on Mars has this name' : '';
      }).catch(() => {
        this.results = [];
        this.message = 'Could not load the names. Please try again';
      });
    },

    move(step) {
      if (!this.results.length) return;
      this.isOpen = true;
      this.activeIndex = (this.activeIndex + step + this.results.length) % this.results.length;
    },

    chooseActive() {
      const feature = this.results[this.activeIndex];
      if (feature && this.isOpen) this.choose(feature);
    },

    choose(feature) {
      this.query = feature.name;
      this.results = [feature];
      this.activeIndex = 0;
      this.isOpen = false;
      this.$refs.input.blur();
      this.$emit('select', feature);
    },

    clear() {
      this.query = '';
      this.results = [];
      this.message = '';
      this.$refs.input.focus();
    },

    onEscape() {
      if (this.isOpen && (this.results.length || this.message)) this.isOpen = false;
      else this.$refs.input.blur();
    },

    describe(feature) {
      return describeFeature(feature);
    }
  }
};
</script>

<style lang='stylus' scoped>
border-color = #d8d8d8;
primary-action-color = #ff4081;

.search-box {
  position: relative;

  .magnifier {
    position: absolute;
    left: 15px;
    top: 12px;
    color: #b0b0b0;
    pointer-events: none;
  }

  input {
    display: block;
    width: 100%;
    height: 42px;
    box-sizing: border-box;
    padding: 0 36px 0 44px;
    border: none;
    border-radius: 0;
    background: transparent;
    font: inherit;
    font-size: 16px;
    color: inherit;
    outline: none;
    &::placeholder {
      color: #9aa3ab;
    }
    &:focus {
      background: #fafafa;
    }
  }

  .clear {
    position: absolute;
    right: 0;
    top: 0;
    width: 36px;
    height: 42px;
    line-height: 40px;
    text-align: center;
    font-size: 22px;
    color: #9aa3ab;
    text-decoration: none;
    &:hover {
      color: primary-action-color;
    }
  }
}

.search-results {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  border-top: 1px solid border-color;
  max-height: calc(100vh - 74px);
  overflow-y: auto;

  li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 7px 16px;
    cursor: pointer;
    &.active {
      background: #f3f3f3;
    }
  }
  .name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .kind {
    flex-shrink: 0;
    margin-left: 12px;
    font-size: 13px;
    color: #7b8791;
  }
  &.nothing {
    padding: 10px 16px;
    font-size: 14px;
    color: #7b8791;
  }
}
</style>
