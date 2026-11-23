<template>
  <div class='feature-card' :class='{ "with-picture": hasPicture }'>
    <a href='#' class='close' title='Close' aria-label='Close' @click.prevent='$emit("close")'>&times;</a>

    <a v-if='hasPicture' class='picture' :href='article ? article.link : null' target='_blank' rel='noopener'
      title='The picture is from Wikipedia. Click to read the article'>
      <img v-if='picture' :src='picture' :alt='feature.name' @load='isPictureReady = true' @error='onPictureError'
        :class='{ ready: isPictureReady }'>
    </a>

    <div class='body'>
      <h3>{{feature.name}}</h3>
      <div class='kind'>{{kind}}</div>

      <template v-if='feature.wiki && !isArticleMissing'>
        <template v-if='article'>
          <p class='story'>{{article.text}}</p>
          <!-- The text may be cut, so the link to its source is not a part of it -->
          <a class='more' :href='article.link' target='_blank' rel='noopener'>Read more on Wikipedia</a>
        </template>
        <!-- Gray lines keep the place for the text while it is on the way -->
        <div class='story waiting' v-else><i></i><i></i><i></i></div>
      </template>
      <p class='story' v-else-if='feature.about'>{{feature.about}}</p>

      <dl class='facts'>
        <template v-for='fact in facts' :key='fact.name'>
          <dt>{{fact.name}}</dt>
          <dd>{{fact.value}}</dd>
        </template>
      </dl>

      <div class='actions'>
        <!-- A rover has photos to show, and they are not where it has landed -->
        <a href='#' class='primary' v-if='feature.rover' @click.prevent='showPhotos'>
          {{isOpeningPhotos ? 'Going there...' : 'See what it saw'}}
        </a>
        <a href='#' :class='{ primary: !feature.rover }' v-if='canStandHere' @click.prevent='$emit("stand")'>Stand here</a>
        <a href='#' @click.prevent='$emit("show")'>Zoom to it</a>
        <a v-if='gazetteerLink' class='source' :href='gazetteerLink' target='_blank' rel='noopener'
          title='Gazetteer of Planetary Nomenclature: the official record of this name'>Official record</a>
      </div>
    </div>
  </div>
</template>

<script>
import { describeFeature, formatCoordinates, getArea } from '../lib/features.js';
import { loadElevationAt, loadElevationRange } from '../lib/elevationTiles.js';
import { loadSummary } from '../lib/wikipedia.js';

// The elevation tiles do not reach the poles, there is nothing to stand on
const MAX_GROUND_LATITUDE = 82;

/**
 * Tells about a named place of Mars: a picture and a few words from
 * Wikipedia, and what we have measured ourselves. See ../lib/features.js for
 * the description of `feature`.
 */
export default {
  name: 'FeatureCard',
  props: {
    feature: { type: Object, required: true }
  },
  emits: ['close', 'show', 'stand', 'photos'],
  data() {
    return {
      // `{text, image, smallImage, link}` of the Wikipedia article, when it is loaded
      article: null,
      isArticleMissing: false,
      picture: null,
      isPictureReady: false,
      // `{min, max}` of the entire feature, or `{at}` when only its center is known
      elevation: null,
      // The route of a rover has to be loaded before we can go to its photos
      isOpeningPhotos: false
    };
  },

  computed: {
    kind() {
      return describeFeature(this.feature);
    },
    hasPicture() {
      // The place for the picture is taken before the article is loaded, and
      // is given back if the article has none.
      if (!this.feature.wiki || this.isArticleMissing) return false;
      return !this.article || !!this.picture;
    },
    facts() {
      const facts = [];
      if (this.feature.named) facts.push({ name: 'Name origin', value: this.feature.named });

      const elevation = this.elevation;
      if (elevation && elevation.max !== undefined) {
        // We know the exact outline of the craters only. The oval around a
        // mountain also holds the plain at its foot, and the one around a
        // canyon - the plateau it cuts. So we tell the end that surely
        // belongs to the feature.
        const kind = this.feature.class;
        if (kind !== 'valley') facts.push({ name: 'Highest point', value: formatMeters(elevation.max) });
        if (kind !== 'mountain') facts.push({ name: 'Lowest point', value: formatMeters(elevation.min) });
      } else if (elevation) {
        facts.push({ name: 'Elevation', value: formatMeters(elevation.at) });
      }

      facts.push({ name: 'Location', value: formatCoordinates(this.feature) });
      return facts;
    },
    canStandHere() {
      return Math.abs(this.feature.lat) <= MAX_GROUND_LATITUDE;
    },
    gazetteerLink() {
      // Only the features of the gazetteer have numbers
      if (typeof this.feature.id !== 'number') return '';
      return 'https://planetarynames.wr.usgs.gov/Feature/' + this.feature.id;
    }
  },

  watch: {
    feature: {
      immediate: true,
      handler(feature) {
        this.article = null;
        this.isArticleMissing = false;
        this.picture = null;
        this.isPictureReady = false;
        this.elevation = null;

        // Another feature may be chosen while we are waiting for the answers
        const isCurrent = () => feature === this.feature;

        if (feature.wiki) {
          loadSummary(feature.wiki).then(article => {
            if (!isCurrent()) return;
            this.article = article;
            this.picture = article.image;
          }).catch(() => {
            if (isCurrent()) this.isArticleMissing = true;
          });
        }

        const area = getArea(feature);
        const measured = area ?
          loadElevationRange(area.box, area.contains) :
          loadElevationAt(feature.lon, feature.lat).then(at => Number.isFinite(at) ? { at } : null);
        measured.then(elevation => {
          if (isCurrent()) this.elevation = elevation;
        }).catch(() => {});
      }
    }
  },

  methods: {
    showPhotos() {
      if (this.isOpeningPhotos) return;
      this.isOpeningPhotos = true;
      // The one who takes us there tells when it is done
      this.$emit('photos', () => { this.isOpeningPhotos = false; });
    },

    onPictureError() {
      // The large picture may be missing, the small one is always there
      const small = this.article && this.article.smallImage;
      this.picture = this.picture !== small ? small : null;
    }
  }
};

