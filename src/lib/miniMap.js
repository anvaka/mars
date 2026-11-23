/**
 * While the visitor stands on the surface, the map does not go away: it
 * shrinks into the corner of the screen and shows where the visitor is, and
 * where they look. It is the very same map, so it has the routes of the
 * rovers and their stops, it can be zoomed and dragged, and a click on it
 * moves the visitor to that place.
 *
 * The styles of the small map are in ../App.vue
 */
import { Marker } from 'maplibre-gl';

// A stop of a rover is a few dozen meters from its neighbors, and they
// should be seen on the small map. Anywhere else there is nothing that
// small to look at: the elevation has a pixel every 200 meters.
const ZOOM_AT_ROVER_STOP = 14.5;
const MIN_ZOOM = 4;
const MAX_ZOOM_ELSEWHERE = 9;
// The small map is this many times narrower than the screen (as a power of
// two), so it has to be zoomed out by as much to show the same land.
const ZOOM_STEP_TO_SMALL_MAP = 2;
// When the visitor leaves the surface far from where they started, the map
// should not show the entire planet.
const MIN_ZOOM_AFTER_WALK = 5;
// The marker moves when we walk farther than this (in degrees, a few centimeters)
const SMALLEST_STEP = 1e-7;
// The beam of the marker shows what we see. These are its length in pixels
// and its widest angle: a wider beam is not a direction anymore.
const BEAM_LENGTH = 46;
const WIDEST_BEAM = 150;
const MARKER_SIZE = BEAM_LENGTH * 2 + 8;
// The stops of the rovers are pink and the sounds are yellow, so we are blue
const MARKER_COLOR = '#1f6fff';
const DEGREES = Math.PI / 180;

const EXPAND_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
  stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 4 L20 4 L20 10 M20 4 L13 11 M10 20 L4 20 L4 14 M4 20 L11 13"/>
</svg>`;
const SHRINK_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
  stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M19 11 L13 11 L13 5 M13 11 L20 4 M5 13 L11 13 L11 19 M11 13 L4 20"/>
</svg>`;

/**
 * @param {Object} map - maplibre map
 */
