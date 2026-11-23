import{a as e,dt as t,i as n,pt as r,r as i,u as a,ut as o}from"./elevationTiles-CBP3-G6C.js";import{C as s,D as c,E as l,S as u,i as d,n as f,r as p,w as m}from"./index-CUnNwb7A.js";import{_ as h,a as g,b as _,c as v,d as y,f as b,l as x,m as S,r as C,s as w,t as T,v as E}from"./_plugin-vue_export-helper-CaQa2uRO.js";function ee(e,t,n){let r=`#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;
${e?`#define CAN_FILTER_FLOATS`:``}
// Elevation is counted from the sphere of this radius, in meters
const float MARS_RADIUS = 3396190.0;
const int LEVELS = ${t};
const int IMAGERY_LEVELS = ${n};
`;return{terrainVertex:r+O+A,terrainFragment:r+O+k+j,screenVertex:r+M,skyFragment:r+k+N,shadowFragment:r+O+k+te}}function D(e,t,n){return`
${t} ${e}(vec2 place) {
  ${t} result = ${t}(0.0);
  // The share that is still to be taken from the less detailed levels
  float left = 1.0;
  for (int level = 0; level <= uLastLevel; ++level) {
    float halfExtent = uHalfExtent[level];
    if (halfExtent <= 0.0) continue; // not loaded

    vec2 local = place - uLevelCenter[level];
    float coarser = level == uLastLevel ? 0.0 : getCoarserShare(local, halfExtent, uTexelSize[level]);
    if (coarser >= 1.0) continue;

    result += left * (1.0 - coarser) * ${n};
    left *= coarser;
    if (left <= 0.0) break;
  }
  return result;
}`}var O=`
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
${D(`getHeight`,`float`,`readHeight(local, level)`)}
${D(`getSlope`,`vec3`,`textureLod(uSlopes, getLevelUV(local, level), 0.0).rgb`)}
${D(`getSunlitShare`,`float`,`textureLod(uShadows, getLevelUV(local, level), 0.0).r`)}
`,k=`
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
`,A=`
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
`,j=`
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
`,M=`
out vec2 vUV;

void main() {
  vUV = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(vUV * 2.0 - 1.0, 0.0, 1.0);
}
`,N=`
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
`,te=`
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
`,ne=64,P=`https://mars-tiles.anvaka-git-proxy.workers.dev/mars-gale-v1,https://mars-tiles.anvaka-git-proxy.workers.dev/mars-jezero-v2`.split(`,`).map(e=>e.trim().replace(/\/$/,``)).filter(Boolean),F,I;function re(){return F||=Promise.all(P.map(ae)).then(e=>e.filter(Boolean)),F}function ie(e,t,n){return e.find(e=>{let[r,i,a,o]=e.bounds;return t>r&&t<a&&n>i&&n<o})}function ae(e){return fetch(e+`.json`).then(e=>{if(!e.ok)throw Error(`The server answered `+e.status);return e.json()}).then(e=>L(e.tiles[0],e.bounds,e.minzoom,e.maxzoom)).catch(t=>(console.warn(`Could not load the detailed elevation from `+e,t),null))}function L(e,t,n,r){let i=new Map,[a,o,s,c]=t;return{bounds:t,minZoom:n,maxZoom:r,loadTile:l};function l(t,a,o){if(t<n||t>r||!u(t,a,o))return Promise.resolve(null);let s=t+`/`+a+`/`+o,c=i.get(s);if(i.delete(s),!c){let n=e.replace(`{z}`,t).replace(`{x}`,a).replace(`{y}`,o);c=fetch(n).then(e=>{if(!e.ok)throw Error(`The server answered `+e.status);return e.blob()}).then(e=>createImageBitmap(e,{colorSpaceConversion:`none`,premultiplyAlpha:`none`})).then(oe).catch(e=>(console.warn(`Could not load detailed elevation tile `+s,e),i.delete(s),null))}return i.set(s,c),i.size>ne&&i.delete(i.keys().next().value),c}function u(e,t,n){let r=2**e,i=(t+.5)/r*360-180,l=Math.atan(Math.sinh(Math.PI*(1-2*(n+.5)/r)))*180/Math.PI;return i>a&&i<s&&l>o&&l<c}}function oe(e){if(!I){let e=document.createElement(`canvas`);e.width=e.height=512,I=e.getContext(`2d`,{willReadFrequently:!0}),I.imageSmoothingEnabled=!1}I.clearRect(0,0,512,512),I.drawImage(e,0,0,512,512),e.close&&e.close();let t=I.getImageData(0,0,512,512).data,r=new Float32Array(262144);for(let e=0;e<r.length;++e)r[e]=n(t[e*4],t[e*4+1],t[e*4+2]);return r}var R=3396190,z=Math.PI/180;function se(e,t){let n=e*z,r=Math.sin(t*z),i=Math.cos(t*z);return{longitude:e,latitude:t,project:a,unproject:o};function a(e,t){let a=t*z,o=e*z-n,s=Math.sin(a),c=Math.cos(a),l=Math.cos(o),u=r*s+i*c*l,d=Math.acos(Math.max(-1,Math.min(1,u))),f=d<1e-9?R:R*d/Math.sin(d);return[f*c*Math.sin(o),f*(i*s-r*c*l)]}function o(a,o,s=[0,0]){let c=Math.sqrt(a*a+o*o);if(c<1e-6)return s[0]=e,s[1]=t,s;let l=c/R,u=Math.sin(l),d=Math.cos(l),f=d*r+o*u*i/c,p=Math.asin(Math.max(-1,Math.min(1,f)));return s[0]=ce((n+Math.atan2(a*u,c*i*d-o*r*u))/z),s[1]=p/z,s}}function ce(e){return((e+180)%360+360)%360-180}var le=Math.PI/180,B=2*Math.PI*R,ue=85.0511287798,de=200,fe=9,V=[2,8],H=[{size:1024,texelSize:2.5,isDetailed:!0},{size:1024,texelSize:10,isDetailed:!0},{size:1024,texelSize:40,isDetailed:!0},{size:1024,texelSize:160},{size:512,texelSize:640},{size:512,texelSize:2560}],pe=1024;function me(e,t,n={}){let{size:r,texelSize:a}=H[t],{area:o,getKnownHeight:s}=n,c=n.x||0,l=n.y||0,u=o?512:256,d=o?ye(e.latitude,a,o):be(e.latitude,a),f=o?o.loadTile:i,p=u*2**d,m=2**d,h=r*r,g=new Float64Array(h),_=new Float64Array(h),v=(e.longitude+180)/360*p,y=[0,0],b=1/0,x=-1/0,S=1/0,C=-1/0;for(let t=0;t<r;++t){let n=l+(t+.5-r/2)*a;for(let i=0;i<r;++i){let o=c+(i+.5-r/2)*a;e.unproject(o,n,y);let s=y[0],l=y[1],u=s-e.longitude;u>180&&(u-=360),u<-180&&(u+=360);let d=v+u/360*p,f=xe(l)*p,m=t*r+i;g[m]=d,_[m]=f,d<b&&(b=d),d>x&&(x=d),f<S&&(S=f),f>C&&(C=f)}}let w=Math.floor((b-.5)/u),T=Math.floor((x+.5)/u),E=Math.max(0,Math.floor((S-.5)/u)),ee=Math.min(m-1,Math.floor((C+.5)/u)),D=T-w+1,O=ee-E+1,k=D*u,A=O*u,j=new Float32Array(k*A);o&&j.fill(NaN);let M=[],N=0;for(let e=0;e<O;++e)for(let t=0;t<D;++t){let n=((w+t)%m+m)%m;M.push(f(d,n,E+e).then(n=>{if(n){N+=1;for(let r=0;r<u;++r){let i=r*u;j.set(n.subarray(i,i+u),(e*u+r)*k+t*u)}}}))}return Promise.all(M).then(()=>{let e=new Float32Array(h),n=w*u+.5,i=E*u+.5,o=1/0,d=-1/0;for(let t=0;t<h;++t){let u=U(g[t]-n,0,k-1),f=U(_[t]-i,0,A-1),p=Math.floor(u),m=Math.floor(f),h=Math.min(p+1,k-1),v=Math.min(m+1,A-1),y=u-p,b=f-m,x=j[m*k+p]*(1-y)+j[m*k+h]*y,S=j[v*k+p]*(1-y)+j[v*k+h]*y,C=x*(1-b)+S*b;if(C!==C){let e=t%r,n=(t-e)/r;C=s?s(c+(e+.5-r/2)*a,l+(n+.5-r/2)*a):0}e[t]=C,C<o&&(o=C),C>d&&(d=C)}return{index:t,size:r,texelSize:a,halfExtent:r*a/2,x:c,y:l,heights:e,slopes:_e(e,r,a),min:o,max:d,tilesCount:N}})}function he(e,t,n){let{size:r,heights:i}=e,a=U((t-e.x)/e.texelSize+r/2-.5,0,r-1),o=U((n-e.y)/e.texelSize+r/2-.5,0,r-1),s=Math.floor(a),c=Math.floor(o),l=Math.min(s+1,r-1),u=Math.min(c+1,r-1),d=a-s,f=o-c,p=i[c*r+s]*(1-d)+i[c*r+l]*d,m=i[u*r+s]*(1-d)+i[u*r+l]*d;return p*(1-f)+m*f}function ge(e,t,n){let r=e.halfExtent-24*e.texelSize;return Math.abs(t-e.x)<r&&Math.abs(n-e.y)<r}function _e(e,t,n){let r=ve(e,t,n),i=new Float32Array(t*t*4);for(let a=0;a<t;++a){let o=Math.max(a-1,0),s=Math.min(a+1,t-1);for(let c=0;c<t;++c){let l=Math.max(c-1,0),u=Math.min(c+1,t-1),d=(a*t+c)*4;i[d]=(e[a*t+u]-e[a*t+l])/((u-l)*n),i[d+1]=(e[s*t+c]-e[o*t+c])/((s-o)*n),i[d+2]=r[a*t+c]}}return i}function ve(e,t,n){let r=t+1,i=new Float64Array(r*r);for(let n=0;n<t;++n){let a=0;for(let o=0;o<t;++o)a+=e[n*t+o],i[(n+1)*r+o+1]=i[n*r+o+1]+a}let a=new Float32Array(t*t);return V.forEach(o=>{for(let s=0;s<t;++s){let c=Math.max(s-o,0),l=Math.min(s+o+1,t);for(let u=0;u<t;++u){let d=Math.max(u-o,0),f=Math.min(u+o+1,t),p=(i[l*r+f]-i[c*r+f]-i[l*r+d]+i[c*r+d])/((l-c)*(f-d));a[s*t+u]+=(p-e[s*t+u])/(o*n*V.length)}}}),a}function ye(e,t,n){let r=B*Math.cos(e*le)/(t*1.05);return U(Math.ceil(Math.log2(r/512)),n.minZoom,n.maxZoom)}function be(t,n){let r=Math.max(n,de)*1.05,i=B*Math.cos(t*le)/r;return U(Math.ceil(Math.log2(i/256)),0,Math.min(fe,e()))}function xe(e){let t=U(e,-85.0511287798,ue)*le;return(1-Math.log(Math.tan(t)+1/Math.cos(t))/Math.PI)/2}function U(e,t,n){return e<t?t:e>n?n:e}var W=1024,Se=[{texelSize:.25,isDetailed:!0},{texelSize:2},{texelSize:16},{texelSize:128},{texelSize:1024}],Ce=Math.PI/180,we=59274.7,Te=1.5,Ee=64,De=96,Oe=96,ke=.16,Ae=[1.705,.853,.406],je=.216,Me=Ae.map(e=>e*ke/je),Ne=.5,Pe=128,Fe=24,Ie={address:`https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX1/MapServer/tile/{z}/{y}/{x}`,tileSize:512,minZoom:0,maxZoom:12,isGray:!0,getX:e=>(e+180)/180,getY:e=>(90-e)/180,getLongitude:e=>e*180-180,getLatitude:e=>90-e*180,getPixelSize:e=>180*we/(512*2**e),getTileAddress(e,t,n){let r=2*2**e,i=(t%r+r)%r;return this.address.replace(`{z}`,e).replace(`{x}`,i).replace(`{y}`,n)},hasRow:(e,t)=>t>=0&&t<2**e},Le=[];Object.keys(f).forEach(e=>{f[e].imagery.filter(e=>e.isDetailed).forEach(e=>{Le.push(Qe(e))})});var G=new Map;function Re(e,t,n,r){let i=Se[t],a=ze(e,n,r,i.texelSize,W),[o,s]=e.unproject(n,r),c=Le.find(e=>qe(e.bounds,o,s));return i.isDetailed&&!c?Promise.resolve(null):Promise.all([Je(Ie,a),c?Je(c,a):[],c?Ue(c):{tint:Me,gain:1}]).then(([e,t,i])=>{if(!e.some(e=>e.image)&&!t.some(e=>e.image))return null;let o=Be(a);if(Ye(o,Ie,e,a),Ve(o,i.tint,0),t.some(e=>e.image)){let e=Be(a);Ye(e,c,t,a),Ve(e,[i.gain,i.gain,i.gain],Ne),He(e),o.drawImage(e.canvas,0,0)}return{canvas:o.canvas,x:n,y:r,halfExtent:a.halfExtent}})}function ze(e,t,n,r,i){let a=r*i/2;return{projection:e,x:t,y:n,texelSize:r,size:i,halfExtent:a,box:Ke(e,t,n,a)}}function Be(e){let t=document.createElement(`canvas`);t.width=t.height=e.size;let n=t.getContext(`2d`,{willReadFrequently:!0});return n.imageSmoothingQuality=`high`,n}function Ve(e,t,n){let r=new Float32Array(256);for(let e=0;e<256;++e)r[e]=We(e);let i=2048,a=new Float32Array(2049);for(let e=0;e<=i;++e){let t=e/i*4;a[e]=t>0?(t/ke)**-.4:0}let o=new Uint8ClampedArray(2049);for(let e=0;e<=i;++e)o[e]=Ge(e/i);let{width:s,height:c}=e.canvas,l=e.getImageData(0,0,s,c),u=l.data;for(let e=0;e<u.length;e+=4){if(!u[e+3])continue;let s=r[u[e]]*t[0],c=r[u[e+1]]*t[1],l=r[u[e+2]]*t[2],d=.2126*s+.7152*c+.0722*l;s+=(d*Ae[0]-s)*n,c+=(d*Ae[1]-c)*n,l+=(d*Ae[2]-l)*n;let f=a[Math.min(i,Math.round(d/4*i))]*i;u[e]=o[Math.min(i,Math.round(s*f))],u[e+1]=o[Math.min(i,Math.round(c*f))],u[e+2]=o[Math.min(i,Math.round(l*f))]}e.putImageData(l,0,0)}function He(e){let t=e.canvas.width,n=e.getImageData(0,0,t,t),r=n.data,i=t+1,a=new Uint32Array(i*i),o=!0;for(let e=0;e<t;++e){let n=0;for(let s=0;s<t;++s)r[(e*t+s)*4+3]>127?n+=1:o=!1,a[(e+1)*i+s+1]=a[e*i+s+1]+n}if(!o){for(let e=0;e<t;++e){let n=Math.max(e-Fe,0),o=Math.min(e+Fe+1,t);for(let s=0;s<t;++s){let c=(e*t+s)*4+3;if(!r[c])continue;let l=Math.max(s-Fe,0),u=Math.min(s+Fe+1,t),d=a[o*i+u]-a[n*i+u]-a[o*i+l]+a[n*i+l],f=Math.min(1,Math.max(0,2*d/((o-n)*(u-l))-1));r[c]*=f*f*(3-2*f)}}e.putImageData(n,0,0)}}function Ue(e){if(!e.look){let[t,n,r,i]=e.bounds,a=se((t+r)/2,(n+i)/2),[o,s]=a.project(r,i),c=ze(a,0,0,2*Math.max(o,s)/Pe,Pe);e.look=Promise.all([Je(Ie,c),Je(e,c)]).then(t=>{let[n,r]=[Ie,e].map((e,n)=>{let r=Be(c);return Ye(r,e,t[n],c),r.getImageData(0,0,c.size,c.size).data}),i=[0,0,0],a=0,o=0;for(let e=0;e<n.length;e+=4)if(!(n[e+3]<255||r[e+3]<255)){o+=1,a+=We(n[e]);for(let t=0;t<3;++t)i[t]+=We(r[e+t])}if(!o||!a)return{tint:Me,gain:1};let s=(.2126*i[0]+.7152*i[1]+.0722*i[2])/o,l=Math.min(2,Math.max(.3,ke/s));return{gain:l,tint:i.map((e,t)=>{let n=e/o;return l*(n+(s*Ae[t]-n)*Ne)*o/a})}})}return e.look}function We(e){let t=e/255;return t<=.04045?t/12.92:((t+.055)/1.055)**2.4}function Ge(e){let t=e<=.0031308?e*12.92:1.055*e**(1/2.4)-.055;return Math.round(255*Math.min(1,t))}function Ke(e,t,n,r){let i=e.unproject(t,n)[0],a=1/0,o=1/0,s=-1/0,c=-1/0;for(let l=-2;l<=2;++l)for(let u=-2;u<=2;++u){let[d,f]=e.unproject(t+u*r/2,n+l*r/2),p=i+(d-i+540)%360-180;a=Math.min(a,p),s=Math.max(s,p),o=Math.min(o,f),c=Math.max(c,f)}return[a,o,s,c]}function qe(e,t,n){return t>e[0]&&t<e[2]&&n>e[1]&&n<e[3]}function Je(e,t){let[n,r,i,a]=t.box;if(e.bounds&&(n=Math.max(n,e.bounds[0]),r=Math.max(r,e.bounds[1]),i=Math.min(i,e.bounds[2]),a=Math.min(a,e.bounds[3]),n>=i||r>=a))return Promise.resolve([]);let o=(r+a)/2,s=e.minZoom;for(;s<e.maxZoom&&e.getPixelSize(s,o)>t.texelSize*Te;)s+=1;let c=2**s,l=Math.floor(e.getX(n)*c),u=Math.floor(e.getX(i)*c),d=Math.floor(e.getY(a)*c),f=Math.floor(e.getY(r)*c);if((u-l+1)*(f-d+1)>Ee)return Promise.resolve([]);let p=[];for(let t=d;t<=f;++t)if(e.hasRow(s,t))for(let n=l;n<=u;++n)p.push($e(e.getTileAddress(s,n,t)).then(e=>({zoom:s,x:n,y:t,image:e})));return Promise.all(p)}function Ye(e,t,n,r){n.forEach(n=>{n.image&&Xe(e,t,n,r)}),e.setTransform(1,0,0,1,0,0)}function Xe(e,t,n,r){let i=2**n.zoom,a=t.tileSize,o=t.getPixelSize(n.zoom,r.box[1])*a/r.texelSize,s=Math.max(1,Math.min(8,Math.ceil(o/De))),c=a/s;for(let a=0;a<s;++a)for(let o=0;o<s;++o){let l=Ze(t,r,(n.x+o/s)/i,(n.y+a/s)/i),u=Ze(t,r,(n.x+(o+1)/s)/i,(n.y+a/s)/i),d=Ze(t,r,(n.x+o/s)/i,(n.y+(a+1)/s)/i),f=r.size+Math.abs(u[0]-l[0])+Math.abs(d[1]-l[1]);if(Math.abs(l[0]-r.size/2)>f||Math.abs(l[1]-r.size/2)>f)continue;e.setTransform((u[0]-l[0])/c,(u[1]-l[1])/c,(d[0]-l[0])/c,(d[1]-l[1])/c,l[0],l[1]);let p=.5;e.drawImage(n.image,o*c,a*c,c,c,-.5,-.5,c+2*p,c+2*p)}}function Ze(e,t,n,r){let[i,a]=t.projection.project(e.getLongitude(n),e.getLatitude(r));return[(i-t.x)/t.texelSize+t.size/2,t.size/2-(a-t.y)/t.texelSize]}function Qe(e){return{tileSize:256,minZoom:e.minzoom,maxZoom:e.maxzoom,bounds:e.bounds,isGray:!1,getX:e=>(e+180)/360,getY:e=>{let t=Math.sin(e*Ce);return .5-Math.log((1+t)/(1-t))/(4*Math.PI)},getLongitude:e=>e*360-180,getLatitude:e=>Math.atan(Math.sinh(Math.PI*(1-2*e)))/Ce,getPixelSize:(e,t)=>360*we*Math.cos(t*Ce)/(256*2**e),getTileAddress(t,n,r){let i=2**t-1-r;return e.tiles.replace(`{z}`,t).replace(`{x}`,n).replace(`{y}`,i)},hasRow:(e,t)=>t>=0&&t<2**e}}function $e(e){let t=G.get(e);return G.delete(e),t||=new Promise(t=>{let n=new Image;n.crossOrigin=`anonymous`,n.onload=()=>t(n),n.onerror=()=>{G.delete(e),t(null)},n.src=e}),G.set(e,t),G.size>Oe&&G.delete(G.keys().next().value),t}var et=Math.PI/180,tt=768,nt=.3,rt=4e6,it=2,K=H.length,at=Se.length,ot=16,st=0,ct=1,lt=2,ut=3,dt=4;function ft(e){let t=e.getContext(`webgl2`,{antialias:!0,alpha:!1,depth:!1,powerPreference:`high-performance`});if(!t)throw Error(`Your browser does not support WebGL 2, which is required for the ground view`);let n=!!t.getExtension(`OES_texture_float_linear`),r=ee(n,K,at),i=re(r.terrainVertex,r.terrainFragment),a=re(r.screenVertex,r.skyFragment),o=re(r.screenVertex,r.shadowFragment);[i,o].forEach(I);let s=P(H[K-1]),c=t.createVertexArray(),l=pe;F(st,n?t.LINEAR:t.NEAREST,t.TEXTURE_2D_ARRAY),t.texStorage3D(t.TEXTURE_2D_ARRAY,1,t.R32F,l,l,K),F(ct,t.LINEAR,t.TEXTURE_2D_ARRAY),t.texStorage3D(t.TEXTURE_2D_ARRAY,1,t.RGBA16F,l,l,K);let u=F(lt,t.LINEAR,t.TEXTURE_2D_ARRAY);t.texStorage3D(t.TEXTURE_2D_ARRAY,1,t.R8,l,l,K);let d=t.createFramebuffer(),f=Array(K).fill(null);F(dt,t.LINEAR,t.TEXTURE_2D_ARRAY),t.texParameteri(t.TEXTURE_2D_ARRAY,t.TEXTURE_MIN_FILTER,t.LINEAR_MIPMAP_LINEAR),t.texStorage3D(t.TEXTURE_2D_ARRAY,Math.floor(Math.log2(W))+1,t.SRGB8_ALPHA8,W,W,at);let p=t.getExtension(`EXT_texture_filter_anisotropic`);p&&t.texParameterf(t.TEXTURE_2D_ARRAY,p.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(ot,t.getParameter(p.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));let m=Array(at).fill(null);F(ut,t.LINEAR);let h=[0,1,0];t.texImage2D(t.TEXTURE_2D,0,t.RGBA8,1,1,0,t.RGBA,t.UNSIGNED_BYTE,new Uint8Array(4));let g=[0,0,1],_=[0,0,0,0],v=!0,y=null;return{setLevel:b,clearLevel:x,clearLevels:S,setImagery:C,setSun:w,setColorRamp:T,setPhotoSky(e){_=e?[e[0],e[1],e[2],1]:[0,0,0,0]},render:E,project:te,dispose:ae};function b(e){let{size:n,index:r}=e;f[r]=e,t.activeTexture(t.TEXTURE0+st),t.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,r,n,n,1,t.RED,t.FLOAT,e.heights),t.activeTexture(t.TEXTURE0+ct),t.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,r,n,n,1,t.RGBA,t.FLOAT,e.slopes),v=!0}function x(e){f[e]&&(f[e]=null,v=!0)}function S(){f.fill(null),m.fill(null),v=!0}function C(e,n,r){m[e]=n?r:null,n&&(t.activeTexture(t.TEXTURE0+dt),t.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!0),t.texSubImage3D(t.TEXTURE_2D_ARRAY,0,0,0,e,W,W,1,t.RGBA,t.UNSIGNED_BYTE,n),t.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),t.generateMipmap(t.TEXTURE_2D_ARRAY))}function w(e){g=[e.east,e.north,e.up],v=!0}function T(e){if(!e){h=[0,1,0];return}let n=document.createElement(`canvas`);n.width=512,n.height=1;let r=n.getContext(`2d`),i=e[0].elevation,a=e[e.length-1].elevation,o=r.createLinearGradient(0,0,512,0);e.forEach(e=>{o.addColorStop((e.elevation-i)/(a-i),e.color)}),r.fillStyle=o,r.fillRect(0,0,512,1),t.activeTexture(t.TEXTURE0+ut),t.texImage2D(t.TEXTURE_2D,0,t.RGBA8,t.RGBA,t.UNSIGNED_BYTE,n),h=[i,a,1]}function E(n){ne(),v&&k();let r=y=j(n);t.bindFramebuffer(t.FRAMEBUFFER,null),t.viewport(0,0,e.width,e.height),D(r),f[K-1]&&O(r)}function D(e){t.useProgram(a.id),t.bindVertexArray(c),t.uniform3fv(a.uniform(`uSun`),g),t.uniform3fv(a.uniform(`uForward`),e.forward),t.uniform3fv(a.uniform(`uRight`),mt(e.right,e.tanX)),t.uniform3fv(a.uniform(`uUp`),mt(e.up,e.tanY)),t.uniform4fv(a.uniform(`uPhotoSky`),_),t.drawArrays(t.TRIANGLES,0,3)}function O(e){let{camera:n}=e;t.useProgram(i.id),t.bindVertexArray(s.vertexArray),A(i),t.uniformMatrix4fv(i.uniform(`uViewProjection`),!1,e.viewProjection),t.uniform2f(i.uniform(`uCamera`),n.x,n.y),t.uniform1f(i.uniform(`uAltitude`),n.altitude),t.uniform1f(i.uniform(`uHeading`),n.heading*et),t.uniform1f(i.uniform(`uWedge`),e.wedge),t.uniform3fv(i.uniform(`uSun`),g),t.uniform3fv(i.uniform(`uSunAtCamera`),N(n.x,n.y)),t.uniform3fv(i.uniform(`uColorRampRange`),h),t.uniform1fv(i.uniform(`uImageryHalfExtent`),m.map(e=>e?e.halfExtent:0)),t.uniform2fv(i.uniform(`uImageryCenter`),m.flatMap(e=>e?[e.x,e.y]:[0,0])),t.drawArraysInstanced(t.TRIANGLE_STRIP,0,s.verticesInRing,s.count)}function k(){v=!1;let e=f.reduce((e,t)=>t?Math.max(e,t.max):e,-1/0);t.useProgram(o.id),t.bindVertexArray(c),A(o),t.uniform3fv(o.uniform(`uSun`),g),t.uniform1f(o.uniform(`uHighestPoint`),e),t.bindFramebuffer(t.FRAMEBUFFER,d),f.forEach(e=>{e&&(t.framebufferTextureLayer(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,u,0,e.index),t.viewport(0,0,e.size,e.size),t.uniform1f(o.uniform(`uTargetHalfExtent`),e.halfExtent),t.uniform1f(o.uniform(`uTargetTexelSize`),e.texelSize),t.uniform2f(o.uniform(`uTargetCenter`),e.x,e.y),t.drawArrays(t.TRIANGLES,0,3))}),t.bindFramebuffer(t.FRAMEBUFFER,null)}function A(e){t.uniform1fv(e.uniform(`uHalfExtent`),f.map(e=>e?e.halfExtent:0)),t.uniform1fv(e.uniform(`uTexelSize`),H.map(e=>e.texelSize)),t.uniform1fv(e.uniform(`uLevelSize`),H.map(e=>e.size)),t.uniform1fv(e.uniform(`uLevelShare`),H.map(e=>e.size/pe)),t.uniform2fv(e.uniform(`uLevelCenter`),f.flatMap(e=>e?[e.x,e.y]:[0,0])),t.uniform1i(e.uniform(`uLastLevel`),K-1)}function j(t){let n=t.heading*et,r=t.pitch*et,i=Math.sin(n),a=Math.cos(n),o=Math.sin(r),s=Math.cos(r),c=[i*s,a*s,o],l=[a,-i,0],u=[-i*o,-a*o,s],d=e.width/e.height,f=Math.tan(t.fov*et/2),p=f*d,m=4000000.3/-3999999.7,h=2*rt*nt/-3999999.7;return{camera:t,forward:c,right:l,up:u,tanX:p,tanY:f,viewProjection:new Float32Array([l[0]/p,u[0]/f,-c[0]*m,c[0],l[1]/p,u[1]/f,-c[1]*m,c[1],l[2]/p,u[2]/f,-c[2]*m,c[2],0,0,h,0]),wedge:M(r,p,f)}}function M(e,t,n){if(Math.abs(e)+Math.atan(n)>Math.PI/2-.02)return Math.PI;let r=0;return[-1,1].forEach(i=>{let a=Math.cos(e)-i*n*Math.sin(e);r=Math.max(r,Math.atan2(t,a))}),Math.min(Math.PI,r*1.02+.01)}function N(e,t){let n=Math.sqrt(e*e+t*t);if(n<1)return g;let r=e/n,i=t/n,a=n/R,o=Math.cos(a),s=Math.sin(a),c=g[0]*r+g[1]*i,l=c*o-g[2]*s-c;return[g[0]+r*l,g[1]+i*l,g[2]*o+c*s]}function te(t,n,r){if(!y)return null;let{camera:i,viewProjection:a}=y,o=t-i.x,s=n-i.y,c=Math.sqrt(o*o+s*s),l=c/R,u=c>0?(R+r)*Math.sin(l)/c:0,d=Math.sin(l/2),f=o*u,p=s*u,m=r*Math.cos(l)-2*R*d*d-i.altitude,h=a[3]*f+a[7]*p+a[11]*m;if(h<=nt)return null;let g=(a[0]*f+a[4]*p+a[8]*m)/h,_=(a[1]*f+a[5]*p+a[9]*m)/h;return{x:(g+1)/2*e.clientWidth,y:(1-_)/2*e.clientHeight,distance:Math.sqrt(f*f+p*p+m*m)}}function ne(){let t=Math.min(window.devicePixelRatio||1,it),n=Math.max(1,Math.round(e.clientWidth*t)),r=Math.max(1,Math.round(e.clientHeight*t));(e.width!==n||e.height!==r)&&(e.width=n,e.height=r)}function P(e){let n=pt(e.size*e.texelSize/2),r=new Float32Array((n.length-1)*2);for(let e=n.length-1,t=0;e>0;--e)r[t++]=n[e],r[t++]=n[e-1];let i=new Float32Array(3076);for(let e=0;e<=tt;++e)i.set([e/tt,0,e/tt,1],e*4);let a=t.createVertexArray();t.bindVertexArray(a);let o=t.createBuffer();t.bindBuffer(t.ARRAY_BUFFER,o),t.bufferData(t.ARRAY_BUFFER,i,t.STATIC_DRAW),t.enableVertexAttribArray(0),t.vertexAttribPointer(0,2,t.FLOAT,!1,0,0);let s=t.createBuffer();return t.bindBuffer(t.ARRAY_BUFFER,s),t.bufferData(t.ARRAY_BUFFER,r,t.STATIC_DRAW),t.enableVertexAttribArray(1),t.vertexAttribPointer(1,2,t.FLOAT,!1,0,0),t.vertexAttribDivisor(1,1),t.bindVertexArray(null),{vertexArray:a,verticesInRing:1538,count:n.length-1}}function F(e,n,r=t.TEXTURE_2D){let i=t.createTexture();return t.activeTexture(t.TEXTURE0+e),t.bindTexture(r,i),t.texParameteri(r,t.TEXTURE_MIN_FILTER,n),t.texParameteri(r,t.TEXTURE_MAG_FILTER,n),t.texParameteri(r,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(r,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),i}function I(e){t.useProgram(e.id),t.uniform1i(e.uniform(`uHeights`),st),t.uniform1i(e.uniform(`uSlopes`),ct),t.uniform1i(e.uniform(`uShadows`),lt),t.uniform1i(e.uniform(`uColorRamp`),ut),t.uniform1i(e.uniform(`uImagery`),dt)}function re(e,n){let r=t.createProgram();if(t.attachShader(r,ie(t.VERTEX_SHADER,e)),t.attachShader(r,ie(t.FRAGMENT_SHADER,n)),t.linkProgram(r),!t.getProgramParameter(r,t.LINK_STATUS))throw Error(`Could not link the ground view program: `+t.getProgramInfoLog(r));let i=new Map;return{id:r,uniform(e){return i.has(e)||i.set(e,t.getUniformLocation(r,e)),i.get(e)}}}function ie(e,n){let r=t.createShader(e);if(t.shaderSource(r,n),t.compileShader(r),!t.getShaderParameter(r,t.COMPILE_STATUS))throw Error(`Could not compile the ground view shader: `+t.getShaderInfoLog(r));return r}function ae(){let e=t.getExtension(`WEBGL_lose_context`);e&&e.loseContext()}}function pt(e){let t=[0],n=.5;for(;n<24e3;)t.push(n),n+=Math.min(100,Math.max(.5,n*.01));for(;n<e;)t.push(n),n*=1.0045;return t.push(e),t}function mt(e,t){return[e[0]*t,e[1]*t,e[2]*t]}var ht=Math.PI/180,gt=H.length,_t=H.findIndex(e=>!e.isDetailed),vt=.4,yt=2e4,bt=6,xt=100,St=89,Ct=2e4,wt=2e4,Tt={KeyW:[0,1],ArrowUp:[0,1],KeyS:[0,-1],ArrowDown:[0,-1],KeyA:[-1,0],ArrowLeft:[-1,0],KeyD:[1,0],ArrowRight:[1,0]},Et={KeyE:1,PageUp:1,KeyQ:-1,PageDown:-1};function Dt(e,t){let n=ft(e),r=t.onChange||(()=>{}),i={x:0,y:0,altitude:0,heading:kt(t.heading,0),pitch:q(kt(t.pitch,0),-89,St),fov:60},a=q(kt(t.eyeHeight,2),2,yt),o=Number.isFinite(t.localTime)?t.localTime:null,l=null,u=null,d=0,f=null,p=m(),h=null,g=null;re().then(e=>{g=e,L()});let _=D(),v=0,y=0,b=!1,x=new Set,S=new Map,C=0;ue();let w=setInterval(te,wt),T=new ResizeObserver(L);return T.observe(e),E(t.longitude,q(t.latitude,-82,82)),P(),{setLocalTime:j,setMoment:M,moveTo:N,setEyeHeight:F,setColorStops:I,setPhotoSky:ae,getState:ce,project:le,dispose:U};function E(e,t){let r=se(e,t),i={projection:r,levels:[],isComplete:!1},a=!l;a?l=i:u=i;let o=Promise.resolve();for(let e=gt-1;e>=_t;--e)o=o.then(()=>{if(!s())return d+=1,B(),me(r,e).then(t=>{--d,s()||(i.levels[e]=t,a&&(n.setLevel(t),P(),L()))},e=>{throw--d,e})});o.then(()=>{i.isComplete=!0,!a&&!s()&&ee(i),L()}).catch(e=>{console.error(e),f=`Could not load the terrain: `+(e.message||e),B()});function s(){return b||l!==i&&u!==i}}function ee(e){let[t,r]=l.projection.unproject(i.x,i.y),a=i.heading*ht,o=l.projection.unproject(i.x+Math.sin(a)*1e3,i.y+Math.cos(a)*1e3);l=e,u=null;let[s,c]=l.projection.project(t,r),[d,f]=l.projection.project(o[0],o[1]);i.x=s,i.y=c,i.heading=Math.atan2(d-s,f-c)/ht,n.clearLevels(),l.levels.forEach(e=>n.setLevel(e)),P(),L()}function D(){let e=[];for(let t=_t-1;t>=0;--t){let{size:r,texelSize:i}=H[t];e.push(O({halfExtent:r*i/2,step:i,isReady:()=>!!g&&l.isComplete,isCounted:!0,load(e,n){let[r,i]=l.projection.unproject(e,n),a=ie(g,r,i);return a?me(l.projection,t,{x:e,y:n,area:a,getKnownHeight:(e,n)=>A(e,n,t+1)}):Promise.resolve(null)},show(e){e&&e.tilesCount?(l.levels[t]=e,n.setLevel(e)):(l.levels[t]=void 0,n.clearLevel(t))}}))}return Se.forEach((t,r)=>{e.push(O({halfExtent:t.texelSize*W/2,step:t.texelSize,isReady:()=>!0,load:(e,t)=>Re(l.projection,r,e,t),show:e=>n.setImagery(r,e&&e.canvas,e)}))}),e}function O({halfExtent:e,step:t,isReady:n,isCounted:r,load:a,show:o}){let s=null,c=0,u=0,f=!1;return{update:p};function p(){if(f||!n())return;let p=Math.abs(i.x-c)>e*vt||Math.abs(i.y-u)>e*vt;if(s===l&&!p)return;let m=Math.round(i.x/t)*t,h=Math.round(i.y/t)*t,g=l;f=!0,r&&(d+=1),a(m,h).catch(e=>(console.warn(`Could not load a detailed level of the ground view`,e),null)).then(e=>{f=!1,r&&--d,b||(l===g&&(s=g,c=m,u=h,o(e)),L())})}}function k(){return A(i.x,i.y,0)}function A(e,t,n){for(let r=n;r<gt;++r){let n=l.levels[r];if(n&&ge(n,e,t))return he(n,e,t)}let r=l.levels[gt-1];return r?he(r,e,t):0}function j(e){o=Number.isFinite(e)?e:null,o===null&&(p=m()),P(),L()}function M(e){p=m(e),o=s(p,l.projection.longitude),P(),L()}function N(e,t){let[n,r]=l.projection.project(e,t);i.x=n,i.y=r,z(),L()}function te(){o===null&&(p=m(),P(),L())}function ne(){return o===null?s(p,l.projection.longitude):o}function P(){h=c(l.projection.latitude,p.subsolarLatitude,ne()),n.setSun(h)}function F(e){a=q(kt(e,a),2,yt),L()}function I(e){n.setColorRamp(e),L()}function ae(e){n.setPhotoSky(e),L()}function L(){v||b||(v=requestAnimationFrame(oe))}function oe(e){v=0;let t=R(y?Math.min((e-y)/1e3,.1):0);y=t?e:0,_.forEach(e=>e.update()),i.altitude=k()+a,n.render(i),B(),t&&L()}function R(e){let t=0,n=0,r=0;if(x.forEach(e=>{Tt[e]&&(t+=Tt[e][0],n+=Tt[e][1]),Et[e]&&(r+=Et[e])}),!t&&!n&&!r)return!1;let o=x.has(`ShiftLeft`)||x.has(`ShiftRight`);if(r&&(a=q(a*Math.exp(r*e*(o?3:1.2)),2,yt)),t||n){let r=(100+2*a)*(o?5:1),s=i.heading*ht,c=r*e/Math.sqrt(t*t+n*n);i.x+=(Math.sin(s)*n+Math.cos(s)*t)*c,i.y+=(Math.cos(s)*n-Math.sin(s)*t)*c,z()}return!0}function z(){if(u||!l.isComplete||Math.abs(i.x)<Ct&&Math.abs(i.y)<Ct)return;let[e,t]=l.projection.unproject(i.x,i.y);Math.abs(t)>82||E(e,t)}function ce(){let[t,n]=l.projection.unproject(i.x,i.y);return{longitude:t,latitude:n,elevation:i.altitude-a,eyeHeight:a,heading:(i.heading%360+360)%360,pitch:i.pitch,fov:i.fov,horizontalFov:2*Math.atan(Math.tan(i.fov*ht/2)*e.clientWidth/Math.max(1,e.clientHeight))/ht,localTime:ne(),followsClock:o===null,sunElevation:h?h.elevation:0,sunAzimuth:h?h.azimuth:0,marsTime:p,isLoading:d>0,error:f}}function le(e,t,r){let[i,a]=l.projection.project(e,t);return n.project(i,a,r)}function B(){b||r(ce())}function ue(){e.addEventListener(`pointerdown`,de),e.addEventListener(`pointermove`,fe),e.addEventListener(`pointerup`,V),e.addEventListener(`pointercancel`,V),e.addEventListener(`wheel`,_e,{passive:!1}),window.addEventListener(`keydown`,ye),window.addEventListener(`keyup`,be),window.addEventListener(`blur`,xe)}function de(t){e.setPointerCapture(t.pointerId),S.set(t.pointerId,{x:t.clientX,y:t.clientY}),C=pe()}function fe(t){let n=S.get(t.pointerId);if(!n)return;let r=t.clientX-n.x,a=t.clientY-n.y;if(n.x=t.clientX,n.y=t.clientY,S.size===1){let t=i.fov/e.clientHeight;i.heading-=r*t,i.pitch=q(i.pitch+a*t,-89,St)}else if(S.size===2){let e=pe();C>0&&e>0&&ve(C/e),C=e}L()}function V(e){S.delete(e.pointerId),C=pe()}function pe(){if(S.size!==2)return 0;let[e,t]=Array.from(S.values());return Math.hypot(e.x-t.x,e.y-t.y)}function _e(e){e.preventDefault();let t=e.deltaMode===1?e.deltaY*30:e.deltaY;ve(Math.exp(q(t,-200,200)*.0015)),L()}function ve(e){i.fov=q(i.fov*e,bt,xt)}function ye(e){e.metaKey||e.ctrlKey||e.altKey||Ot(e.target)||(Tt[e.code]||Et[e.code]||e.code.startsWith(`Shift`))&&(x.add(e.code),e.code.startsWith(`Shift`)||e.preventDefault(),L())}function be(e){x.delete(e.code)}function xe(){x.clear()}function U(){b=!0,clearInterval(w),T.disconnect(),cancelAnimationFrame(v),e.removeEventListener(`pointerdown`,de),e.removeEventListener(`pointermove`,fe),e.removeEventListener(`pointerup`,V),e.removeEventListener(`pointercancel`,V),e.removeEventListener(`wheel`,_e),window.removeEventListener(`keydown`,ye),window.removeEventListener(`keyup`,be),window.removeEventListener(`blur`,xe),n.dispose()}}function Ot(e){return e&&/^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName)}function kt(e,t){return Number.isFinite(e)?e:t}function q(e,t,n){return e<t?t:e>n?n:e}var At=1,jt=2;function Mt(e){let t=String(e||``).split(`;`),n=t.filter(e=>e.indexOf(`(`)>=0).map(Nt);if(n.length<4||n.some(e=>e.length!==3||e.some(Number.isNaN)))return null;let[r,i,a,o]=n,s={c:r,a:i,h:a,v:o,o:n[4]||i,r:n[5]||[0,0,0],linearity:1};if(n.length>=7){let e=t.filter(e=>e.indexOf(`(`)<0).map(Number.parseFloat),n=Math.round(e[0]);n===jt?s.linearity=0:n!==At&&Number.isFinite(e[1])&&(s.linearity=e[1])}return s}function Nt(e){return String(e).replace(/[()\s]/g,``).split(`,`).map(Number.parseFloat)}function Pt(e,t,n){let{a:r,h:i,v:a,o,r:s}=e,c=X(Y(Lt(a,X(r,n)),Lt(i,X(r,t))),J(r,Y(a,i))<0?-1:1),l=J(c,o),u=Lt(c,X(o,l)),d=Rt(u),f=d/l;if(!(f>1e-8))return zt(o);let p=f;for(let e=0;e<20;++e){let e=p*p,t=e*e,n=((1+s[0])*p+s[1]*p*e+s[2]*p*t-f)/(1+s[0]+3*s[1]*e+5*s[2]*t);if(p-=n,Math.abs(n)<1e-9)break}let m=p;return e.linearity>1e-6?m=Math.atan(e.linearity*p)/e.linearity:e.linearity<-1e-6&&(m=Math.asin(e.linearity*p)/e.linearity),zt(It(X(u,Math.sin(m)/d),X(o,Math.cos(m))))}function Ft(e,t){let[n,r,i,a]=e,o=[r,i,a],s=X(Y(o,t),2);return It(It(t,X(s,n)),Y(o,s))}function J(e,t){return e[0]*t[0]+e[1]*t[1]+e[2]*t[2]}function Y(e,t){return[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]]}function It(e,t){return[e[0]+t[0],e[1]+t[1],e[2]+t[2]]}function Lt(e,t){return[e[0]-t[0],e[1]-t[1],e[2]-t[2]]}function X(e,t){return[e[0]*t,e[1]*t,e[2]*t]}function Rt(e){return Math.sqrt(J(e,e))}function zt(e){return X(e,1/Rt(e))}var Bt=100,Vt=3,Ht=6e5,Ut=Math.PI/180,Wt=5,Gt=.05,Kt=new URL(`.`,document.baseURI).href+`data/rovers/`,qt={M20:{sensorWidth:5120,sensorHeight:3840,maxFrames:14,minAngleBetweenFrames:40,vignette:[1.369,-.823,.594,0],getUrl(e,t,n){return`https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&num=${Bt}&page=${n}&order=sol+asc&search=NAVCAM_LEFT&condition_2=${e}:sol:gte&condition_3=${t}:sol:lte&extended=sample_type::full`},hasMore(e,t){return(t+1)*Bt<e.total_results},getImages(e){return(e.images||[]).map(e=>{let t=e.extended||{},[n,r]=Nt(t.dimension),i=Number.parseFloat(t.scaleFactor);return{site:Number(e.site),drive:Number(e.drive),sol:e.sol,moment:t.sclk,priority:{NLF:0,NLG:1,NLR:2,NLB:3}[e.imageid.slice(0,3)],rect:t.subframeRect,scaleFactor:i,width:n,height:r,model:e.camera&&e.camera.camera_model_component_list,attitude:e.attitude,url:on(e.image_files||{},i),date:new Date(e.date_taken_utc+`Z`),localTime:e.date_taken_mars,link:e.link}})}},MSL:{sensorWidth:1024,sensorHeight:1024,maxFrames:40,minAngleBetweenFrames:20,vignette:en([.791,.286,-.454]),getUrl(e,t,n){return`https://mars.nasa.gov/api/v1/raw_image_items/?order=sol+asc&per_page=${Bt}&page=${n}&condition_1=msl:mission&condition_2=${e}:sol:gte&condition_3=${t}:sol:lte&search=NAV_LEFT_A%7CNAV_LEFT_B&extended=thumbnail::sample_type::noteq`},hasMore(e){return!!e.more},getImages(e){return(e.items||[]).map(e=>{let t=Nt(e.subframe_rect),n=Number.parseFloat(e.scale_factor)||1;return{site:Number(e.site),drive:Number(e.drive),sol:e.sol,moment:e.spacecraft_clock,priority:/^(full|subframe)$/.test(e.extended&&e.extended.sample_type)?0:void 0,rect:e.subframe_rect,scaleFactor:n,width:t[2]/n,height:t[3]/n,model:e.camera_model_component_list,attitude:e.attitude,url:e.https_url,date:new Date(e.date_taken),localTime:e.extended&&e.extended.lmst,link:`https://mars.nasa.gov`+e.link}})}},MERA:Jt(`MERA-photos.json`,en([1.056,-1.026,.673])),MERB:Jt(`MERB-photos.json`,en([.534,.644,-.644]))};function Jt(e,t){let n;return{sensorWidth:1024,sensorHeight:1024,maxFrames:40,minAngleBetweenFrames:20,vignette:t,loadImages(t){return n||(n=fetch(Kt+e).then(e=>{if(!e.ok)throw Error(`Could not load the list of photos: `+e.status);return e.json()}),n.catch(()=>{n=null})),n.then(e=>{let n=e.places[t.site+`_`+t.drive]||[],r=this.sensorWidth/e.size;return n.map(n=>({site:t.site,drive:t.drive,sol:n.sol,moment:n.time,priority:0,rect:`(1,1,${this.sensorWidth},${this.sensorHeight})`,scaleFactor:r,width:e.size,height:e.size,model:n.camera,attitude:`(1,0,0,0)`,url:e.images+n.file+`.jpg`,date:new Date(n.time),localTime:`M`+n.localTime,link:e.images+n.file+`.jpg`}))})}}}function Yt(e,t){let n=qt[e];if(!n)return Promise.resolve([]);let r=Number.isFinite(t.lastSol)?t.lastSol:t.sol;return(n.loadImages?n.loadImages(t):Zt(n,t.sol,r,0,[])).then(e=>{let r=Qt(e.filter(e=>e.site===t.site&&e.drive===t.drive),n);return r.forEach(e=>{e.seesSun=rn(e,t)}),ln(r,n)})}function Xt(e){return e in qt}function Zt(e,t,n,r,i){return fetch(e.getUrl(t,n,r)).then(e=>{if(!e.ok)throw Error(`NASA did not give the list of photos: `+e.status);return e.json()}).then(a=>{let o=i.concat(e.getImages(a));return e.hasMore(a,r)&&r+1<Vt?Zt(e,t,n,r+1,o):o})}function Qt(e,t){let n=new Map;e.forEach(e=>{if(e.priority===void 0)return;let t=$t(e);if(!t)return;let r=[e.moment,e.priority,e.scaleFactor].join(`/`),i=n.get(r);i||(i={moment:e.moment,priority:e.priority,tiles:new Map,sol:e.sol,date:e.date,localTime:sn(e.localTime),link:e.link},n.set(r,i)),i.tiles.set(e.rect,t)});let r=new Map;return n.forEach(e=>{e.tiles=Array.from(e.tiles.values()),nn(e.tiles),e.tiles.forEach(e=>{e.vignette=t.vignette,e.lens=tn(e,t)}),e.coverage=e.tiles.reduce((e,t)=>e+t.sensorArea,0)/(t.sensorWidth*t.sensorHeight),e.direction=zt(e.tiles.reduce((e,t)=>It(e,t.direction),[0,0,0]));let n=r.get(e.moment);(!n||cn(e,n)<0)&&r.set(e.moment,e)}),Array.from(r.values())}function $t(e){let t=Mt(e.model),n=Nt(e.attitude),r=Nt(e.rect),{width:i,height:a}=e;return t&&n.length===4&&r.length===4&&i>0&&a>0&&e.url&&!Number.isNaN(e.date.getTime())?{url:e.url,width:i,height:a,model:t,attitude:n,rect:r,sensorArea:r[2]*r[3],direction:Z(t,n,i/2,a/2)}:null}function en(e){let[t,n,r]=e;return[t,n,r,t/3+n*7/45+r*3/35]}function tn(e,t){let[n,r,i,a]=e.rect,o=e.width/i,s=e.height/a;return{centerX:(1+t.sensorWidth/2-n)*o,centerY:(1+t.sensorHeight/2-r)*s,radius:Math.hypot(t.sensorWidth,t.sensorHeight)/2*o}}function nn(e){let t=Math.min(...e.map(e=>e.rect[0])),n=Math.min(...e.map(e=>e.rect[1])),r=Math.max(...e.map(e=>e.rect[0]+e.rect[2])),i=Math.max(...e.map(e=>e.rect[1]+e.rect[3]));e.forEach(a=>{let[o,s,c,l]=a.rect,u=a.width/c,d=a.height/l;a.shot={left:(t-o)*u,top:(n-s)*d,width:(r-t)*u,height:(i-n)*d};let f=c*Gt,p=l*Gt,m=(t,n)=>e.find(e=>{let[r,i,o,s]=e.rect;return e!==a&&r<=t&&t<=r+o&&i<=n&&n<=i+s}),h={left:m(o-f,s+l/2),right:m(o+c+f,s+l/2),top:m(o+c/2,s-p),bottom:m(o+c/2,s+l+p)},g=(e,t)=>e?Math.max(0,t(e.rect))/2:0;a.isOuter={left:!h.left,right:!h.right,top:!h.top,bottom:!h.bottom},a.overlap={left:g(h.left,e=>e[0]+e[2]-o)*u,right:g(h.right,e=>o+c-e[0])*u,top:g(h.top,e=>e[1]+e[3]-s)*d,bottom:g(h.bottom,e=>s+l-e[1])*d}})}function rn(e,t){if(!Number.isFinite(t.longitude)||!Number.isFinite(t.latitude))return!1;let n=m(e.date),r=c(t.latitude,n.subsolarLatitude,s(n,t.longitude));if(r.up<0)return!1;let i=[r.north,r.east,-r.up];return e.tiles.some(e=>an(e,i,Math.tan(Wt*Ut)))}function an(e,t,n){let{model:r,attitude:i,width:a,height:o}=e,s=e.direction;if(J(t,s)<=0)return!1;let c=Z(r,i,0,o/2),l=Z(r,i,a,o/2),u=Z(r,i,a/2,0),d=zt(Y(Y(s,Lt(l,c)),s)),f=Y(s,d),p=(e,t)=>J(e,t)/J(e,s),m=p(t,d),h=p(t,f),g=Math.abs(p(l,d)),_=Math.abs(p(u,f));return Math.abs(m)<=g+n&&Math.abs(h)<=_+n}function Z(e,t,n,r){return Ft(t,Pt(e,n,r))}function on(e,t){return t<=1?e.small||e.medium:t<=2?e.medium||e.large:e.large||e.medium}function sn(e){let t=/M(\d+):(\d+):([\d.]+)/.exec(e||``);return t?Number.parseFloat(t[1])+Number.parseFloat(t[2])/60+Number.parseFloat(t[3])/3600:null}function cn(e,t){return Math.round(t.coverage*10)-Math.round(e.coverage*10)||(e.priority===t.priority?e.tiles.length===t.tiles.length?e.date-t.date:e.tiles.length-t.tiles.length:e.priority-t.priority)}function ln(e,t){let n=Math.cos(t.minAngleBetweenFrames*Ut),r=[],i=Math.min(...e.map(e=>e.priority));e=e.filter(e=>e.priority===i);let a=new Set(dn(e));return e.sort((e,t)=>a.has(t)-a.has(e)||cn(e,t)).forEach(e=>{r.length>=t.maxFrames||r.every(t=>J(t.direction,e.direction)<n)&&r.push(e)}),r.sort((e,t)=>un(e)-un(t))}function un(e){return+(e.direction[2]<0)}function dn(e){let t=e.filter(e=>e.coverage>.9).sort((e,t)=>e.date-t.date),n=[],r=[];return t.forEach((e,i)=>{let a=t[i-1];a&&e.date-a.date>Ht&&(r=[]),r.push(e),r.length>n.length&&(n=r)}),n}var fn=Math.PI/180,pn=2,mn=3,hn=8,gn=12,_n=240,vn=.9,yn=2,bn=.01;function xn(e,t){let n=e.map(e=>wn(e,t)),r=new Set,i=[0,1,2].map(t=>Cn(e,n,t,r));return e.map((e,t)=>({gain:i.map(e=>e[t]),isCompared:r.has(t)}))}function Sn(e,t,n){let r=e.map(e=>wn(e,t));return i(6)||i(yn);function i(e){let t=[0,0,0],i=0;return r.forEach((r,a)=>{r.forEach(r=>{if(!(r.elevation<e)){i+=1;for(let e=0;e<3;++e)t[e]+=r.brightness[e]+Math.log(n[a][e])}})}),i<hn?null:t.map(e=>Math.min(1,Math.exp(e/i)/255))}}function Cn(e,t,n,r){let i=[];for(let a=0;a<e.length;++a)for(let o=a+1;o<e.length;++o){let s=e[a].direction[2]<0||e[o].direction[2]<0,c=[];t[a].forEach((e,r)=>{let i=t[o].get(r);!i||s&&e.elevation<yn||c.push(e.brightness[n]-i.brightness[n])}),c.length<hn||(c.sort((e,t)=>e-t),i.push({i:a,j:o,difference:c[c.length>>1],weight:c.length}),r.add(a).add(o))}return Tn(e.length,i).map(Math.exp)}function wn(e,t){let n=new Map;e.tiles.forEach(e=>{let r=t(e);if(!r)return;let{width:i,height:a,pixels:o}=r,[s,c,l,u]=e.vignette||[0,0,0,0];for(let t=0;t<a;++t)for(let r=0;r<i;++r){let d=(t*i+r)*4,f=o[d],p=o[d+1],m=o[d+2];if(Math.min(f,p,m)<gn||Math.max(f,p,m)>_n)continue;let h=(r+.5)/i*e.width,g=(t+.5)/a*e.height,_=Math.hypot(h-e.lens.centerX,g-e.lens.centerY)/e.lens.radius;if(_>vn)continue;let[v,y,b]=Z(e.model,e.attitude,h,g),x=Math.floor(Math.atan2(y,v)/fn/pn),S=Math.floor(-Math.asin(b)/fn/pn),C=x*1e3+S,w=_*_,T=s*w+c*w*w+l*w*w*w-u,E=n.get(C);E||(E={total:[0,0,0],count:0,elevation:S*pn},n.set(C,E)),E.total[0]+=Math.log(f)+T,E.total[1]+=Math.log(p)+T,E.total[2]+=Math.log(m)+T,E.count+=1}});let r=new Map;return n.forEach((e,t)=>{e.count>=mn&&r.set(t,{brightness:e.total.map(t=>t/e.count),elevation:e.elevation})}),r}function Tn(e,t){let n=[];for(let t=0;t<e;++t)n.push(new Float64Array(e+1)),n[t][t]=bn;t.forEach(({i:t,j:r,difference:i,weight:a})=>{n[t][t]+=a,n[r][r]+=a,n[t][r]-=a,n[r][t]-=a,n[t][e]-=a*i,n[r][e]+=a*i});for(let t=0;t<e;++t){let r=t;for(let i=t+1;i<e;++i)Math.abs(n[i][t])>Math.abs(n[r][t])&&(r=i);[n[t],n[r]]=[n[r],n[t]];for(let r=t+1;r<e;++r){let i=n[r][t]/n[t][t];for(let a=t;a<=e;++a)n[r][a]-=i*n[t][a]}}let r=Array(e).fill(0);for(let t=e-1;t>=0;--t){let i=n[t][e];for(let a=t+1;a<e;++a)i-=n[t][a]*r[a];r[t]=i/n[t][t]}return r}var Q=Math.PI/180,En=2,Dn=3,On=.1,kn=2,An=[.86,.95],jn=.9,Mn=64,Nn=3,Pn=1200,Fn=4,In=2,Ln=4,Rn=`https://mars-tiles.anvaka-git-proxy.workers.dev/nasa`.replace(/\/$/,``),zn=/^https?:\/\/mars(?:\.jpl)?\.nasa\.gov\//,Bn=`#version 300 es
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
}`,Vn=`#version 300 es
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
}`,Hn=`#version 300 es
out vec2 place;

