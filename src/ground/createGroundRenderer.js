/**
 * Draws Mars the way it is seen by someone who stands on it.
 *
 * How it works:
 *
 * The land is a set of rings around the camera, like ripples on the water.
 * The rings are narrow nearby and wide far away. Every corner of a ring reads
 * its elevation from the terrain patch (see ./loadTerrainPatch.js) and bends
 * down with the curvature of the planet.
 *
 * The rings are drawn from the farthest one to the nearest one. This way the
 * near hills cover the far ones without any help from the depth buffer, which
 * is not precise enough when the scene starts at our feet and ends 600km away.
 *
 * Only the rings' part that the camera looks at is drawn (the "wedge"), so
 * all triangles are spent on what is visible.
 *
 * Shadows are computed for the entire patch each time the Sun moves, and
 * stored in textures. See the shadow program in ./shaders.js
 *
 * The land is painted with photos taken from the orbit, where we have them
 * (see ./loadImagery.js), and with the color of dust elsewhere.
 */
import { getShaders } from './shaders.js';
import { PATCH_LEVELS, LARGEST_LEVEL_SIZE } from './loadTerrainPatch.js';
import { IMAGERY_LEVELS, IMAGERY_SIZE } from './loadImagery.js';
import { MARS_RADIUS } from './localProjection.js';

const DEGREES = Math.PI / 180;
// How many pieces each ring is cut into
const SEGMENTS = 768;
const NEAR_PLANE = 0.3;
const FAR_PLANE = 4e6;
const MAX_PIXEL_RATIO = 2;
const LEVELS_COUNT = PATCH_LEVELS.length;
const IMAGERY_COUNT = IMAGERY_LEVELS.length;
// The land is seen at a low angle, and a photo of it is squeezed a lot in
// one direction. This is how hard the video card tries to keep it sharp.
const MAX_ANISOTROPY = 16;

// Texture units. Every level of the terrain is a layer of the first three.
const HEIGHT_UNIT = 0;
const SLOPE_UNIT = 1;
const SHADOW_UNIT = 2;
const COLOR_RAMP_UNIT = 3;
const IMAGERY_UNIT = 4;

