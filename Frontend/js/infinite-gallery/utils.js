// ---------------------------------------------------------------------
// Infinite Gallery — math + chunk-generation helpers
// ---------------------------------------------------------------------
// Ported from edoardolunardi/infinite-canvas's top-level src/utils.ts and
// src/infinite-canvas/utils.ts (MIT licensed, Codrops). Both were already
// framework-agnostic (no React/Three-Fiber imports), so the logic here is
// effectively unchanged — only the TypeScript types were dropped and the
// two source files were merged into one, since this build doesn't need
// them split across a component tree.
//
// Plain classic script (no import/export) — see constants.js for why.
// Reads Three.js and the constants module off window, and publishes
// itself on window.InfiniteGallery.Utils.
(function (global) {
  "use strict";

  var THREE = global.THREE;
  var C = global.InfiniteGallery.Constants;
  var CHUNK_SIZE = C.CHUNK_SIZE;
  var ITEMS_PER_CHUNK = C.ITEMS_PER_CHUNK;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // Deterministic string -> 32bit int hash (djb2 variant), used so a given
  // chunk coordinate always seeds the same pseudo-random layout.
  function hashString(str) {
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
      hash = (hash * 33) ^ str.charCodeAt(i);
    }
    return hash >>> 0;
  }

  // Mulberry32 seeded PRNG — small, fast, good enough distribution for
  // placing planes. Same seed always produces the same output.
  function seededRandom(seed) {
    var t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ---- chunk plane generation (with an LRU-ish cache) ------------------

  var MAX_PLANE_CACHE = 256;
  var planeCache = new Map();

  function touchPlaneCache(key) {
    var v = planeCache.get(key);
    if (!v) return;
    planeCache.delete(key);
    planeCache.set(key, v);
  }

  function evictPlaneCache() {
    while (planeCache.size > MAX_PLANE_CACHE) {
      var firstKey = planeCache.keys().next().value;
      if (firstKey === undefined) break;
      planeCache.delete(firstKey);
    }
  }

  function getChunkUpdateThrottleMs(isZooming, zoomSpeed) {
    if (zoomSpeed > 1.0) return 500;
    if (isZooming) return 400;
    return 100;
  }

  function generateChunkPlanes(cx, cy, cz) {
    var planes = [];
    var seed = hashString(cx + "," + cy + "," + cz);

    for (var i = 0; i < ITEMS_PER_CHUNK; i++) {
      var s = seed + i * 1000;
      var r = (function (s) {
        return function (n) {
          return seededRandom(s + n);
        };
      })(s);
      var size = 12 + r(4) * 8;

      planes.push({
        id: cx + "-" + cy + "-" + cz + "-" + i,
        position: new THREE.Vector3(
          cx * CHUNK_SIZE + r(0) * CHUNK_SIZE,
          cy * CHUNK_SIZE + r(1) * CHUNK_SIZE,
          cz * CHUNK_SIZE + r(2) * CHUNK_SIZE
        ),
        scale: new THREE.Vector3(size, size, 1),
        mediaIndex: Math.floor(r(5) * 1000000),
      });
    }

    return planes;
  }

  function generateChunkPlanesCached(cx, cy, cz) {
    var key = cx + "," + cy + "," + cz;
    var cached = planeCache.get(key);
    if (cached) {
      touchPlaneCache(key);
      return cached;
    }

    var planes = generateChunkPlanes(cx, cy, cz);
    planeCache.set(key, planes);
    evictPlaneCache();
    return planes;
  }

  function shouldThrottleUpdate(lastUpdateTime, throttleMs, currentTime) {
    return currentTime - lastUpdateTime >= throttleMs;
  }

  global.InfiniteGallery.Utils = {
    clamp: clamp,
    lerp: lerp,
    hashString: hashString,
    seededRandom: seededRandom,
    generateChunkPlanes: generateChunkPlanes,
    generateChunkPlanesCached: generateChunkPlanesCached,
    getChunkUpdateThrottleMs: getChunkUpdateThrottleMs,
    shouldThrottleUpdate: shouldThrottleUpdate,
  };
})(window);
