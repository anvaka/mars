/**
 * Shows photos of a rover around the viewer, each in the direction where the
 * camera was looking when it took the photo.
 *
 * How it works:
 *
 * Every photo becomes a net of triangles. A corner of the net knows which
 * pixel of the photo it is, and where that pixel was looking at: the lens of
 * the camera is a fisheye, and its description comes with the photo (see
 * ./cameraModel.js). The viewer stands in the center, and the nets are around.
 *
 * Photos of one place do not match each other, and here is what we do about it:
 *
 * - The lens makes a photo darker away from its center. We know how much
 *   (see `vignette` in ./loadRoverPhotos.js), and make it brighter back.
 * - The camera picks the exposure for every shot. We compare the places that
 *   two photos both see, and even them out, see ./matchExposure.js. This is
 *   also what saves the shots with the Sun in them: the camera makes them
 *   very dark.
 * - The sides of a photo fade out, so that there is no line where one photo
 *   ends over another. The corners are cut off, the lens leaves them black.
 * - The shots of the land lie over the shots of the sky. The sky is often
 *   shot on another day, when the arm of the rover was at another place. So
 *   the shots of the sky are seen only where no shot of the land is.
 *
 * To read pixels of a photo the browser needs a permission of the server it
 * came from, and NASA does not give it. So the photos are asked through our
 * own server, which adds the permission (see tools/tiles-worker).
 */
import { getWorldDirection } from './loadRoverPhotos.js';
import { matchExposure, getSkyColor } from './matchExposure.js';

const DEGREES = Math.PI / 180;
const MAX_PIXEL_RATIO = 2;
// A triangle of the net is not larger than this many degrees
const NET_STEP = 3;
// The sides of a photo fade out over this share of its width. If the photo
// shares a part of itself with a neighbor, the fade is not wider than a half
// of that part (but not narrower than `MIN_FADE` degrees): where two fades
// meet, we see what is behind the photos.
const FADE_SHARE = 0.1;
const MIN_FADE = 2;
// The top of a shot that looks down fades faster, over this many degrees.
// That shot has only a strip of the sky at its top, and with a wide fade the
// hills at the horizon would be half transparent.
const LAND_TOP_FADE = 5;
// Where the corners of a photo are cut off: the photo starts to fade at the
// first distance from the center of the sensor, and is gone at the second
// (the corner of the sensor is at 1).
const CORNER_FADE = [0.86, 0.95];
// With the sides made brighter, the bright sky turns white. To have less of
// that, every photo is made a bit darker: this is what is left of its
// brightness.
const EXPOSURE = 0.9;
// The exposure is found from small copies of the photos, this many pixels wide
const SMALL_COPY_WIDTH = 64;
// How many times we ask for a photo before giving up, and the pause before
// the second attempt, in milliseconds. The pause grows with every attempt.
const LOAD_ATTEMPTS = 3;
const RETRY_PAUSE = 1200;
// A photo that has to be made brighter or darker by more than this many
// times is not shown: there is too little left of it.
const MAX_GAIN = 4;
// A photo that is made much brighter shows the squares that the JPEG
// compression has left in it. Such photos are of the sky around the Sun,
// where there is nothing to see but the sky. So they are blurred: this is
// what gain it takes, and how many times smaller the picture is read
// (as a power of two).
const BLUR_FROM_GAIN = 2;
const BLUR = 4;

// Where the photos are asked from. NASA's own address goes after it.
const PROXY = (import.meta.env.VITE_PHOTO_PROXY || '').replace(/\/$/, '');
// Photos of the first years of Curiosity are listed at the old address of
// NASA's website. It sends the browser to the new one, where the same photo
// has the same path.
const NASA = /^https?:\/\/mars(?:\.jpl)?\.nasa\.gov\//;