void main() {
  // One large triangle that covers the screen
  vec2 corner = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  place = corner * 0.5 + 0.5;
  gl_Position = vec4(corner, 0.0, 1.0);
}`,Un=`#version 300 es
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
}`;function Wn(e){let t=document.createElement(`canvas`);e.appendChild(t);let n=t.getContext(`webgl2`,{alpha:!0,premultipliedAlpha:!0,antialias:!1,depth:!1});if(!n)throw Error(`Your browser does not support WebGL 2, which is required to show the photos`);let r=I(Bn,Vn),i=I(Hn,Un),a=n.createVertexArray(),o={land:P(),sky:P()},s=n.createRenderbuffer(),c=0,l=0,u=document.createElement(`canvas`).getContext(`2d`,{willReadFrequently:!0}),d=[],f=null,p=!1,m={heading:0,pitch:0,fov:60},h=0,g=0,_=!1,v=new ResizeObserver(A);return v.observe(e),{setFrames:y,setCamera:x,getSkyColor:b,isBlackAndWhite:()=>p,dispose:S};function y(e){let t=++g;if(C(),A(),!e.length)return Promise.resolve(0);let n=e.flatMap(e=>e.tiles);return Promise.all(n.map(e=>w(e.url))).then(r=>{if(t!==g||_)return 0;let i=new Map(n.map((e,t)=>[e,r[t]])),a=e.filter(e=>e.tiles.some(e=>i.get(e)));if(!a.length)throw Error(`None of the photos could be loaded`);let{shown:o,gains:s}=T(a,i);d=o.map((e,t)=>D(e,o,s[t],i));let c=e=>E(i.get(e)),l=Sn(o,c,s);return f=l&&l.map(e=>e*jn),p=o.every(e=>e.tiles.every(e=>ee(c(e)))),A(),o.length})}function b(){return f}function x(e,t,n){m={heading:e,pitch:t,fov:n},A()}function S(){_=!0,cancelAnimationFrame(h),v.disconnect(),C(),t.remove();let e=n.getExtension(`WEBGL_lose_context`);e&&e.loseContext()}function C(){f=null,p=!1,d.forEach(e=>e.tiles.forEach(e=>{n.deleteTexture(e.texture),n.deleteVertexArray(e.vertexArray),e.buffers.forEach(e=>n.deleteBuffer(e))})),d=[]}function w(e,t=1){return new Promise(n=>{let r=new Image;r.crossOrigin=`anonymous`,r.onload=()=>n(r),r.onerror=()=>{t>=Nn||_?n(null):setTimeout(()=>n(w(e,t+1)),Pn*t)},r.src=Rn&&zn.test(e)?Rn+`/`+e.replace(zn,``):e})}function T(e,t){let n=e=>E(t.get(e)),r=e;for(;;){let e=xn(r,n),t=r.filter((t,n)=>{let{gain:r,isCompared:i}=e[n];return t.seesSun&&!i?!1:Math.max(...r)<=Fn&&Math.min(...r)>=1/Fn});if(t.length===r.length||!t.length)return{shown:r,gains:e.map(e=>e.gain)};r=t}}function E(e){if(!e)return null;let t=Mn,n=Math.max(1,Math.round(t*e.naturalHeight/e.naturalWidth));return u.canvas.width=t,u.canvas.height=n,u.drawImage(e,0,0,t,n),{width:t,height:n,pixels:u.getImageData(0,0,t,n).data}}function ee(e){if(!e)return!0;let{pixels:t}=e;for(let e=0;e<t.length;e+=4)if(t[e]!==t[e+1]||t[e]!==t[e+2])return!1;return!0}function D(e,t,n,r){let i=e.direction[2]<0,a=Gn(e,t),o=e.tiles[0],s=(e,t)=>Z(o.model,o.attitude,e,t),c=Kn(s(0,o.height/2),s(o.width,o.height/2))*o.shot.width/o.width,l=Kn(s(o.width/2,0),s(o.width/2,o.height))*o.shot.height/o.height,u=On*c,d=(e,t)=>{let n=t-a[e];return 2*(n>0?Math.max(kn,Math.min(u,n/2)):u)/t},f=[d(`left`,c),d(`right`,c),d(`top`,l),d(`bottom`,l)];return i||(f[2]=Math.min(f[2],10/l)),{isSky:i,gain:n.map(e=>e*jn),blur:Math.max(...n)>In?Ln:0,fades:f,tiles:e.tiles.filter(e=>r.get(e)).map(e=>O(e,r.get(e)))}}function O(e,t){let{model:r,attitude:i,width:a,height:o,shot:s,lens:c}=e,l=(e,t)=>Z(r,i,e,t),u=Math.ceil(Kn(l(0,o/2),l(a,o/2))/Dn),d=Math.ceil(Kn(l(a/2,0),l(a/2,o))/Dn),f=[],p=[];for(let e=0;e<=d;++e)for(let t=0;t<=u;++t){let n=a*t/u,r=o*e/d;f.push(...l(n,r)),p.push(n/a,r/o,(n-s.left)/s.width*2-1,(r-s.top)/s.height*2-1)}let m=[];for(let e=0;e<d;++e)for(let t=0;t<u;++t){let n=e*(u+1)+t,r=n+u+1;m.push(n,r,n+1,n+1,r,r+1)}let h=n.createVertexArray();n.bindVertexArray(h);let g=[k(new Float32Array(f),[[`direction`,3]]),k(new Float32Array(p),[[`inTile`,2],[`inShot`,2]])],_=n.createBuffer();n.bindBuffer(n.ELEMENT_ARRAY_BUFFER,_),n.bufferData(n.ELEMENT_ARRAY_BUFFER,new Uint16Array(m),n.STATIC_DRAW),n.bindVertexArray(null);let v=n.createTexture();return n.bindTexture(n.TEXTURE_2D,v),n.texImage2D(n.TEXTURE_2D,0,n.RGBA,n.RGBA,n.UNSIGNED_BYTE,t),n.generateMipmap(n.TEXTURE_2D),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.LINEAR_MIPMAP_LINEAR),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,n.LINEAR),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,n.CLAMP_TO_EDGE),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,n.CLAMP_TO_EDGE),{vertexArray:h,buffers:g.concat(_),texture:v,count:m.length,vignette:e.vignette||[0,0,0,0],lensCenter:[c.centerX/a,c.centerY/o],lensScale:[a/c.radius,o/c.radius]}}function k(e,t){let i=n.createBuffer();n.bindBuffer(n.ARRAY_BUFFER,i),n.bufferData(n.ARRAY_BUFFER,e,n.STATIC_DRAW);let a=t.reduce((e,t)=>e+t[1],0)*4,o=0;return t.forEach(([e,t])=>{let i=n.getAttribLocation(r,e);n.enableVertexAttribArray(i),n.vertexAttribPointer(i,t,n.FLOAT,!1,a,o),o+=t*4}),i}function A(){h||_||(h=requestAnimationFrame(()=>{h=0,j()}))}function j(){e.clientWidth&&e.clientHeight&&(ne(),M(o.land,d.filter(e=>!e.isSky)),M(o.sky,d.filter(e=>e.isSky)),n.bindFramebuffer(n.FRAMEBUFFER,null),n.viewport(0,0,t.width,t.height),n.disable(n.BLEND),n.disable(n.STENCIL_TEST),n.useProgram(i),N(i),F(i,`land`,0,o.land.texture),F(i,`sky`,1,o.sky.texture),n.bindVertexArray(a),n.drawArrays(n.TRIANGLES,0,3))}function M(e,i){if(n.bindFramebuffer(n.FRAMEBUFFER,e.framebuffer),n.viewport(0,0,t.width,t.height),n.disable(n.STENCIL_TEST),n.clearColor(0,0,0,0),n.clearStencil(0),n.clear(n.COLOR_BUFFER_BIT|n.STENCIL_BUFFER_BIT),i.length){n.enable(n.BLEND),n.blendFunc(n.ONE,n.ONE_MINUS_SRC_ALPHA),n.enable(n.STENCIL_TEST),n.stencilOp(n.KEEP,n.KEEP,n.REPLACE),n.useProgram(r),N(r),n.uniform2fv(n.getUniformLocation(r,`cornerFade`),An);for(let e=i.length-1;e>=0;--e){let t=i[e];n.stencilFunc(n.NOTEQUAL,e%255+1,255),n.uniform3fv(n.getUniformLocation(r,`gain`),t.gain),n.uniform1f(n.getUniformLocation(r,`blur`),t.blur),n.uniform4fv(n.getUniformLocation(r,`fades`),t.fades),t.tiles.forEach(e=>{n.uniform4fv(n.getUniformLocation(r,`vignette`),e.vignette),n.uniform2fv(n.getUniformLocation(r,`lensCenter`),e.lensCenter),n.uniform2fv(n.getUniformLocation(r,`lensScale`),e.lensScale),F(r,`photo`,0,e.texture),n.bindVertexArray(e.vertexArray),n.drawElements(n.TRIANGLES,e.count,n.UNSIGNED_SHORT,0)})}}}function N(e){n.uniformMatrix3fv(n.getUniformLocation(e,`view`),!1,te());let r=1/Math.tan(m.fov*Q/2);n.uniform2f(n.getUniformLocation(e,`zoom`),r*t.height/t.width,r)}function te(){let e=Math.sin(m.heading*Q),t=Math.cos(m.heading*Q),n=Math.sin(m.pitch*Q),r=Math.cos(m.pitch*Q);return[-e,-t*n,t*r,t,-e*n,e*r,0,-r,-n]}function ne(){let r=Math.min(window.devicePixelRatio||1,En),i=Math.max(1,Math.round(e.clientWidth*r)),a=Math.max(1,Math.round(e.clientHeight*r));(c!==i||l!==a)&&(t.width=c=i,t.height=l=a,n.bindRenderbuffer(n.RENDERBUFFER,s),n.renderbufferStorage(n.RENDERBUFFER,n.STENCIL_INDEX8,i,a),Object.values(o).forEach(e=>{n.bindTexture(n.TEXTURE_2D,e.texture),n.texImage2D(n.TEXTURE_2D,0,n.RGBA,i,a,0,n.RGBA,n.UNSIGNED_BYTE,null),n.bindFramebuffer(n.FRAMEBUFFER,e.framebuffer),n.framebufferTexture2D(n.FRAMEBUFFER,n.COLOR_ATTACHMENT0,n.TEXTURE_2D,e.texture,0),n.framebufferRenderbuffer(n.FRAMEBUFFER,n.STENCIL_ATTACHMENT,n.RENDERBUFFER,s)}))}function P(){let e=n.createTexture();return n.bindTexture(n.TEXTURE_2D,e),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.NEAREST),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,n.NEAREST),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,n.CLAMP_TO_EDGE),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,n.CLAMP_TO_EDGE),{texture:e,framebuffer:n.createFramebuffer()}}function F(e,t,r,i){n.activeTexture(n.TEXTURE0+r),n.bindTexture(n.TEXTURE_2D,i),n.uniform1i(n.getUniformLocation(e,t),r)}function I(e,t){let r=n.createProgram();if([[n.VERTEX_SHADER,e],[n.FRAGMENT_SHADER,t]].forEach(([e,t])=>{let i=n.createShader(e);if(n.shaderSource(i,t),n.compileShader(i),!n.getShaderParameter(i,n.COMPILE_STATUS))throw Error(`Could not compile a shader of the photos: `+n.getShaderInfoLog(i));n.attachShader(r,i)}),n.linkProgram(r),!n.getProgramParameter(r,n.LINK_STATUS))throw Error(`Could not link a program of the photos: `+n.getProgramInfoLog(r));return r}}function Gn(e,t){let n={left:180,right:180,top:180,bottom:180},[r,i,a]=e.direction,o=Math.atan2(i,r)/Q,s=-Math.asin(a)/Q;return t.forEach(t=>{if(t===e||t.direction[2]>0!=a>0)return;let r=(((Math.atan2(t.direction[1],t.direction[0])/Q-o)%360+540)%360-180)*Math.cos(s*Q),i=-Math.asin(t.direction[2])/Q-s,c=Math.abs(r)>=Math.abs(i)?r>0?`right`:`left`:i>0?`top`:`bottom`;n[c]=Math.min(n[c],Kn(e.direction,t.direction))}),n}function Kn(e,t){let n=e[0]*t[0]+e[1]*t[1]+e[2]*t[2];return Math.acos(Math.max(-1,Math.min(1,n)))/Q}var qn=[`N`,`NE`,`E`,`SE`,`S`,`SW`,`W`,`NW`],Jn=15,$=Math.PI/180,Yn=15,Xn=2,Zn=59274,Qn=2.2,$n=.5,er=35,tr=1.7,nr=[[-.15,-.7],[.55,0],[-.15,.7],[-.6,.7],[.1,0],[-.6,-.7]],rr=4,ir=1,ar=700,or={name:`GroundView`,props:{start:{type:Object,required:!0},theme:{type:String,required:!0}},emits:[`close`,`change`],data(){return{view:null,useMapColors:!1,error:null,stop:null,photos:{count:0,status:``,link:``},photosAreGray:!1,showPhotos:!0,optionsAreOpen:window.innerWidth>ar,sounds:[]}},mounted(){this.onKeyDown=e=>{e.key===`Escape`&&this.close()},window.addEventListener(`keydown`,this.onKeyDown);try{this.scene=Dt(this.$refs.canvas,{...this.start,onChange:e=>{this.view=e,this.photoSphere.setCamera(e.heading,e.pitch,e.fov),this.$emit(`change`,{...e,rover:this.stopAddress})}}),this.photoSphere=Wn(this.$refs.photos),this.start.rover&&this.showRoverStop(this.start.rover)}catch(e){console.error(e),this.error=e.message||String(e)}},beforeUnmount(){window.removeEventListener(`keydown`,this.onKeyDown),this.scene&&this.scene.dispose(),this.photoSphere&&this.photoSphere.dispose()},watch:{start(e){this.scene&&(e.rover?this.showRoverStop(e.rover,!0):this.scene.moveTo(e.longitude,e.latitude))},useMapColors(){this.updateColors()},photosAreVisible(){this.updateSky()},theme(){this.updateColors()}},computed:{stopAddress(){let e=this.stop;return e?{id:e.roverId,site:e.site,drive:e.drive}:null},isAtStop(){if(!this.stop||!this.view)return!1;let{longitude:e,latitude:t,eyeHeight:n}=this.view,r=(t-this.stop.latitude)*Zn,i=(e-this.stop.longitude)*Zn*Math.cos(t*$);return Math.hypot(r,i)<Yn&&n<4},soundsHere(){return this.sounds.filter(e=>e.stop.index===this.stop.index).map(e=>e.sound)},photosAreVisible(){return this.showPhotos&&this.photos.count>0&&this.isAtStop},isGray(){return this.photosAreVisible&&this.photosAreGray},stopArrows(){if(!this.isAtStop)return[];let{next:e,previous:t}=this.stop,n=[];if(e&&n.push(this.getArrow(e,Qn,!1)),t){let r=e&&Math.abs(lr(e.bearing,t.bearing))<er;n.push(this.getArrow(t,Qn*(r?tr:1),!0))}return n.filter(e=>e.points)},place(){let{latitude:e,longitude:t}=this.view;return Math.abs(e).toFixed(4)+`°`+(e<0?`S`:`N`)+` `+Math.abs(t).toFixed(4)+`°`+(t<0?`W`:`E`)},elevation(){return ur(this.view.elevation)},localTime(){return u(this.view.localTime)},eyeHeight(){return dr(this.view.eyeHeight)},eyeHeightPosition(){return Math.log(this.view.eyeHeight/2)/Math.log(yt/2)},sunDescription(){let e=this.view.sunElevation;return e<-.3?`The Sun is below the horizon`:e<.3?`The Sun is at the horizon`:`The Sun is ${Math.round(e)}° above the horizon`},season(){let{marsTime:e,latitude:t}=this.view;return l(e.solarLongitude,t)+` here`},note(){return this.error?{text:this.error}:this.view?this.view.error?{text:this.view.error}:this.view.isLoading?{text:`Loading the land around you...`}:this.view.followsClock&&this.view.sunElevation<-3?{text:`It is night here right now.`,actionText:`See this place at noon`,action:()=>this.scene.setLocalTime(12)}:null:null},compassMarks(){if(!this.view)return[];let{heading:e,horizontalFov:t}=this.view,n=Math.tan(Math.min(t,170)/2*$),r=[];for(let t=0;t<360;t+=Jn){let i=(t-e+540)%360-180;if(Math.abs(i)>85)continue;let a=Math.tan(i*$)/n;Math.abs(a)>1||r.push({angle:t,left:50+50*a+`%`,label:t%45==0?qn[t/45]:``})}return r}},methods:{close(){this.$emit(`close`,this.view)},setLocalTime(e){this.scene.setLocalTime(Number.parseFloat(e.target.value))},followClock(){this.scene.setLocalTime(null)},setEyeHeight(e){let t=Number.parseFloat(e.target.value);this.scene.setEyeHeight(2*(yt/2)**t)},updateColors(){this.scene&&this.scene.setColorStops(this.useMapColors?a(this.theme):null)},updateSky(){this.scene&&this.scene.setPhotoSky(this.photosAreVisible?this.photoSphere.getSkyColor():null)},showRoverStop(e,t){d(e.id).then(n=>{let r=p(n,e.site,e.drive);r&&(this.stop&&this.stop.roverId===n.id&&this.stop.index===r.index||this.setStop(n,r),t&&this.returnToStop())}).catch(e=>{console.error(e),this.photos={count:0,status:`Could not load the route of the rover.`,link:``}})},goToStop(e){this.stop&&d(this.stop.roverId).then(t=>{let n=t.stops[e];n&&(this.setStop(t,n),this.returnToStop())})},returnToStop(){this.scene.moveTo(this.stop.longitude,this.stop.latitude),this.scene.setEyeHeight(Xn)},getArrow(e,t,n){let{heading:r,pitch:i,fov:a,horizontalFov:o,eyeHeight:s}=this.view,c=Math.cos(e.bearing*$),l=Math.sin(e.bearing*$),u=Math.cos(r*$),d=Math.sin(r*$),f=Math.cos(i*$),p=Math.sin(i*$),m=1/Math.tan(Math.min(o,170)/2*$),h=1/Math.tan(a/2*$),g=[];for(let[n,r]of nr){let i=(t+n*$n)*s,a=r*$n*s,o=i*c-a*l,_=i*l+a*c,v=o*u+_*d,y=_*u-o*d,b=-v*p-s*f,x=v*f-s*p;if(x<s*.05)return{index:e.index};g.push((y/x*m).toFixed(4)+`,`+(-b/x*h).toFixed(4))}let _=e.distance<1?`less than a meter away`:dr(e.distance)+` away`;return{index:e.index,isBack:n,title:`${n?`Previous`:`Next`} stop: sol ${e.sol}, ${_}`,points:g.join(` `),outline:g.filter((e,t)=>t!==rr).join(` `)}},setStop(e,t){this.stop={roverId:e.id,roverName:e.name,site:t.site,drive:t.drive,sol:t.sol,index:t.index,total:e.stops.length,longitude:t.longitude,latitude:t.latitude,next:sr(e.stops,t,1),previous:sr(e.stops,t,-1)},this.sounds=e.sounds.map(e=>({sound:e.sound,stop:{index:e.stop.index}})),this.photoSphere.setFrames([]),this.photosAreGray=!1,this.updateSky(),Xt(e.id)?(this.photos={count:0,status:`Looking for the photos taken here...`,link:``},Yt(e.id,t).then(n=>{if(this.stop&&this.stop.index===t.index&&this.stop.roverId===e.id){if(!n.length)this.photos={count:0,status:`The rover did not look around at this stop.`,link:``};else return this.scene.setMoment(n[0].date),this.photoSphere.setFrames(n).then(e=>{e&&(this.photos={count:e,status:``,link:n[0].link},this.photosAreGray=this.photoSphere.isBlackAndWhite()),this.updateSky()})}}).catch(e=>{console.error(e),this.photos={count:0,status:`Could not load the photos from NASA.`,link:``}})):this.photos={count:0,status:`Photos of this rover are not here yet.`,link:``}}}};function sr(e,t,n){let r=e[t.index+n];if(!r)return null;let i=cr(t,r);for(let a=r.index+n;e[a]&&i.distance<ir;a+=n)i=cr(t,e[a]);let a=i.distance>0?i.bearing:n>0?0:180;return{index:r.index,sol:r.sol,distance:cr(t,r).distance,bearing:a}}function cr(e,t){let n=(t.latitude-e.latitude)*Zn,r=(t.longitude-e.longitude)*Zn*Math.cos(e.latitude*$);return{distance:Math.hypot(n,r),bearing:Math.atan2(r,n)/$}}function lr(e,t){return(t-e+540)%360-180}function ur(e){return Math.round(e).toLocaleString(`en-US`)+` m`}function dr(e){return e<1e3?Math.round(e)+` m`:(e/1e3).toFixed(+(e<1e4))+` km`}var fr={class:`ground-view`},pr={ref:`photos`,class:`ground-photos`},mr={key:0,class:`ground-arrows`,viewBox:`-1 -1 2 2`,preserveAspectRatio:`none`},hr=[`onClick`],gr=[`points`],_r=[`points`],vr={class:`ground-compass`},yr={key:0},br=[`title`,`aria-expanded`],xr={class:`place`},Sr={class:`secondary`},Cr={class:`options`},wr={class:`ground-row`},Tr={key:0,class:`secondary`},Er=[`value`],Dr={class:`secondary`},Or={class:`ground-row`},kr=[`value`],Ar={class:`ground-row`},jr={key:1,class:`ground-panel rover-panel`},Mr={class:`place`},Nr={class:`secondary`},Pr={class:`ground-row stops`},Fr={key:0,class:`ground-row`},Ir={for:`ground-photos`},Lr={key:1,class:`secondary`},Rr={key:2,class:`secondary`},zr={key:3,class:`secondary`},Br=[`href`],Vr={class:`secondary`},Hr=[`src`],Ur={class:`secondary`},Wr=[`href`],Gr={key:4,class:`secondary`},Kr={key:2,class:`ground-note`};function qr(e,n,i,a,s,c){return h(),b(`div`,fr,[x(`canvas`,{ref:`canvas`,class:o([`ground-canvas`,{gray:c.isGray}])},null,2),_(x(`div`,pr,null,512),[[g,c.photosAreVisible]]),c.stopArrows.length?(h(),b(`svg`,mr,[(h(!0),b(v,null,E(c.stopArrows,e=>(h(),b(`g`,{key:e.index,class:o([`arrow`,{back:e.isBack}]),onClick:t=>c.goToStop(e.index)},[x(`title`,null,r(e.title),1),x(`polygon`,{class:`hit`,points:e.outline},null,8,gr),x(`polygon`,{points:e.points},null,8,_r)],10,hr))),128))])):y(``,!0),x(`div`,vr,[(h(!0),b(v,null,E(c.compassMarks,e=>(h(),b(`div`,{key:e.angle,class:o([`mark`,{major:e.label}]),style:t({left:e.left})},[e.label?(h(),b(`span`,yr,r(e.label),1)):y(``,!0)],6))),128))]),x(`div`,{class:o([`ground-panel place-panel`,{folded:!s.optionsAreOpen}])},[x(`a`,{href:`#`,class:`ground-back`,onClick:n[0]||=w((...e)=>c.close&&c.close(...e),[`prevent`]),title:`Back to the map (Esc)`},[...n[11]||=[x(`svg`,{viewBox:`0 0 24 24`,width:`18`,height:`18`,fill:`none`,stroke:`currentColor`,"stroke-width":`2`,"stroke-linecap":`round`,"stroke-linejoin":`round`},[x(`path`,{d:`M15 5 L8 12 L15 19`})],-1),S(` Back to the map `,-1)]]),s.view?(h(),b(v,{key:0},[x(`a`,{href:`#`,class:`place-row`,title:s.optionsAreOpen?`Hide the options`:`Show the time of the day and other options`,"aria-expanded":s.optionsAreOpen,onClick:n[1]||=w(e=>s.optionsAreOpen=!s.optionsAreOpen,[`prevent`])},[x(`span`,xr,[S(r(c.place)+` `,1),x(`span`,Sr,[n[12]||=S(`· `,-1),n[13]||=x(`span`,{class:`word`},`elevation `,-1),S(r(c.elevation),1)])]),n[14]||=x(`svg`,{class:`fold`,viewBox:`0 0 24 24`,width:`16`,height:`16`,fill:`none`,stroke:`currentColor`,"stroke-width":`2`,"stroke-linecap":`round`,"stroke-linejoin":`round`},[x(`path`,{d:`M6 9 L12 15 L18 9`})],-1)],8,br),_(x(`div`,Cr,[x(`div`,wr,[n[15]||=x(`label`,{for:`ground-time`},`Local time`,-1),x(`strong`,null,r(c.localTime),1),s.view.followsClock?(h(),b(`span`,Tr,`now`)):(h(),b(`a`,{key:1,href:`#`,onClick:n[2]||=w((...e)=>c.followClock&&c.followClock(...e),[`prevent`])},`back to now`))]),x(`input`,{id:`ground-time`,type:`range`,min:`0`,max:`24`,step:`0.05`,value:s.view.localTime,onInput:n[3]||=(...e)=>c.setLocalTime&&c.setLocalTime(...e)},null,40,Er),x(`div`,Dr,r(c.sunDescription)+` · `+r(c.season),1),x(`div`,Or,[n[16]||=x(`label`,{for:`ground-height`},`Eye height`,-1),x(`strong`,null,r(c.eyeHeight),1)]),x(`input`,{id:`ground-height`,type:`range`,min:`0`,max:`1`,step:`0.001`,value:c.eyeHeightPosition,onInput:n[4]||=(...e)=>c.setEyeHeight&&c.setEyeHeight(...e)},null,40,kr),x(`div`,Ar,[_(x(`input`,{id:`ground-colors`,type:`checkbox`,"onUpdate:modelValue":n[5]||=e=>s.useMapColors=e},null,512),[[C,s.useMapColors]]),n[17]||=x(`label`,{for:`ground-colors`},`Paint with the map colors`,-1)]),n[18]||=x(`div`,{class:`secondary hint`},`Drag to look around, scroll to zoom. Use W A S D keys to move, Q and E to go down and up. Click the small map to go to another place.`,-1),n[19]||=x(`div`,{class:`secondary credit`},`Land from the orbit: NASA/JPL/MSSS/Caltech Murray Lab/Esri, University of Arizona, USGS`,-1)],512),[[g,s.optionsAreOpen]])],64)):y(``,!0)],2),s.stop?(h(),b(`div`,jr,[x(`div`,Mr,[S(r(s.stop.roverName)+` `,1),x(`span`,Nr,`· sol `+r(s.stop.sol)+` · stop `+r(s.stop.index+1)+` of `+r(s.stop.total),1)]),x(`div`,Pr,[x(`a`,{href:`#`,class:o({disabled:s.stop.index===0}),onClick:n[6]||=w(e=>c.goToStop(s.stop.index-1),[`prevent`])},`‹ previous stop`,2),x(`a`,{href:`#`,class:o({disabled:s.stop.index===s.stop.total-1}),onClick:n[7]||=w(e=>c.goToStop(s.stop.index+1),[`prevent`])},`next stop ›`,2)]),s.photos.count?(h(),b(`div`,Fr,[_(x(`input`,{id:`ground-photos`,type:`checkbox`,"onUpdate:modelValue":n[8]||=e=>s.showPhotos=e},null,512),[[C,s.showPhotos]]),x(`label`,Ir,`Show `+r(s.photos.count)+` `+r(s.photos.count===1?`photo`:`photos`)+` taken here`,1)])):y(``,!0),s.photos.status?(h(),b(`div`,Lr,r(s.photos.status),1)):y(``,!0),s.photos.count&&!c.isAtStop?(h(),b(`div`,Rr,[n[20]||=S(` The photos show up only where the rover stood. `,-1),x(`a`,{href:`#`,onClick:n[9]||=w((...e)=>c.returnToStop&&c.returnToStop(...e),[`prevent`])},`Return there`)])):y(``,!0),s.photos.count?(h(),b(`div`,zr,[n[21]||=S(` Photos: `,-1),x(`a`,{href:s.photos.link,target:`_blank`,rel:`noopener`},`NASA/JPL-Caltech`,8,Br),n[22]||=S(`, raw and unprocessed `,-1)])):y(``,!0),(h(!0),b(v,null,E(c.soundsHere,e=>(h(),b(`div`,{class:`sound`,key:e.url},[x(`div`,null,[x(`strong`,null,r(e.title),1),n[23]||=S(),x(`span`,Vr,`· recorded here on sol `+r(e.sol),1)]),x(`audio`,{controls:``,preload:`none`,src:e.url},null,8,Hr),x(`div`,Ur,[S(r(e.description)+` `,1),x(`a`,{href:e.page,target:`_blank`,rel:`noopener`},r(e.credit),9,Wr)])]))),128)),s.sounds.length&&!c.soundsHere.length?(h(),b(`div`,Gr,[...n[24]||=[x(`span`,{class:`note-mark`},`♪`,-1),S(` on the map marks the stops where this rover recorded the sounds of Mars. `,-1)]])):y(``,!0)])):y(``,!0),c.note?(h(),b(`div`,Kr,[S(r(c.note.text)+` `,1),c.note.action?(h(),b(`a`,{key:0,href:`#`,onClick:n[10]||=w((...e)=>c.note.action&&c.note.action(...e),[`prevent`])},r(c.note.actionText),1)):y(``,!0)])):y(``,!0)])}var Jr=T(or,[[`render`,qr]]);export{Jr as default};
//# sourceMappingURL=GroundView-CuC_jIiw.js.map