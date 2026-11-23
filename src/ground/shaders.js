/**
 * GLSL programs of the ground view. See ./createGroundRenderer.js for the
 * description of how they work together.
 */

/**
 * @param {Boolean} canFilterFloats - true when the video card is able to mix
 * neighboring pixels of a float texture. Otherwise we do it ourselves.
 */
export function getShaders(canFilterFloats, levelsCount, imageryCount) {
  const header = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;
${canFilterFloats ? '#define CAN_FILTER_FLOATS' : ''}
// Elevation is counted from the sphere of this radius, in meters
const float MARS_RADIUS = 3396190.0;
const int LEVELS = ${levelsCount};
const int IMAGERY_LEVELS = ${imageryCount};
`;
  return {
    terrainVertex: header + TERRAIN_DATA + TERRAIN_VERTEX,
    terrainFragment: header + TERRAIN_DATA + LIGHT + TERRAIN_FRAGMENT,
    screenVertex: header + SCREEN_VERTEX,
    skyFragment: header + LIGHT + SKY_FRAGMENT,
    shadowFragment: header + TERRAIN_DATA + LIGHT + SHADOW_FRAGMENT,
  };
}

/**
 * The terrain is stored in several levels of detail (see ./loadTerrainPatch.js).
 * Makes a function that reads from the most detailed level available at a
 * place, and smoothly mixes the levels where one ends and the next one begins.
 */
function makeLevelsReader(name, type, read) {
  return `
${type} ${name}(vec2 place) {
  ${type} result = ${type}(0.0);
  // The share that is still to be taken from the less detailed levels
  float left = 1.0;
  for (int level = 0; level <= uLastLevel; ++level) {
    float halfExtent = uHalfExtent[level];
    if (halfExtent <= 0.0) continue; // not loaded

    vec2 local = place - uLevelCenter[level];
    float coarser = level == uLastLevel ? 0.0 : getCoarserShare(local, halfExtent, uTexelSize[level]);
    if (coarser >= 1.0) continue;

    result += left * (1.0 - coarser) * ${read};
    left *= coarser;
    if (left <= 0.0) break;
  }
  return result;
}`;
}

const TERRAIN_DATA = `
// Every level is a layer of these pictures.
// Elevation in meters:
uniform sampler2DArray uHeights;
// How fast the elevation grows to the East and to the North, and how deep
// the place sits below its neighbors (see getHollows() in ./loadTerrainPatch.js)
uniform sampler2DArray uSlopes;
// How much of the Sun is visible from the place: 0 - none, 1 - entire disk
uniform sampler2DArray uShadows;

// Description of the levels. Level that is not loaded has zero extent
uniform float uHalfExtent[LEVELS];  // distance from the center to the side, in meters
uniform float uTexelSize[LEVELS];   // size of a pixel in meters
uniform float uLevelSize[LEVELS];   // number of pixels along the side
uniform float uLevelShare[LEVELS];  // which part of the layer's side the level takes
uniform vec2 uLevelCenter[LEVELS];  // where the center of the level is on the patch
// The least detailed level
uniform int uLastLevel;

// Tells how much to take from the next, less detailed, level. The 'local'
// is in meters from the center of the level.
float getCoarserShare(vec2 local, float halfExtent, float texelSize) {
  float fromCenter = max(abs(local.x), abs(local.y));
  return smoothstep(halfExtent - 24.0 * texelSize, halfExtent - 2.0 * texelSize, fromCenter);
}

vec3 getLevelUV(vec2 local, int level) {
  return vec3((local / (2.0 * uHalfExtent[level]) + 0.5) * uLevelShare[level], float(level));
}

float readHeight(vec2 local, int level) {
#ifdef CAN_FILTER_FLOATS
  return textureLod(uHeights, getLevelUV(local, level), 0.0).r;
#else
  float size = uLevelSize[level];
  vec2 pixel = clamp((local / (2.0 * uHalfExtent[level]) + 0.5) * size - 0.5, vec2(0.0), vec2(size - 1.0));
  ivec2 corner = ivec2(floor(pixel));
  ivec2 next = min(corner + 1, ivec2(int(size) - 1));
  vec2 weight = pixel - floor(pixel);
  float a = texelFetch(uHeights, ivec3(corner, level), 0).r;
  float b = texelFetch(uHeights, ivec3(next.x, corner.y, level), 0).r;
  float c = texelFetch(uHeights, ivec3(corner.x, next.y, level), 0).r;
  float d = texelFetch(uHeights, ivec3(next, level), 0).r;
  return mix(mix(a, b, weight.x), mix(c, d, weight.x), weight.y);
#endif
}
${makeLevelsReader('getHeight', 'float', 'readHeight(local, level)')}
${makeLevelsReader('getSlope', 'vec3', 'textureLod(uSlopes, getLevelUV(local, level), 0.0).rgb')}
${makeLevelsReader('getSunlitShare', 'float', 'textureLod(uShadows, getLevelUV(local, level), 0.0).r')}
`;

/**
 * Everything about the light. Colors here are linear, 'toScreen()' turns them
 * into what the monitor expects.
 */
const LIGHT = `
// Unit vector that points to the Sun from the center of the patch. x is East,
// y is North, z is up.
uniform vec3 uSun;

// "Up" tilts as we walk around the planet, so the same Sun is at a different
// height in the sky of every place.
vec3 getSunAt(vec2 place) {
  float fromCenter = length(place);
  if (fromCenter < 1.0) return uSun;

  vec2 away = place / fromCenter;
  float angle = fromCenter / MARS_RADIUS;
  float c = cos(angle);
  float s = sin(angle);
  float along = dot(uSun.xy, away);
  return vec3(uSun.xy + away * (along * c - uSun.z * s - along), uSun.z * c + along * s);
}

// 0 at night, 1 during the day. The dust keeps glowing long after the sunset,
// so the twilight on Mars is long.
float getDaylight(float sunHeight) {
  float day = smoothstep(-0.17, 0.12, sunHeight);
  return day * day;
}

// The share of the sunlight that makes it through the dust. The lower the
// Sun, the more dust is on the way.
float getSunTransmittance(float sunHeight) {
  return exp(-0.16 / max(sunHeight, 0.02)) * smoothstep(-0.01, 0.02, sunHeight);
}

vec3 getSkyColor(vec3 direction, vec3 sun) {
  float up = max(direction.z, 0.0);
  float daylight = getDaylight(sun.z);

  // The dust makes the sky butterscotch. There is more dust to look through
  // near the horizon, so the sky is brighter there.
  vec3 zenith = vec3(0.30, 0.185, 0.105);
  vec3 horizon = vec3(0.62, 0.40, 0.22);
  vec3 color = mix(horizon, zenith, 1.0 - exp(-3.5 * up)) * mix(0.0012, 1.0, daylight);

  // The dust scatters blue light forward. That is why there is a glow around
  // the Sun, and why the sunset on Mars is blue.
  float angle = acos(clamp(dot(direction, sun), -1.0, 1.0));
  float low = 1.0 - smoothstep(0.0, 0.42, sun.z);
  vec3 glowColor = mix(vec3(1.0, 0.86, 0.66), vec3(0.42, 0.62, 1.0), low);
  float glow = 0.75 * exp(-angle / 0.07) + 0.30 * exp(-angle / 0.30);
  // Once the Sun is below the horizon the glow fades and hugs the horizon:
  float sunIsNear = smoothstep(-0.25, 0.03, sun.z);
  glow *= sunIsNear * mix(1.0, exp(-6.0 * up), 1.0 - smoothstep(-0.1, 0.05, sun.z));
  color += glowColor * glow * (0.55 + 0.75 * low);

  return color;
}

// Light that comes straight from the Sun
vec3 getSunLight(float sunHeight) {
  float low = 1.0 - smoothstep(0.0, 0.42, sunHeight);
  vec3 color = mix(vec3(1.0, 0.95, 0.88), vec3(0.80, 0.88, 1.0), low);
  return 2.7 * color * getSunTransmittance(sunHeight);
}

// Light that comes from the entire sky
vec3 getSkyLight(float sunHeight) {
  return vec3(0.27, 0.185, 0.125) * mix(0.0012, 1.0, getDaylight(sunHeight));
}

vec3 toScreen(vec3 color, float sunHeight) {
  // Eyes get used to the dark:
  float exposure = mix(14.0, 1.15, smoothstep(-0.22, 0.10, sunHeight));
  color = 1.0 - exp(-color * exposure);
  color = pow(color, vec3(1.0 / 2.2));
  // The sky is a very smooth gradient. A bit of noise hides the steps
  // between the few colors that the screen is able to show.
  float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  return color + (noise - 0.5) / 255.0;
}
`;

const TERRAIN_VERTEX = `
// x: position across the visible wedge of the land, 0..1
// y: 0 for the far side of the ring, 1 for the near side
layout(location = 0) in vec2 aStrip;
// distance from the camera to the far and to the near side of the ring
layout(location = 1) in vec2 aRing;

uniform mat4 uViewProjection;
uniform vec2 uCamera;      // where the camera is on the patch
uniform float uAltitude;   // and how high it is
uniform float uHeading;    // direction the camera looks at. Radians, clockwise from North
uniform float uWedge;      // half of the angle covered by the rings

out vec2 vPlace;
out float vHeight;
out vec3 vFromCamera;

void main() {
  float fromCamera = mix(aRing.x, aRing.y, aStrip.y);
  float azimuth = uHeading + (2.0 * aStrip.x - 1.0) * uWedge;
  vec2 direction = vec2(sin(azimuth), cos(azimuth));

  vPlace = uCamera + direction * fromCamera;
  vHeight = getHeight(vPlace);

  // The planet is round: the land sinks below the horizon as it gets further.
  // The math is arranged to not subtract huge numbers from each other.
  float angle = fromCamera / MARS_RADIUS;
  float halfSine = sin(0.5 * angle);
  vec3 position = vec3(
    direction * ((MARS_RADIUS + vHeight) * sin(angle)),
    vHeight * cos(angle) - 2.0 * MARS_RADIUS * halfSine * halfSine
  );

  vFromCamera = position - vec3(0.0, 0.0, uAltitude);
  gl_Position = uViewProjection * vec4(vFromCamera, 1.0);
}
`;

const TERRAIN_FRAGMENT = `
const float DUST_SCALE_HEIGHT = 11000.0;
// On a clear day, at zero elevation, a mountain this far is still visible
const float VISIBILITY = 120000.0;
// Photos from the orbit are stretched to look good on a screen. This brings
// them back to how much light the land reflects.
const float IMAGERY_GAIN = 1.0;

uniform vec3 uSunAtCamera;
uniform float uAltitude;
// Colors of the map theme, when the terrain is painted the same way as the map
uniform sampler2D uColorRamp;
uniform vec3 uColorRampRange; // lowest elevation, highest elevation, 1 if in use

// Photos of the land taken from the orbit, see ./loadImagery.js. Just like the
// elevation, they come in levels: each next one covers more land with less detail.
uniform sampler2DArray uImagery;
uniform float uImageryHalfExtent[IMAGERY_LEVELS]; // zero when there is no photo
uniform vec2 uImageryCenter[IMAGERY_LEVELS];

in vec2 vPlace;
in float vHeight;
in vec3 vFromCamera;

out vec4 outColor;

// Gives the color of the land on the photos, multiplied by its alpha. Alpha
// tells how much of the place the photos cover.
vec4 getImagery() {
  // How the place changes from a pixel of the screen to its neighbors. It
  // tells which size of the photo to read.
  vec2 right = dFdx(vPlace);
  vec2 down = dFdy(vPlace);

  vec4 result = vec4(0.0);
  for (int level = 0; level < IMAGERY_LEVELS; ++level) {
    float halfExtent = uImageryHalfExtent[level];
    if (halfExtent <= 0.0) continue;

    vec2 local = vPlace - uImageryCenter[level];
    float fromCenter = max(abs(local.x), abs(local.y));
    float inside = 1.0 - smoothstep(0.8 * halfExtent, 0.97 * halfExtent, fromCenter);
    if (inside <= 0.0) continue;

    // North is at the top of a photo
    float side = 2.0 * halfExtent;
    vec2 uv = vec2(local.x, -local.y) / side + 0.5;
    vec4 photo = textureGrad(uImagery, vec3(uv, float(level)),
      vec2(right.x, -right.y) / side, vec2(down.x, -down.y) / side);

    result += (1.0 - result.a) * inside * photo;
    if (result.a > 0.995) break;
  }
  return result;
}

vec3 getSurfaceColor(float steepness) {
  if (uColorRampRange.z > 0.5) {
    float position = (vHeight - uColorRampRange.x) / (uColorRampRange.y - uColorRampRange.x);
    return pow(texture(uColorRamp, vec2(position, 0.5)).rgb, vec3(2.2));
  }
  // Dust covers everything that is flat enough to hold it. Steep slopes show
  // darker rock.
  vec3 dust = vec3(0.37, 0.185, 0.088);
  vec3 rock = vec3(0.20, 0.115, 0.07);
  vec3 color = mix(dust, rock, smoothstep(0.12, 0.55, steepness));

  vec4 photo = getImagery();
  return color * (1.0 - photo.a) + photo.rgb * IMAGERY_GAIN;
}

void main() {
  vec3 shape = getSlope(vPlace);
  vec2 slope = shape.xy;
  vec3 normal = normalize(vec3(-slope, 1.0));
  vec3 sun = getSunAt(vPlace);

  // A hollow sees less of the sky than a hilltop does. When the Sun is high
  // and there are no shadows, this is what tells them apart.
  float openness = clamp(1.0 - 2.2 * shape.z, 0.45, 1.25);

  float facingSun = max(dot(normal, sun), 0.0);
  vec3 light = getSunLight(sun.z) * facingSun * getSunlitShare(vPlace) * mix(1.0, openness, 0.35) +
    getSkyLight(sun.z) * (0.55 + 0.45 * normal.z) * openness;
  vec3 color = getSurfaceColor(length(slope)) * light;

  // The dust in the air hides what is far. There is less of it higher up.
  float distanceToCamera = length(vFromCamera);
  vec3 view = vFromCamera / distanceToCamera;
  float climb = (vHeight - uAltitude) / DUST_SCALE_HEIGHT;
  float dust = exp(-uAltitude / DUST_SCALE_HEIGHT) *
    (abs(climb) < 1e-3 ? 1.0 : (1.0 - exp(-climb)) / climb);
  float haze = 1.0 - exp(-dust * distanceToCamera / VISIBILITY);
  vec3 hazeColor = getSkyColor(normalize(vec3(view.xy, max(view.z, 0.0) + 0.02)), uSunAtCamera);
  color = mix(color, hazeColor, haze);

  outColor = vec4(toScreen(color, uSunAtCamera.z), 1.0);
}
`;

/**
 * One triangle that covers the entire screen
 */
const SCREEN_VERTEX = `
out vec2 vUV;

void main() {
  vUV = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(vUV * 2.0 - 1.0, 0.0, 1.0);
}
`;

const SKY_FRAGMENT = `
// The Sun as seen from Mars is 0.35 degrees wide
const float SUN_RADIUS = 0.00305;

// Where the camera looks, and how far the edges of the screen are from the
// center of it:
uniform vec3 uForward;
uniform vec3 uRight;
uniform vec3 uUp;
// The color of the sky on the photos that are shown over the picture, as
// a screen shows it. The last number is zero when there are no photos.
uniform vec4 uPhotoSky;

in vec2 vUV;
out vec4 outColor;

void main() {
  vec2 screen = vUV * 2.0 - 1.0;
  vec3 direction = normalize(uForward + screen.x * uRight + screen.y * uUp);
  if (uPhotoSky.a > 0.0) {
    // The photos do not cover everything, and our sky is seen between them.
    // A camera sees the sky in its own way (some see it gray), so our sky
    // takes the color of theirs. It still gets brighter towards the horizon.
    float up = max(direction.z, 0.0);
    outColor = vec4(uPhotoSky.rgb * mix(1.12, 0.9, 1.0 - exp(-3.5 * up)), 1.0);
    return;
  }
  vec3 color = getSkyColor(direction, uSun);

  // Size of a pixel, to keep the edge of the disk smooth:
  float pixel = length(fwidth(direction));
  float fromSun = length(direction - uSun);
  float disk = 1.0 - smoothstep(SUN_RADIUS - pixel, SUN_RADIUS + pixel, fromSun);
  color += disk * 30.0 * getSunTransmittance(max(uSun.z, 0.03)) * step(-0.01, direction.z);

  outColor = vec4(toScreen(color, uSun.z), 1.0);
}
`;

/**
 * For every pixel of a level tells how much of the Sun is visible from there:
 * we walk from the pixel towards the Sun, and see if the land gets in the way.
 */
const SHADOW_FRAGMENT = `
const int MAX_STEPS = 192;
// Angular size of the Sun. Larger than the real one, to keep the edges of
// the shadows soft: the land itself is known only every 200 meters.
const float SUN_SIZE = 0.008;

// The level that we fill
uniform float uTargetHalfExtent;
uniform float uTargetTexelSize;
uniform vec2 uTargetCenter;
// Nothing on the patch is higher than this
uniform float uHighestPoint;

in vec2 vUV;
out vec4 outColor;

void main() {
  vec2 place = uTargetCenter + (vUV * 2.0 - 1.0) * uTargetHalfExtent;
  vec3 sun = getSunAt(place);
  if (sun.z < -0.03) {
    outColor = vec4(0.0);
    return;
  }

  float flatLength = length(sun.xy);
  if (flatLength < 1e-4) {
    outColor = vec4(1.0);
    return;
  }
  vec2 direction = sun.xy / flatLength;
  float climb = sun.z / flatLength;
  float farthest = uHalfExtent[uLastLevel];

  float start = getHeight(place);
  float sunlit = 1.0;
  float walked = uTargetTexelSize;
  for (int i = 0; i < MAX_STEPS; ++i) {
    vec2 current = place + direction * walked;
    if (max(abs(current.x), abs(current.y)) > farthest) break;

    // The planet is round, so the ray goes up even when it is horizontal
    float ray = start + walked * climb + walked * walked / (2.0 * MARS_RADIUS);
    if (ray > uHighestPoint) break;

    float clearance = ray - getHeight(current);
    sunlit = min(sunlit, 0.5 + clearance / (walked * SUN_SIZE));
    if (sunlit <= 0.0) break;

    // A mountain can cast its shadow on a pebble: the steps grow, so that a
    // detailed level gets as far as the others.
    walked += max(uTargetTexelSize * 0.75, walked * 0.04);
  }

  outColor = vec4(clamp(sunlit, 0.0, 1.0));
}
`;