const NET_VERTEX = `#version 300 es
// Where the pixel looks at: north, east, down
in vec3 direction;
// Where the pixel is in the picture of the tile, and in the entire shot.
// The first goes from 0 to 1, the second from -1 to 1.
in vec2 inTile;
in vec2 inShot;

uniform mat3 view;
uniform vec2 zoom;

out vec2 tilePlace;
out vec2 shotPlace;

void main() {
  tilePlace = inTile;
  shotPlace = inShot;
  // right, up, forward
  vec3 seen = view * direction;
  gl_Position = vec4(seen.xy * zoom, 0.0, seen.z);
}`;

const NET_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D photo;
uniform vec3 gain;
uniform float blur;
// How the lens darkens the photo, where its center is, and how to get the
// distance from that center out of a place in the tile
uniform vec4 vignette;
uniform vec2 lensCenter;
uniform vec2 lensScale;
// How long the fades are at the left, right, top and bottom of the shot
uniform vec4 fades;
uniform vec2 cornerFade;

in vec2 tilePlace;
in vec2 shotPlace;
out vec4 color;

const float KNEE = 0.75;

float fade(float fromSide, float size) {
  return size > 0.0 ? smoothstep(0.0, size, fromSide) : 1.0;
}

void main() {
  float fromCenter = length((tilePlace - lensCenter) * lensScale);
  float r2 = fromCenter * fromCenter;
  vec3 rgb = texture(photo, tilePlace, blur).rgb * gain * exp(vignette.x * r2 + vignette.y * r2 * r2 + vignette.z * r2 * r2 * r2 - vignette.w);

  float opacity = fade(shotPlace.x + 1.0, fades.x) * fade(1.0 - shotPlace.x, fades.y) *
    fade(shotPlace.y + 1.0, fades.z) * fade(1.0 - shotPlace.y, fades.w) *
    (1.0 - smoothstep(cornerFade.x, cornerFade.y, fromCenter));

  // What is brighter than the screen can show is not cut off, but squeezed
  // into the brightest part of what the screen has. The color stays.
  float brightest = max(rgb.r, max(rgb.g, rgb.b));
  if (brightest > KNEE) {
    float squeezed = KNEE + (1.0 - KNEE) * (1.0 - exp((KNEE - brightest) / (1.0 - KNEE)));
    rgb *= squeezed / brightest;
  }

  color = vec4(rgb * opacity, opacity);
}`;

const SCREEN_VERTEX = `#version 300 es
out vec2 place;

