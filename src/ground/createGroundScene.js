/**
 * Puts a person on the surface of Mars: loads the land around them, keeps
 * track of where they look, how they move, and where the Sun is.
 *
 * The drawing itself is done by ./createGroundRenderer.js
 */
import createGroundRenderer from './createGroundRenderer.js';
import { createLocalProjection } from './localProjection.js';
import { loadPatchLevel, sampleLevel, isInsideLevel, PATCH_LEVELS, MAX_GROUND_LATITUDE } from './loadTerrainPatch.js';
import { loadImageryLevel, IMAGERY_LEVELS, IMAGERY_SIZE } from './loadImagery.js';
import { loadDetailedAreas, findDetailedArea } from '../lib/detailedElevation.js';
import { getMarsTime, getLocalSolarTime, getSunDirection } from '../lib/marsTime.js';

const DEGREES = Math.PI / 180;
const LEVELS_COUNT = PATCH_LEVELS.length;
// The levels before this one are detailed. They cover little land, and
// follow the viewer.
const FIRST_PLANET_LEVEL = PATCH_LEVELS.findIndex(level => !level.isDetailed);
// A level that follows the viewer is loaded again around them, when they get
// this far from its center. It is a share of the way to the side of the level.
const FOLLOW_DISTANCE = 0.4;

export const MIN_EYE_HEIGHT = 2;
export const MAX_EYE_HEIGHT = 20000;
const MIN_FIELD_OF_VIEW = 6;
const MAX_FIELD_OF_VIEW = 100;
const MAX_PITCH = 89;

// When we walk this far from the center of the loaded land, the land is
// loaded again around the new place.
const RECENTER_DISTANCE = 20000;
// The Sun moves a quarter of a degree per minute
const CLOCK_INTERVAL = 20000;

const MOVE_KEYS = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};
const HEIGHT_KEYS = { KeyE: 1, PageUp: 1, KeyQ: -1, PageDown: -1 };

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Object} options
 * @param {Number} options.longitude, options.latitude - where to stand, degrees
 * @param {Number} [options.heading] - where to look. Degrees, clockwise from North
 * @param {Number} [options.pitch] - degrees above the horizon
 * @param {Number} [options.eyeHeight] - meters above the ground
 * @param {Number} [options.localTime] - local solar time in hours. When
 * missing the scene follows the real clock of Mars.
 * @param {Function} [options.onChange] - called with the state of the scene
 * (see `getState()`) after each frame
 */