function formatMeters(value) {
  // A proper minus sign is as wide as a digit
  const meters = Math.round(Math.abs(value)).toLocaleString('en-US');
  return (value < 0 ? '−' : '') + meters + ' m';
}
</script>

<style lang='stylus' scoped>
primary-action-color = #ff4081;
text-color = #2c3e50;
quiet-color = #6b7882;
picture-height = 176px;

.feature-card {
  position: relative;
  // The search box above the card and the room around the panel take the rest
  max-height: calc(100vh - 63px);
  overflow-y: auto;
  font-size: 14px;
  line-height: 1.5;
  color: text-color;
}

.close {
  position: absolute;
  z-index: 1;
  right: 8px;
  top: 8px;
  width: 28px;
  height: 28px;
  line-height: 26px;
  border-radius: 50%;
  text-align: center;
  font-size: 22px;
  color: quiet-color;
  text-decoration: none;
  &:hover {
    color: primary-action-color;
  }
}
.with-picture .close {
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  color: text-color;
}

.picture {
  display: block;
  height: picture-height;
  background: #ece7e3;
  overflow: hidden;
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.25s;
    &.ready {
      opacity: 1;
    }
  }
}

.body {
  padding: 14px 16px 16px;
}

h3 {
  margin: 0 32px 0 0;
  font-size: 20px;
  line-height: 1.25;
  font-weight: 600;
}
.with-picture h3 {
  margin-right: 0;
}
.kind {
  margin-top: 2px;
  color: quiet-color;
}

.story {
  margin: 12px 0 0;
  // Articles may start with a long paragraph. Five lines tell enough, the
  // rest is one click away.
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
  overflow: hidden;
  &.waiting {
    display: block;
    i {
      display: block;
      height: 10px;
      margin: 11px 0;
      border-radius: 2px;
      background: #eeeeee;
      &:last-child {
        width: 60%;
      }
    }
  }
}

.more {
  display: inline-block;
  margin-top: 4px;
  color: primary-action-color;
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
}

.facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 5px 16px;
  margin: 14px 0 0;
  padding-top: 12px;
  border-top: 1px solid #ececec;
  dt {
    color: quiet-color;
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
}

.actions {
  display: flex;
  align-items: center;
  margin-top: 16px;
  a {
    margin-right: 18px;
    color: primary-action-color;
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }
  .primary {
    padding: 6px 14px;
    border-radius: 3px;
    background: primary-action-color;
    color: white;
    &:hover {
      text-decoration: none;
      background: darken(primary-action-color, 8%);
    }
  }
  .source {
    margin: 0 0 0 auto;
    font-size: 13px;
    color: quiet-color;
  }
}

// A phone has little room, and the map has to stay visible
@media (max-width: 700px) {
  .picture {
    height: 116px;
  }
  .story {
    -webkit-line-clamp: 4;
  }
}
</style>