void main() {
  // One large triangle that covers the screen
  vec2 corner = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  place = corner * 0.5 + 0.5;
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

const MIX_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D land;
uniform sampler2D sky;
uniform mat3 view;
uniform vec2 zoom;

in vec2 place;
out vec4 color;

void main() {
  vec4 landColor = texture(land, place);
  vec4 skyColor = texture(sky, place);

  // How high over the horizon this pixel looks, in degrees
  vec3 direction = normalize(vec3((place * 2.0 - 1.0) / zoom, 1.0) * view);
  float elevation = degrees(-asin(direction.z));

  // Where a shot of the land fades out we see what is behind it. If that is
  // the land on a shot of the sky, the fade is made quick: that land is from
  // another day, and should not be seen through. The sky of the two shots
  // goes one into another slowly.
  float quick = smoothstep(0.0, 0.3, landColor.a);
  float isLand = 1.0 - smoothstep(1.0, 4.0, elevation);
  float landShare = mix(landColor.a, quick, skyColor.a * isLand);

  vec3 solid = landColor.a > 0.001 ? landColor.rgb / landColor.a : vec3(0.0);
  color = vec4(solid * landShare + skyColor.rgb * (1.0 - landShare),
    landShare + skyColor.a * (1.0 - landShare));
}`;

export default function createPhotoSphere(container) {
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);

  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false
  });
  if (!gl) throw new Error('Your browser does not support WebGL 2, which is required to show the photos');

  const netProgram = createProgram(NET_VERTEX, NET_FRAGMENT);
  const mixProgram = createProgram(SCREEN_VERTEX, MIX_FRAGMENT);
  const emptyVertexArray = gl.createVertexArray();
  // Shots of the land are drawn to one picture, shots of the sky to another,
  // and then the two are put together.
  const layers = { land: createLayer(), sky: createLayer() };
  const stencil = gl.createRenderbuffer();
  let layersWidth = 0;
  let layersHeight = 0;
  const smallCopy = document.createElement('canvas').getContext('2d', { willReadFrequently: true });

  let shots = [];
  // The color of the sky on the photos, see getSkyColor() of ./matchExposure.js
  let skyColor = null;
  // True when the photos are black and white
  let isGray = false;
  let camera = { heading: 0, pitch: 0, fov: 60 };
  let drawRequest = 0;
  // Photos are loaded for a while. If the others are asked for meanwhile,
  // those that come late are not needed.
  let lastRequest = 0;
  let isDisposed = false;

  // The photos are hidden now and then, and the window changes its size
  const sizeObserver = new ResizeObserver(requestDraw);
  sizeObserver.observe(container);

  return {
    /**
     * Replaces the photos. See ./loadRoverPhotos.js for the description of
     * frames. Resolves when the photos are loaded and shown, with the number
     * of frames that we have got the photos for.
     */
    setFrames,

    /**
     * Turns the photos to match the camera of the ground view. Angles are in
     * degrees, `fov` is the vertical field of view.
     */
    setCamera,

    /**
     * Tells the color of the sky on the photos that are shown: `[red, green,
     * blue]`, each is 0..1. Gives nothing when the photos have no sky.
     */
    getSkyColor: getSkyColorOfPhotos,

    /**
     * Tells if the photos that are shown are black and white
     */
    isBlackAndWhite: () => isGray,

    dispose
  };

  function setFrames(frames) {
    const request = ++lastRequest;
    forgetShots();
    requestDraw();
    if (!frames.length) return Promise.resolve(0);

    const tiles = frames.flatMap(frame => frame.tiles);
    return Promise.all(tiles.map(tile => loadImage(tile.url))).then(images => {
      if (request !== lastRequest || isDisposed) return 0;

      const imageOf = new Map(tiles.map((tile, index) => [tile, images[index]]));
      const loaded = frames.filter(frame => frame.tiles.some(tile => imageOf.get(tile)));
      if (!loaded.length) throw new Error('None of the photos could be loaded');

      const { shown, gains } = pickMatching(loaded, imageOf);
      shots = shown.map((frame, index) => createShot(frame, shown, gains[index], imageOf));
      const getPicture = tile => getSmallCopy(imageOf.get(tile));
      const sky = getSkyColor(shown, getPicture, gains);
      skyColor = sky && sky.map(channel => channel * EXPOSURE);
      isGray = shown.every(frame => frame.tiles.every(tile => isGrayPicture(getPicture(tile))));
      requestDraw();
      return shown.length;
    });
  }

  function getSkyColorOfPhotos() {
    return skyColor;
  }

  function setCamera(heading, pitch, fov) {
    camera = { heading, pitch, fov };
    requestDraw();
  }

  function dispose() {
    isDisposed = true;
    cancelAnimationFrame(drawRequest);
    sizeObserver.disconnect();
    forgetShots();
    canvas.remove();
    // The browser allows only a few WebGL pictures at a time. This one is
    // not needed anymore.
    const context = gl.getExtension('WEBGL_lose_context');
    if (context) context.loseContext();
  }

  function forgetShots() {
    skyColor = null;
    isGray = false;
    shots.forEach(shot => shot.tiles.forEach(tile => {
      gl.deleteTexture(tile.texture);
      gl.deleteVertexArray(tile.vertexArray);
      tile.buffers.forEach(buffer => gl.deleteBuffer(buffer));
    }));
    shots = [];
  }

  function loadImage(url, attempt = 1) {
    return new Promise(resolve => {
      const image = new Image();
      // This is how we tell that we are going to read the pixels
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => {
        // The archives are sometimes too busy to answer, and are fine a
        // moment later. If not: a panorama without one photo is still a panorama.
        if (attempt >= LOAD_ATTEMPTS || isDisposed) resolve(null);
        else setTimeout(() => resolve(loadImage(url, attempt + 1)), RETRY_PAUSE * attempt);
      };
      image.src = PROXY && NASA.test(url) ? PROXY + '/' + url.replace(NASA, '') : url;
    });
  }

  /**
   * Finds how to even out the exposure of the frames, and leaves out those
   * that cannot be evened out.
   */
  function pickMatching(frames, imageOf) {
    const getPicture = tile => getSmallCopy(imageOf.get(tile));
    let shown = frames;

    for (;;) {
      const matches = matchExposure(shown, getPicture);
      const isGood = (frame, index) => {
        const { gain, isCompared } = matches[index];
        // The camera makes a shot with the Sun dark. If we cannot tell how
        // dark, it is of no use.
        if (frame.seesSun && !isCompared) return false;
        return Math.max(...gain) <= MAX_GAIN && Math.min(...gain) >= 1 / MAX_GAIN;
      };

      const good = shown.filter(isGood);
      // Without the frames that we have dropped the rest match in another
      // way, so we count again.
      if (good.length === shown.length || !good.length) return { shown, gains: matches.map(match => match.gain) };
      shown = good;
    }
  }

  /**
   * Makes a small copy of a picture, and gives its pixels.
   */
  function getSmallCopy(image) {
    if (!image) return null;

    const width = SMALL_COPY_WIDTH;
    const height = Math.max(1, Math.round(width * image.naturalHeight / image.naturalWidth));
    smallCopy.canvas.width = width;
    smallCopy.canvas.height = height;
    smallCopy.drawImage(image, 0, 0, width, height);
    return { width, height, pixels: smallCopy.getImageData(0, 0, width, height).data };
  }

  function isGrayPicture(picture) {
    if (!picture) return true;
    const { pixels } = picture;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] !== pixels[i + 1] || pixels[i] !== pixels[i + 2]) return false;
    }
    return true;
  }

  function createShot(frame, frames, gain, imageOf) {
    // The third part of a direction is how much it goes down
    const isSky = frame.direction[2] < 0;
    const toNeighbors = getAnglesToNeighbors(frame, frames);
    const first = frame.tiles[0];
    const at = (x, y) => getWorldDirection(first.model, first.attitude, x, y);

    // How many degrees the entire shot takes
    const angleX = getAngle(at(0, first.height / 2), at(first.width, first.height / 2)) * first.shot.width / first.width;
    const angleY = getAngle(at(first.width / 2, 0), at(first.width / 2, first.height)) * first.shot.height / first.height;
    const usualFade = FADE_SHARE * angleX;
    const getFade = (side, angle) => {
      const shared = angle - toNeighbors[side];
      const fade = shared > 0 ? Math.max(MIN_FADE, Math.min(usualFade, shared / 2)) : usualFade;
      // The shader counts the shot from -1 to 1
      return 2 * fade / angle;
    };

    const fades = [getFade('left', angleX), getFade('right', angleX), getFade('top', angleY), getFade('bottom', angleY)];
    if (!isSky) fades[2] = Math.min(fades[2], 2 * LAND_TOP_FADE / angleY);

    return {
      isSky,
      gain: gain.map(ofChannel => ofChannel * EXPOSURE),
      blur: Math.max(...gain) > BLUR_FROM_GAIN ? BLUR : 0,
      fades,
      tiles: frame.tiles.filter(tile => imageOf.get(tile)).map(tile => createTile(tile, imageOf.get(tile)))
    };
  }

  function createTile(tile, image) {
    const { model, attitude, width, height, shot, lens } = tile;
    const at = (x, y) => getWorldDirection(model, attitude, x, y);
    const columns = Math.ceil(getAngle(at(0, height / 2), at(width, height / 2)) / NET_STEP);
    const rows = Math.ceil(getAngle(at(width / 2, 0), at(width / 2, height)) / NET_STEP);

    const directions = [];
    const places = [];
    for (let row = 0; row <= rows; ++row) {
      for (let column = 0; column <= columns; ++column) {
        const x = width * column / columns;
        const y = height * row / rows;
        directions.push(...at(x, y));
        places.push(
          x / width, y / height,
          (x - shot.left) / shot.width * 2 - 1, (y - shot.top) / shot.height * 2 - 1
        );
      }
    }

    const triangles = [];
    for (let row = 0; row < rows; ++row) {
      for (let column = 0; column < columns; ++column) {
        const corner = row * (columns + 1) + column;
        const below = corner + columns + 1;
        triangles.push(corner, below, corner + 1, corner + 1, below, below + 1);
      }
    }

    const vertexArray = gl.createVertexArray();
    gl.bindVertexArray(vertexArray);
    const buffers = [
      addAttributes(new Float32Array(directions), [['direction', 3]]),
      addAttributes(new Float32Array(places), [['inTile', 2], ['inShot', 2]])
    ];
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(triangles), gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return {
      vertexArray,
      buffers: buffers.concat(indexBuffer),
      texture,
      count: triangles.length,
      vignette: tile.vignette || [0, 0, 0, 0],
      lensCenter: [lens.centerX / width, lens.centerY / height],
      lensScale: [width / lens.radius, height / lens.radius]
    };
  }

  /**
   * Puts the numbers into a new buffer, and tells which attributes of the
   * net program they are for: `[[name, how many numbers], ...]`
   */
  function addAttributes(numbers, attributes) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, numbers, gl.STATIC_DRAW);

    const stride = attributes.reduce((sum, attribute) => sum + attribute[1], 0) * 4;
    let offset = 0;
    attributes.forEach(([name, size]) => {
      const location = gl.getAttribLocation(netProgram, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
      offset += size * 4;
    });
    return buffer;
  }

  function requestDraw() {
    if (drawRequest || isDisposed) return;
    drawRequest = requestAnimationFrame(() => {
      drawRequest = 0;
      draw();
    });
  }

  function draw() {
    // Nothing to draw on when the photos are hidden
    if (!container.clientWidth || !container.clientHeight) return;
    resize();

    drawLayer(layers.land, shots.filter(shot => !shot.isSky));
    drawLayer(layers.sky, shots.filter(shot => shot.isSky));

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
    gl.useProgram(mixProgram);
    setCameraUniforms(mixProgram);
    bindTexture(mixProgram, 'land', 0, layers.land.texture);
    bindTexture(mixProgram, 'sky', 1, layers.sky.texture);
    gl.bindVertexArray(emptyVertexArray);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function drawLayer(layer, shotsOfLayer) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.STENCIL_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    if (!shotsOfLayer.length) return;

    // Colors are kept multiplied by the opacity, here and everywhere else
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.STENCIL_TEST);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);

    gl.useProgram(netProgram);
    setCameraUniforms(netProgram);
    gl.uniform2fv(gl.getUniformLocation(netProgram, 'cornerFade'), CORNER_FADE);

    // Better shots go first in the list, and they should be on top. So we
    // draw from the last one.
    for (let index = shotsOfLayer.length - 1; index >= 0; --index) {
      const shot = shotsOfLayer[index];
      // Tiles of a shot overlap a little. The stencil remembers which pixels
      // the shot has already painted, and does not let it paint them twice:
      // where the shot fades it would be seen as a line.
      gl.stencilFunc(gl.NOTEQUAL, index % 255 + 1, 0xff);
      gl.uniform3fv(gl.getUniformLocation(netProgram, 'gain'), shot.gain);
      gl.uniform1f(gl.getUniformLocation(netProgram, 'blur'), shot.blur);
      gl.uniform4fv(gl.getUniformLocation(netProgram, 'fades'), shot.fades);

      shot.tiles.forEach(tile => {
        gl.uniform4fv(gl.getUniformLocation(netProgram, 'vignette'), tile.vignette);
        gl.uniform2fv(gl.getUniformLocation(netProgram, 'lensCenter'), tile.lensCenter);
        gl.uniform2fv(gl.getUniformLocation(netProgram, 'lensScale'), tile.lensScale);
        bindTexture(netProgram, 'photo', 0, tile.texture);
        gl.bindVertexArray(tile.vertexArray);
        gl.drawElements(gl.TRIANGLES, tile.count, gl.UNSIGNED_SHORT, 0);
      });
    }
  }

  function setCameraUniforms(program) {
    gl.uniformMatrix3fv(gl.getUniformLocation(program, 'view'), false, getViewMatrix());
    const zoom = 1 / Math.tan(camera.fov * DEGREES / 2);
    gl.uniform2f(gl.getUniformLocation(program, 'zoom'), zoom * canvas.height / canvas.width, zoom);
  }

  /**
   * Makes the matrix that turns [north, east, down] into [right, up, forward]
   * of the screen.
   */
  function getViewMatrix() {
    const sinHeading = Math.sin(camera.heading * DEGREES);
    const cosHeading = Math.cos(camera.heading * DEGREES);
    const sinPitch = Math.sin(camera.pitch * DEGREES);
    const cosPitch = Math.cos(camera.pitch * DEGREES);

    // WebGL wants the matrix column by column: what the north turns into,
    // then the east, then the down.
    return [
      -sinHeading, -cosHeading * sinPitch, cosHeading * cosPitch,
      cosHeading, -sinHeading * sinPitch, sinHeading * cosPitch,
      0, -cosPitch, -sinPitch
    ];
  }

  function resize() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const width = Math.max(1, Math.round(container.clientWidth * pixelRatio));
    const height = Math.max(1, Math.round(container.clientHeight * pixelRatio));
    if (layersWidth === width && layersHeight === height) return;

    canvas.width = layersWidth = width;
    canvas.height = layersHeight = height;

    gl.bindRenderbuffer(gl.RENDERBUFFER, stencil);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.STENCIL_INDEX8, width, height);
    Object.values(layers).forEach(layer => {
      gl.bindTexture(gl.TEXTURE_2D, layer.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, layer.texture, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.STENCIL_ATTACHMENT, gl.RENDERBUFFER, stencil);
    });
  }

  function createLayer() {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { texture, framebuffer: gl.createFramebuffer() };
  }

  function bindTexture(program, name, unit, texture) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(gl.getUniformLocation(program, name), unit);
  }

  function createProgram(vertexSource, fragmentSource) {
    const program = gl.createProgram();
    [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]].forEach(([type, source]) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error('Could not compile a shader of the photos: ' + gl.getShaderInfoLog(shader));
      }
      gl.attachShader(program, shader);
    });
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('Could not link a program of the photos: ' + gl.getProgramInfoLog(program));
    }
    return program;
  }
}

/**
 * Tells how many degrees there are from the frame to its closest neighbor at
 * each side: `{left, right, top, bottom}`. Only the frames that look the same
 * way (up or down) are neighbors: the shots of the sky lie under the shots of
 * the land, and do not need to share anything with them.
 */
function getAnglesToNeighbors(frame, frames) {
  const closest = { left: 180, right: 180, top: 180, bottom: 180 };
  const [north, east, down] = frame.direction;
  const azimuth = Math.atan2(east, north) / DEGREES;
  const elevation = -Math.asin(down) / DEGREES;

  frames.forEach(other => {
    if (other === frame || (other.direction[2] > 0) !== (down > 0)) return;

    const otherAzimuth = Math.atan2(other.direction[1], other.direction[0]) / DEGREES;
    // How far to the right the neighbor is, and how far up:
    const toRight = (((otherAzimuth - azimuth) % 360 + 540) % 360 - 180) * Math.cos(elevation * DEGREES);
    const toTop = -Math.asin(other.direction[2]) / DEGREES - elevation;
    const side = Math.abs(toRight) >= Math.abs(toTop) ?
      (toRight > 0 ? 'right' : 'left') :
      (toTop > 0 ? 'top' : 'bottom');
    closest[side] = Math.min(closest[side], getAngle(frame.direction, other.direction));
  });
  return closest;
}

function getAngle(a, b) {
  const cosine = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, cosine))) / DEGREES;
}