export default function createGroundScene(canvas, options) {
  const renderer = createGroundRenderer(canvas);
  const onChange = options.onChange || (() => {});

  const camera = {
    x: 0,
    y: 0,
    altitude: 0,
    heading: finiteOr(options.heading, 0),
    pitch: clamp(finiteOr(options.pitch, 0), -MAX_PITCH, MAX_PITCH),
    fov: 60,
  };
  let eyeHeight = clamp(finiteOr(options.eyeHeight, MIN_EYE_HEIGHT), MIN_EYE_HEIGHT, MAX_EYE_HEIGHT);
  let fixedLocalTime = Number.isFinite(options.localTime) ? options.localTime : null;

  // The land that is on the screen: its projection and elevation levels
  let patch = null;
  // The land that is being loaded to replace the current one
  let pendingPatch = null;
  let loadingCount = 0;
  let error = null;

  let marsTime = getMarsTime();
  let sun = null;

  // Places where the elevation is known in detail, see ../lib/detailedElevation.js
  let detailedAreas = null;
  loadDetailedAreas().then(areas => {
    detailedAreas = areas;
    requestFrame();
  });
  const followers = createFollowers();

  let frameRequest = 0;
  let lastFrameTime = 0;
  let isDisposed = false;
  const pressedKeys = new Set();
  const pointers = new Map();
  let pinchDistance = 0;

  listenToInput();
  const clockTimer = setInterval(onClockTick, CLOCK_INTERVAL);
  const resizeObserver = new ResizeObserver(requestFrame);
  resizeObserver.observe(canvas);

  loadPatch(options.longitude, clamp(options.latitude, -MAX_GROUND_LATITUDE, MAX_GROUND_LATITUDE));
  updateSun();

  return {
    /**
     * Sets the local solar time (in hours) to look at. Pass `null` to follow
     * the real clock of Mars.
     */
    setLocalTime,
    /**
     * Shows the Sun where it was at the given moment (a `Date`). The time
     * of the day can be changed after that, the season stays.
     */
    setMoment,
    /**
     * Moves the viewer to another place
     */
    moveTo,
    setEyeHeight,
    /**
     * Paints the land with colors of the map (pass color stops), or with
     * natural colors (pass null).
     */
    setColorStops,
    /**
     * Makes the sky look like the sky on the photos of a rover: pass its
     * color as `[red, green, blue]`, each is 0..1. Pass nothing to get the
     * sky of the scene back.
     */
    setPhotoSky,
    getState,
    /**
     * Tells where the place is on the screen. Returns `null` when the place
     * is behind the camera.
     */
    project,
    dispose
  };

  function loadPatch(longitude, latitude) {
    const projection = createLocalProjection(longitude, latitude);
    const loading = { projection, levels: [], isComplete: false };
    // The very first patch shows up as soon as there is something to show.
    // The following ones replace the old patch when they are complete.
    const isFirst = !patch;
    if (isFirst) patch = loading;
    else pendingPatch = loading;

    // The least detailed level needs just a few tiles. Load it first:
    let queue = Promise.resolve();
    for (let index = LEVELS_COUNT - 1; index >= FIRST_PLANET_LEVEL; --index) {
      queue = queue.then(() => {
        if (isAbandoned()) return;
        loadingCount += 1;
        notify();
        return loadPatchLevel(projection, index).then(level => {
          loadingCount -= 1;
          if (isAbandoned()) return;

          loading.levels[index] = level;
          if (isFirst) {
            renderer.setLevel(level);
            updateSun();
            requestFrame();
          }
        }, e => {
          loadingCount -= 1;
          throw e;
        });
      });
    }

    queue.then(() => {
      loading.isComplete = true;
      if (!isFirst && !isAbandoned()) switchToPatch(loading);
      // Now the detailed levels can be loaded
      requestFrame();
    }).catch(e => {
      console.error(e);
      error = 'Could not load the terrain: ' + (e.message || e);
      notify();
    });

    function isAbandoned() {
      return isDisposed || (patch !== loading && pendingPatch !== loading);
    }
  }

  function switchToPatch(newPatch) {
    // Remember where we are and where we look in terms of the planet:
    const [longitude, latitude] = patch.projection.unproject(camera.x, camera.y);
    const heading = camera.heading * DEGREES;
    const ahead = patch.projection.unproject(
      camera.x + Math.sin(heading) * 1000,
      camera.y + Math.cos(heading) * 1000
    );

    patch = newPatch;
    pendingPatch = null;

    const [x, y] = patch.projection.project(longitude, latitude);
    const [aheadX, aheadY] = patch.projection.project(ahead[0], ahead[1]);
    camera.x = x;
    camera.y = y;
    // North is in a slightly different direction on the new sheet
    camera.heading = Math.atan2(aheadX - x, aheadY - y) / DEGREES;

    // The levels that follow the viewer notice the new patch, and load again
    renderer.clearLevels();
    patch.levels.forEach(level => renderer.setLevel(level));
    updateSun();
    requestFrame();
  }

  /**
   * Makes the levels that follow the viewer: the detailed elevation, and the
   * photos taken from the orbit. Each of them is `update()`d before a frame.
   */
  function createFollowers() {
    const result = [];
    // Less detailed levels go first: the others borrow from them at the edges
    // of a detailed area
    for (let index = FIRST_PLANET_LEVEL - 1; index >= 0; --index) {
      const { size, texelSize } = PATCH_LEVELS[index];
      result.push(createFollower({
        halfExtent: size * texelSize / 2,
        step: texelSize,
        // The elevation of the entire planet has to be there first
        isReady: () => !!detailedAreas && patch.isComplete,
        isCounted: true,
        load(x, y) {
          const [longitude, latitude] = patch.projection.unproject(x, y);
          const area = findDetailedArea(detailedAreas, longitude, latitude);
          if (!area) return Promise.resolve(null);
          return loadPatchLevel(patch.projection, index, {
            x, y, area,
            getKnownHeight: (knownX, knownY) => getElevationAt(knownX, knownY, index + 1)
          });
        },
        show(level) {
          if (level && level.tilesCount) {
            patch.levels[index] = level;
            renderer.setLevel(level);
          } else {
            patch.levels[index] = undefined;
            renderer.clearLevel(index);
          }
        }
      }));
    }

    IMAGERY_LEVELS.forEach((level, index) => {
      result.push(createFollower({
        halfExtent: level.texelSize * IMAGERY_SIZE / 2,
        step: level.texelSize,
        isReady: () => true,
        load: (x, y) => loadImageryLevel(patch.projection, index, x, y),
        show: photo => renderer.setImagery(index, photo && photo.canvas, photo)
      }));
    });
    return result;
  }

  function createFollower({ halfExtent, step, isReady, isCounted, load, show }) {
    // The patch that the level was loaded for, and where its center is there
    let home = null;
    let x = 0, y = 0;
    let isLoading = false;

    return { update };

    function update() {
      if (isLoading || !isReady()) return;
      const isFar = Math.abs(camera.x - x) > halfExtent * FOLLOW_DISTANCE ||
        Math.abs(camera.y - y) > halfExtent * FOLLOW_DISTANCE;
      if (home === patch && !isFar) return;

      // Pixels of the level stay where they were, when it is loaded again a bit aside
      const nextX = Math.round(camera.x / step) * step;
      const nextY = Math.round(camera.y / step) * step;
      const nextHome = patch;
      isLoading = true;
      if (isCounted) loadingCount += 1;

      load(nextX, nextY).catch(e => {
        console.warn('Could not load a detailed level of the ground view', e);
        return null;
      }).then(result => {
        isLoading = false;
        if (isCounted) loadingCount -= 1;
        if (isDisposed) return;
        if (patch === nextHome) {
          home = nextHome;
          x = nextX;
          y = nextY;
          show(result);
        }
        // Either we show what has arrived, or we try again on the new patch
        requestFrame();
      });
    }
  }

  function getGroundElevation() {
    return getElevationAt(camera.x, camera.y, 0);
  }

  /**
   * Gives elevation of a place on the patch, from the most detailed level
   * that has it. Levels before the `firstLevel` are not looked at.
   */
  function getElevationAt(x, y, firstLevel) {
    for (let i = firstLevel; i < LEVELS_COUNT; ++i) {
      const level = patch.levels[i];
      if (level && isInsideLevel(level, x, y)) return sampleLevel(level, x, y);
    }
    const last = patch.levels[LEVELS_COUNT - 1];
    return last ? sampleLevel(last, x, y) : 0;
  }

  function setLocalTime(hours) {
    fixedLocalTime = Number.isFinite(hours) ? hours : null;
    if (fixedLocalTime === null) marsTime = getMarsTime();
    updateSun();
    requestFrame();
  }

  function setMoment(date) {
    marsTime = getMarsTime(date);
    fixedLocalTime = getLocalSolarTime(marsTime, patch.projection.longitude);
    updateSun();
    requestFrame();
  }

  function moveTo(longitude, latitude) {
    const [x, y] = patch.projection.project(longitude, latitude);
    camera.x = x;
    camera.y = y;
    recenterIfNeeded();
    requestFrame();
  }

  function onClockTick() {
    // When the time is fixed, the season is fixed too
    if (fixedLocalTime !== null) return;
    marsTime = getMarsTime();
    updateSun();
    requestFrame();
  }

  function getLocalTime() {
    if (fixedLocalTime !== null) return fixedLocalTime;
    return getLocalSolarTime(marsTime, patch.projection.longitude);
  }

  function updateSun() {
    sun = getSunDirection(patch.projection.latitude, marsTime.subsolarLatitude, getLocalTime());
    renderer.setSun(sun);
  }

  function setEyeHeight(height) {
    eyeHeight = clamp(finiteOr(height, eyeHeight), MIN_EYE_HEIGHT, MAX_EYE_HEIGHT);
    requestFrame();
  }

  function setColorStops(stops) {
    renderer.setColorRamp(stops);
    requestFrame();
  }

  function setPhotoSky(color) {
    renderer.setPhotoSky(color);
    requestFrame();
  }

  function requestFrame() {
    if (frameRequest || isDisposed) return;
    frameRequest = requestAnimationFrame(frame);
  }

  function frame(time) {
    frameRequest = 0;
    const elapsed = lastFrameTime ? Math.min((time - lastFrameTime) / 1000, 0.1) : 0;
    const isMoving = move(elapsed);
    lastFrameTime = isMoving ? time : 0;

    followers.forEach(follower => follower.update());
    camera.altitude = getGroundElevation() + eyeHeight;
    renderer.render(camera);
    notify();

    if (isMoving) requestFrame();
  }

  /**
   * Moves the camera according to the pressed keys. Returns true if there are
   * such keys.
   */
  function move(elapsed) {
    let right = 0, forward = 0, climb = 0;
    pressedKeys.forEach(code => {
      if (MOVE_KEYS[code]) {
        right += MOVE_KEYS[code][0];
        forward += MOVE_KEYS[code][1];
      }
      if (HEIGHT_KEYS[code]) climb += HEIGHT_KEYS[code];
    });
    if (!right && !forward && !climb) return false;

    const isFast = pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight');
    if (climb) {
      eyeHeight = clamp(eyeHeight * Math.exp(climb * elapsed * (isFast ? 3 : 1.2)), MIN_EYE_HEIGHT, MAX_EYE_HEIGHT);
    }
    if (right || forward) {
      // The higher we are, the slower the land moves below us
      const speed = (100 + 2 * eyeHeight) * (isFast ? 5 : 1);
      const heading = camera.heading * DEGREES;
      const step = speed * elapsed / Math.sqrt(right * right + forward * forward);
      camera.x += (Math.sin(heading) * forward + Math.cos(heading) * right) * step;
      camera.y += (Math.cos(heading) * forward - Math.sin(heading) * right) * step;
      recenterIfNeeded();
    }
    return true;
  }

  function recenterIfNeeded() {
    if (pendingPatch || !patch.isComplete) return;
    if (Math.abs(camera.x) < RECENTER_DISTANCE && Math.abs(camera.y) < RECENTER_DISTANCE) return;

    const [longitude, latitude] = patch.projection.unproject(camera.x, camera.y);
    if (Math.abs(latitude) > MAX_GROUND_LATITUDE) return;
    loadPatch(longitude, latitude);
  }

  function getState() {
    const [longitude, latitude] = patch.projection.unproject(camera.x, camera.y);
    return {
      longitude,
      latitude,
      elevation: camera.altitude - eyeHeight,
      eyeHeight,
      heading: ((camera.heading % 360) + 360) % 360,
      pitch: camera.pitch,
      fov: camera.fov,
      // Width of the view, to place things along the horizon
      horizontalFov: 2 * Math.atan(Math.tan(camera.fov * DEGREES / 2) * canvas.clientWidth / Math.max(1, canvas.clientHeight)) / DEGREES,
      localTime: getLocalTime(),
      followsClock: fixedLocalTime === null,
      sunElevation: sun ? sun.elevation : 0,
      sunAzimuth: sun ? sun.azimuth : 0,
      marsTime,
      isLoading: loadingCount > 0,
      error
    };
  }

  function project(longitude, latitude, elevation) {
    const [x, y] = patch.projection.project(longitude, latitude);
    return renderer.project(x, y, elevation);
  }

  function notify() {
    if (!isDisposed) onChange(getState());
  }

  function listenToInput() {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
  }

  function onPointerDown(e) {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinchDistance = getPinchDistance();
  }

  function onPointerMove(e) {
    const pointer = pointers.get(e.pointerId);
    if (!pointer) return;
    const dx = e.clientX - pointer.x;
    const dy = e.clientY - pointer.y;
    pointer.x = e.clientX;
    pointer.y = e.clientY;

    if (pointers.size === 1) {
      // The land follows the finger, the same way a map does
      const degreesPerPixel = camera.fov / canvas.clientHeight;
      camera.heading -= dx * degreesPerPixel;
      camera.pitch = clamp(camera.pitch + dy * degreesPerPixel, -MAX_PITCH, MAX_PITCH);
    } else if (pointers.size === 2) {
      const distance = getPinchDistance();
      if (pinchDistance > 0 && distance > 0) zoom(pinchDistance / distance);
      pinchDistance = distance;
    }
    requestFrame();
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    pinchDistance = getPinchDistance();
  }

  function getPinchDistance() {
    if (pointers.size !== 2) return 0;
    const [a, b] = Array.from(pointers.values());
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onWheel(e) {
    e.preventDefault();
    // Mouse wheels count in lines, touch pads count in pixels
    const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    zoom(Math.exp(clamp(delta, -200, 200) * 0.0015));
    requestFrame();
  }

  function zoom(factor) {
    camera.fov = clamp(camera.fov * factor, MIN_FIELD_OF_VIEW, MAX_FIELD_OF_VIEW);
  }

  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
    if (!MOVE_KEYS[e.code] && !HEIGHT_KEYS[e.code] && !e.code.startsWith('Shift')) return;

    pressedKeys.add(e.code);
    if (!e.code.startsWith('Shift')) e.preventDefault();
    requestFrame();
  }

  function onKeyUp(e) {
    pressedKeys.delete(e.code);
  }

  function onBlur() {
    pressedKeys.clear();
  }

  function dispose() {
    isDisposed = true;
    clearInterval(clockTimer);
    resizeObserver.disconnect();
    cancelAnimationFrame(frameRequest);

    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);

    renderer.dispose();
  }
}

function isTyping(element) {
  return element && /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName);
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return value < min ? min : (value > max ? max : value);
}