export default function createGroundRenderer(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: true,
    alpha: false,
    depth: false,
    powerPreference: 'high-performance'
  });
  if (!gl) throw new Error('Your browser does not support WebGL 2, which is required for the ground view');

  const canFilterFloats = !!gl.getExtension('OES_texture_float_linear');
  const shaders = getShaders(canFilterFloats, LEVELS_COUNT, IMAGERY_COUNT);
  const terrainProgram = createProgram(shaders.terrainVertex, shaders.terrainFragment);
  const skyProgram = createProgram(shaders.screenVertex, shaders.skyFragment);
  const shadowProgram = createProgram(shaders.screenVertex, shaders.shadowFragment);
  [terrainProgram, shadowProgram].forEach(assignTextureUnits);

  const rings = createRings(PATCH_LEVELS[LEVELS_COUNT - 1]);
  const emptyVertexArray = gl.createVertexArray();

  const size = LARGEST_LEVEL_SIZE;
  createTexture(HEIGHT_UNIT, canFilterFloats ? gl.LINEAR : gl.NEAREST, gl.TEXTURE_2D_ARRAY);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R32F, size, size, LEVELS_COUNT);
  createTexture(SLOPE_UNIT, gl.LINEAR, gl.TEXTURE_2D_ARRAY);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA16F, size, size, LEVELS_COUNT);
  const shadows = createTexture(SHADOW_UNIT, gl.LINEAR, gl.TEXTURE_2D_ARRAY);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R8, size, size, LEVELS_COUNT);
  const shadowsFrame = gl.createFramebuffer();

  // What is loaded into each layer, see `loadPatchLevel()`
  const levels = new Array(LEVELS_COUNT).fill(null);

  createTexture(IMAGERY_UNIT, gl.LINEAR, gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.floor(Math.log2(IMAGERY_SIZE)) + 1, gl.SRGB8_ALPHA8,
    IMAGERY_SIZE, IMAGERY_SIZE, IMAGERY_COUNT);
  const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
  if (anisotropy) {
    gl.texParameterf(gl.TEXTURE_2D_ARRAY, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
      Math.min(MAX_ANISOTROPY, gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  }
  // Where each photo is on the patch: {x, y, halfExtent}
  const imagery = new Array(IMAGERY_COUNT).fill(null);

  const colorRamp = createTexture(COLOR_RAMP_UNIT, gl.LINEAR);
  let colorRampRange = [0, 1, 0];
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

  let sun = [0, 0, 1];
  let photoSky = [0, 0, 0, 0];
  let shadowsAreOld = true;
  let lastView = null;

  return {
    /**
     * Uploads a level of the terrain patch, see `loadPatchLevel()`
     */
    setLevel,

    /**
     * Forgets a level of the terrain
     */
    clearLevel,

    /**
     * Forgets the terrain and the photos
     */
    clearLevels,

    /**
     * Paints a part of the land with a photo taken from the orbit. `level`
     * is the index in IMAGERY_LEVELS, `picture` is a canvas (north is up),
     * and `place` tells where the picture is on the patch: {x, y, halfExtent}
     * in meters. Pass no picture to forget the level.
     */
    setImagery,

    /**
     * Sets the direction to the Sun at the center of the patch
     */
    setSun,

    /**
     * Paints the land with colors of a map theme. Pass `null` to get the
     * natural colors back.
     */
    setColorRamp,

    /**
     * Makes the sky of the color that the photos of a rover have: `[red,
     * green, blue]`, each is 0..1. Pass nothing to get our own sky back.
     */
    setPhotoSky(color) {
      photoSky = color ? [color[0], color[1], color[2], 1] : [0, 0, 0, 0];
    },

    /**
     * Draws a frame. The `camera` is `{x, y, altitude, heading, pitch, fov}`:
     * position on the patch in meters, and angles in degrees.
     */
    render,

    /**
     * Tells where a place of the patch is on the screen in the last frame.
     */
    project,

    dispose
  };

  function setLevel(level) {
    const { size, index } = level;
    levels[index] = level;

    gl.activeTexture(gl.TEXTURE0 + HEIGHT_UNIT);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, index, size, size, 1, gl.RED, gl.FLOAT, level.heights);
    gl.activeTexture(gl.TEXTURE0 + SLOPE_UNIT);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, index, size, size, 1, gl.RGBA, gl.FLOAT, level.slopes);

    shadowsAreOld = true;
  }

  function clearLevel(index) {
    if (!levels[index]) return;
    levels[index] = null;
    // The land that was in its shadow is now in the shadow of something else
    shadowsAreOld = true;
  }

  function clearLevels() {
    levels.fill(null);
    imagery.fill(null);
    shadowsAreOld = true;
  }

  function setImagery(level, picture, place) {
    imagery[level] = picture ? place : null;
    if (!picture) return;

    gl.activeTexture(gl.TEXTURE0 + IMAGERY_UNIT);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, level, IMAGERY_SIZE, IMAGERY_SIZE, 1,
      gl.RGBA, gl.UNSIGNED_BYTE, picture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  }

  function setSun(direction) {
    sun = [direction.east, direction.north, direction.up];
    shadowsAreOld = true;
  }

  function setColorRamp(stops) {
    if (!stops) {
      colorRampRange = [0, 1, 0];
      return;
    }

    // The browser knows how to read colors and how to mix them:
    const width = 512;
    const rampCanvas = document.createElement('canvas');
    rampCanvas.width = width;
    rampCanvas.height = 1;
    const ctx = rampCanvas.getContext('2d');
    const lowest = stops[0].elevation;
    const highest = stops[stops.length - 1].elevation;
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    stops.forEach(stop => {
      gradient.addColorStop((stop.elevation - lowest) / (highest - lowest), stop.color);
    });
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, 1);

    gl.activeTexture(gl.TEXTURE0 + COLOR_RAMP_UNIT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, rampCanvas);
    colorRampRange = [lowest, highest, 1];
  }

  function render(camera) {
    resize();
    if (shadowsAreOld) updateShadows();

    const view = lastView = getView(camera);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);

    drawSky(view);
    if (levels[LEVELS_COUNT - 1]) drawTerrain(view);
  }

  function drawSky(view) {
    gl.useProgram(skyProgram.id);
    gl.bindVertexArray(emptyVertexArray);
    gl.uniform3fv(skyProgram.uniform('uSun'), sun);
    gl.uniform3fv(skyProgram.uniform('uForward'), view.forward);
    gl.uniform3fv(skyProgram.uniform('uRight'), scale(view.right, view.tanX));
    gl.uniform3fv(skyProgram.uniform('uUp'), scale(view.up, view.tanY));
    gl.uniform4fv(skyProgram.uniform('uPhotoSky'), photoSky);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function drawTerrain(view) {
    const { camera } = view;
    gl.useProgram(terrainProgram.id);
    gl.bindVertexArray(rings.vertexArray);
    setLevelUniforms(terrainProgram);

    gl.uniformMatrix4fv(terrainProgram.uniform('uViewProjection'), false, view.viewProjection);
    gl.uniform2f(terrainProgram.uniform('uCamera'), camera.x, camera.y);
    gl.uniform1f(terrainProgram.uniform('uAltitude'), camera.altitude);
    gl.uniform1f(terrainProgram.uniform('uHeading'), camera.heading * DEGREES);
    gl.uniform1f(terrainProgram.uniform('uWedge'), view.wedge);
    gl.uniform3fv(terrainProgram.uniform('uSun'), sun);
    gl.uniform3fv(terrainProgram.uniform('uSunAtCamera'), getSunAt(camera.x, camera.y));
    gl.uniform3fv(terrainProgram.uniform('uColorRampRange'), colorRampRange);
    gl.uniform1fv(terrainProgram.uniform('uImageryHalfExtent'), imagery.map(photo => photo ? photo.halfExtent : 0));
    gl.uniform2fv(terrainProgram.uniform('uImageryCenter'), imagery.flatMap(photo => photo ? [photo.x, photo.y] : [0, 0]));

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, rings.verticesInRing, rings.count);
  }

  function updateShadows() {
    shadowsAreOld = false;
    const highestPoint = levels.reduce((highest, level) => {
      return level ? Math.max(highest, level.max) : highest;
    }, -Infinity);

    gl.useProgram(shadowProgram.id);
    gl.bindVertexArray(emptyVertexArray);
    setLevelUniforms(shadowProgram);
    gl.uniform3fv(shadowProgram.uniform('uSun'), sun);
    gl.uniform1f(shadowProgram.uniform('uHighestPoint'), highestPoint);

    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowsFrame);
    levels.forEach(level => {
      if (!level) return;
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, shadows, 0, level.index);
      gl.viewport(0, 0, level.size, level.size);
      gl.uniform1f(shadowProgram.uniform('uTargetHalfExtent'), level.halfExtent);
      gl.uniform1f(shadowProgram.uniform('uTargetTexelSize'), level.texelSize);
      gl.uniform2f(shadowProgram.uniform('uTargetCenter'), level.x, level.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function setLevelUniforms(program) {
    // Level that is not loaded gets zero extent, and shaders skip it
    gl.uniform1fv(program.uniform('uHalfExtent'), levels.map(level => level ? level.halfExtent : 0));
    gl.uniform1fv(program.uniform('uTexelSize'), PATCH_LEVELS.map(level => level.texelSize));
    gl.uniform1fv(program.uniform('uLevelSize'), PATCH_LEVELS.map(level => level.size));
    gl.uniform1fv(program.uniform('uLevelShare'), PATCH_LEVELS.map(level => level.size / LARGEST_LEVEL_SIZE));
    gl.uniform2fv(program.uniform('uLevelCenter'), levels.flatMap(level => level ? [level.x, level.y] : [0, 0]));
    gl.uniform1i(program.uniform('uLastLevel'), LEVELS_COUNT - 1);
  }

  function getView(camera) {
    const heading = camera.heading * DEGREES;
    const pitch = camera.pitch * DEGREES;
    const sinH = Math.sin(heading), cosH = Math.cos(heading);
    const sinP = Math.sin(pitch), cosP = Math.cos(pitch);

    // x is East, y is North, z is up
    const forward = [sinH * cosP, cosH * cosP, sinP];
    const right = [cosH, -sinH, 0];
    const up = [-sinH * sinP, -cosH * sinP, cosP];

    const aspect = canvas.width / canvas.height;
    const tanY = Math.tan(camera.fov * DEGREES / 2);
    const tanX = tanY * aspect;

    const depthScale = (FAR_PLANE + NEAR_PLANE) / (NEAR_PLANE - FAR_PLANE);
    const depthShift = 2 * FAR_PLANE * NEAR_PLANE / (NEAR_PLANE - FAR_PLANE);
    // Columns go first:
    const viewProjection = new Float32Array([
      right[0] / tanX, up[0] / tanY, -forward[0] * depthScale, forward[0],
      right[1] / tanX, up[1] / tanY, -forward[1] * depthScale, forward[1],
      right[2] / tanX, up[2] / tanY, -forward[2] * depthScale, forward[2],
      0, 0, depthShift, 0
    ]);

    return {
      camera, forward, right, up, tanX, tanY, viewProjection,
      wedge: getWedge(pitch, tanX, tanY)
    };
  }

  /**
   * Gives half of the angle (around the vertical axis) that the camera sees.
   */
  function getWedge(pitch, tanX, tanY) {
    // When the screen has the point right below us (or right above), we see
    // the land in every direction
    if (Math.abs(pitch) + Math.atan(tanY) > Math.PI / 2 - 0.02) return Math.PI;

    // Otherwise the corners of the screen look the furthest to the side.
    let widest = 0;
    [-1, 1].forEach(side => {
      const forwardShare = Math.cos(pitch) - side * tanY * Math.sin(pitch);
      widest = Math.max(widest, Math.atan2(tanX, forwardShare));
    });
    return Math.min(Math.PI, widest * 1.02 + 0.01);
  }

  function getSunAt(x, y) {
    // The same math as in getSunAt() of the shaders
    const fromCenter = Math.sqrt(x * x + y * y);
    if (fromCenter < 1) return sun;
    const awayX = x / fromCenter, awayY = y / fromCenter;
    const angle = fromCenter / MARS_RADIUS;
    const c = Math.cos(angle), s = Math.sin(angle);
    const along = sun[0] * awayX + sun[1] * awayY;
    const shift = along * c - sun[2] * s - along;
    return [sun[0] + awayX * shift, sun[1] + awayY * shift, sun[2] * c + along * s];
  }

  function project(x, y, height) {
    if (!lastView) return null;
    const { camera, viewProjection: m } = lastView;

    const dx = x - camera.x, dy = y - camera.y;
    const fromCamera = Math.sqrt(dx * dx + dy * dy);
    const angle = fromCamera / MARS_RADIUS;
    const flat = fromCamera > 0 ? (MARS_RADIUS + height) * Math.sin(angle) / fromCamera : 0;
    const halfSine = Math.sin(angle / 2);
    const px = dx * flat;
    const py = dy * flat;
    const pz = height * Math.cos(angle) - 2 * MARS_RADIUS * halfSine * halfSine - camera.altitude;

    const w = m[3] * px + m[7] * py + m[11] * pz;
    if (w <= NEAR_PLANE) return null;

    const clipX = (m[0] * px + m[4] * py + m[8] * pz) / w;
    const clipY = (m[1] * px + m[5] * py + m[9] * pz) / w;
    return {
      x: (clipX + 1) / 2 * canvas.clientWidth,
      y: (1 - clipY) / 2 * canvas.clientHeight,
      distance: Math.sqrt(px * px + py * py + pz * pz)
    };
  }

  function resize() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const width = Math.max(1, Math.round(canvas.clientWidth * pixelRatio));
    const height = Math.max(1, Math.round(canvas.clientHeight * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function createRings(largestLevel) {
    const radii = getRingRadii(largestLevel.size * largestLevel.texelSize / 2);
    // Far rings go first, so that the near ones are drawn on top of them
    const ringSides = new Float32Array((radii.length - 1) * 2);
    for (let i = radii.length - 1, offset = 0; i > 0; --i) {
      ringSides[offset++] = radii[i];
      ringSides[offset++] = radii[i - 1];
    }

    const strip = new Float32Array((SEGMENTS + 1) * 4);
    for (let i = 0; i <= SEGMENTS; ++i) {
      strip.set([i / SEGMENTS, 0, i / SEGMENTS, 1], i * 4);
    }

    const vertexArray = gl.createVertexArray();
    gl.bindVertexArray(vertexArray);

    const stripBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, stripBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, strip, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const ringsBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ringsBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, ringSides, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    // One pair of radii per ring:
    gl.vertexAttribDivisor(1, 1);

    gl.bindVertexArray(null);

    return {
      vertexArray,
      verticesInRing: (SEGMENTS + 1) * 2,
      count: radii.length - 1
    };
  }

  function createTexture(unit, filter, target = gl.TEXTURE_2D) {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    // Each texture stays in its own unit for the entire life
    gl.bindTexture(target, texture);
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  function assignTextureUnits(program) {
    gl.useProgram(program.id);
    gl.uniform1i(program.uniform('uHeights'), HEIGHT_UNIT);
    gl.uniform1i(program.uniform('uSlopes'), SLOPE_UNIT);
    gl.uniform1i(program.uniform('uShadows'), SHADOW_UNIT);
    gl.uniform1i(program.uniform('uColorRamp'), COLOR_RAMP_UNIT);
    gl.uniform1i(program.uniform('uImagery'), IMAGERY_UNIT);
  }

  function createProgram(vertexSource, fragmentSource) {
    const id = gl.createProgram();
    gl.attachShader(id, compileShader(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(id, compileShader(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(id);
    if (!gl.getProgramParameter(id, gl.LINK_STATUS)) {
      throw new Error('Could not link the ground view program: ' + gl.getProgramInfoLog(id));
    }

    const locations = new Map();
    return {
      id,
      uniform(name) {
        if (!locations.has(name)) locations.set(name, gl.getUniformLocation(id, name));
        return locations.get(name);
      }
    };
  }

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error('Could not compile the ground view shader: ' + gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  function dispose() {
    // Dropping the context gives all the memory back at once
    const loseContext = gl.getExtension('WEBGL_lose_context');
    if (loseContext) loseContext.loseContext();
  }
}

/**
 * Gives distances from the camera to the sides of the rings, from the nearest
 * to the farthest one.
 */
function getRingRadii(largestRadius) {
  const radii = [0];
  let radius = 0.5;
  // Where the rovers drive the land is known every couple of meters. So the
  // rings start half a meter wide, and grow with the distance: what is far
  // is small on the screen. They stop growing when they are as wide as the
  // samples of the elevation of the entire planet.
  while (radius < 24000) {
    radii.push(radius);
    radius += Math.min(100, Math.max(0.5, radius * 0.01));
  }
  // The land that far is even smaller on the screen
  while (radius < largestRadius) {
    radii.push(radius);
    radius *= 1.0045;
  }
  radii.push(largestRadius);
  return radii;
}

function scale(vector, factor) {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}