export default function createMiniMap(map) {
  const container = map.getContainer();
  const marker = createMarker();
  const expandButton = createExpandButton();
  container.appendChild(expandButton);

  // Where the map looked before it became small: {center, zoom, bounds}
  let before = null;
  let isOpen = false;
  let isExpanded = false;
  // The visitor may zoom and drag the small map. Then this is the map they
  // want to come back to.
  let wasMovedByVisitor = false;
  let place = null;

  map.on('move', e => {
    if (isOpen && e.originalEvent) wasMovedByVisitor = true;
  });

  return {
    open,
    update,
    close
  };

  /**
   * Makes the map small. The `ground` tells where the visitor stands:
   * {longitude, latitude, heading, rover}.
   */
  function open(ground) {
    if (isOpen) return;
    isOpen = true;
    wasMovedByVisitor = false;
    before = { center: map.getCenter(), zoom: map.getZoom(), bounds: map.getBounds() };

    setExpanded(false);
    container.classList.add('mini');
    map.resize();
    // A turn of the wheel should not take the visitor away from the marker
    map.scrollZoom.enable({ around: 'center' });

    place = [ground.longitude, ground.latitude];
    map.jumpTo({ center: place, zoom: getZoom(ground) });
    marker.show(place, ground.heading || 0, 60);
  }

  /**
   * Follows the visitor. The `view` is the state of the ground scene, see
   * ../ground/createGroundScene.js
   */
  function update(view) {
    if (!isOpen) return;
    marker.show([view.longitude, view.latitude], view.heading, view.horizontalFov);

    const hasMoved = !place || Math.abs(view.longitude - place[0]) > SMALLEST_STEP ||
      Math.abs(view.latitude - place[1]) > SMALLEST_STEP;
    if (!hasMoved) return;
    place = [view.longitude, view.latitude];
    map.jumpTo({ center: place });
  }

  /**
   * Gives the entire screen back to the map. The `view` is the last state
   * of the ground scene, if there was any.
   */
  function close(view) {
    if (!isOpen) return;
    isOpen = false;

    const center = map.getCenter();
    const zoom = map.getZoom();
    setExpanded(false);
    container.classList.remove('mini');
    marker.hide();
    map.scrollZoom.enable();
    map.resize();

    if (wasMovedByVisitor) {
      // The size of the map has changed around its corner, not around its center
      map.jumpTo({ center, zoom });
      return;
    }

    // Otherwise the map is the way the visitor left it, unless they have
    // walked away, or came here by a link.
    const end = view ? [view.longitude, view.latitude] : place;
    const isNear = before.bounds.contains(end);
    map.jumpTo({
      center: isNear ? before.center : end,
      zoom: isNear ? before.zoom : Math.max(before.zoom, MIN_ZOOM_AFTER_WALK)
    });
  }

  function getZoom(ground) {
    if (ground.rover) return ZOOM_AT_ROVER_STOP;
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM_ELSEWHERE, before.zoom - ZOOM_STEP_TO_SMALL_MAP));
  }

  function setExpanded(shouldExpand) {
    isExpanded = shouldExpand;
    container.classList.toggle('expanded', isExpanded);
    expandButton.innerHTML = isExpanded ? SHRINK_ICON : EXPAND_ICON;
    expandButton.title = isExpanded ? 'Make the map small' : 'Make the map larger';
    expandButton.setAttribute('aria-label', expandButton.title);
    if (!isOpen) return;

    map.resize();
    if (place) map.jumpTo({ center: place });
  }

  function createExpandButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mini-map-expand';
    button.addEventListener('click', e => {
      // The click is not for the map under the button
      e.stopPropagation();
      setExpanded(!isExpanded);
    });
    return button;
  }

  /**
   * A dot where the visitor stands, with a beam of what they see.
   */
  function createMarker() {
    const element = document.createElement('div');
    element.className = 'mini-map-marker';
    const half = MARKER_SIZE / 2;
    element.innerHTML = `<svg width="${MARKER_SIZE}" height="${MARKER_SIZE}" viewBox="${-half} ${-half} ${MARKER_SIZE} ${MARKER_SIZE}">
      <defs>
        <radialGradient id="mini-map-beam" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${BEAM_LENGTH}">
          <stop offset="0" stop-color="${MARKER_COLOR}" stop-opacity="0.9"/>
          <stop offset="1" stop-color="${MARKER_COLOR}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <path class="beam" fill="url(#mini-map-beam)"/>
      <circle r="7" fill="${MARKER_COLOR}" stroke="#ffffff" stroke-width="2.5"/>
    </svg>`;
    const beam = element.querySelector('.beam');
    const mapMarker = new Marker({ element, rotationAlignment: 'map' });
    let lastAngle;
    let isAdded = false;

    return { show, hide };

    function show(lngLat, heading, angle) {
      mapMarker.setLngLat(lngLat).setRotation(heading);
      setBeam(Math.min(angle, WIDEST_BEAM));
      if (!isAdded) mapMarker.addTo(map);
      isAdded = true;
    }

    function hide() {
      if (isAdded) mapMarker.remove();
      isAdded = false;
    }

    function setBeam(angle) {
      if (angle === lastAngle) return;
      lastAngle = angle;
      // The marker looks up, the map turns it where we look
      const x = (BEAM_LENGTH * Math.sin(angle / 2 * DEGREES)).toFixed(1);
      const y = (-BEAM_LENGTH * Math.cos(angle / 2 * DEGREES)).toFixed(1);
      beam.setAttribute('d', `M0 0 L${-x} ${y} A${BEAM_LENGTH} ${BEAM_LENGTH} 0 0 1 ${x} ${y} Z`);
    }
  }
}
