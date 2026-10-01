// ---------------------------------------------------------------------
// Infinite Gallery — tunable constants
// ---------------------------------------------------------------------
// Ported (values + intent) from edoardolunardi/infinite-canvas's
// src/infinite-canvas/constants.ts (MIT licensed, Codrops). The numbers
// below are the same defaults that repo shipped with; nothing here is
// specific to React/Three-Fiber, so they carry over unchanged into this
// plain-JS/Three.js build.
//
// Plain classic script (no import/export) — loaded via a normal
// <script src="..."> tag, like every other script in this portfolio, so
// it works identically whether the page is opened over file:// or a real
// server. Publishes its values on window.InfiniteGallery.Constants
// instead of using ES module exports.
(function (global) {
  "use strict";

  var CHUNK_SIZE = 110; // world units per chunk, in every axis

  // RENDER_DISTANCE + CHUNK_FADE_MARGIN together decide how many chunks
  // exist around the camera at once: (2*(RD+FM)+1)^3 chunks, each holding
  // ITEMS_PER_CHUNK planes. At the reference's own desktop defaults
  // (2 + 1 = maxDist 3) that's 7^3 = 343 chunks / ~1,700 planes up front —
  // fine on desktop GPUs, but heavy for a phone GPU under real testing, so
  // this build halves the radius on touch devices (see
  // getChunkRadiusFor below) rather than changing the desktop feel.
  var DESKTOP_RENDER_DISTANCE = 2;
  var DESKTOP_CHUNK_FADE_MARGIN = 1;
  var MOBILE_RENDER_DISTANCE = 1;
  var MOBILE_CHUNK_FADE_MARGIN = 1;

  var MAX_VELOCITY = 3.2;
  var DEPTH_FADE_START = 140; // world units along Z before a plane starts fading with depth
  var DEPTH_FADE_END = 260; // fully invisible beyond this Z distance
  var INVIS_THRESHOLD = 0.01; // opacity below which a plane is hidden outright (perf)
  var KEYBOARD_SPEED = 0.18;
  var VELOCITY_LERP = 0.16;
  var VELOCITY_DECAY = 0.9;
  var INITIAL_CAMERA_Z = 50;

  var ITEMS_PER_CHUNK = 5; // media planes procedurally placed per chunk

  // Camera / renderer defaults (exposed as constants rather than component
  // props, since this build has no prop-passing component tree).
  var CAMERA_FOV = 60;
  var CAMERA_NEAR = 1;
  var CAMERA_FAR = 500;
  var FOG_NEAR = 120;
  var FOG_FAR = 320;
  var BACKGROUND_COLOR = 0x1c1c1c; // matches the portfolio's --ab2-ink
  var FOG_COLOR = 0x1c1c1c;

  /** Picks the render distance / fade margin pair for the current device. */
  function getChunkRadiusFor(isTouchDevice) {
    return isTouchDevice
      ? { renderDistance: MOBILE_RENDER_DISTANCE, chunkFadeMargin: MOBILE_CHUNK_FADE_MARGIN }
      : { renderDistance: DESKTOP_RENDER_DISTANCE, chunkFadeMargin: DESKTOP_CHUNK_FADE_MARGIN };
  }

  /**
   * Builds the list of chunk offsets (dx,dy,dz) within renderDistance +
   * chunkFadeMargin of the camera's current chunk. Computed once per scene
   * instance (via the chosen radius) and reused every chunk-boundary
   * crossing instead of recomputing a triple loop each time.
   */
  function buildChunkOffsets(renderDistance, chunkFadeMargin) {
    var maxDist = renderDistance + chunkFadeMargin;
    var offsets = [];
    for (var dx = -maxDist; dx <= maxDist; dx++) {
      for (var dy = -maxDist; dy <= maxDist; dy++) {
        for (var dz = -maxDist; dz <= maxDist; dz++) {
          var dist = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
          if (dist > maxDist) continue;
          offsets.push({ dx: dx, dy: dy, dz: dz, dist: dist });
        }
      }
    }
    return offsets;
  }

  global.InfiniteGallery = global.InfiniteGallery || {};
  global.InfiniteGallery.Constants = {
    CHUNK_SIZE: CHUNK_SIZE,
    DESKTOP_RENDER_DISTANCE: DESKTOP_RENDER_DISTANCE,
    DESKTOP_CHUNK_FADE_MARGIN: DESKTOP_CHUNK_FADE_MARGIN,
    MOBILE_RENDER_DISTANCE: MOBILE_RENDER_DISTANCE,
    MOBILE_CHUNK_FADE_MARGIN: MOBILE_CHUNK_FADE_MARGIN,
    MAX_VELOCITY: MAX_VELOCITY,
    DEPTH_FADE_START: DEPTH_FADE_START,
    DEPTH_FADE_END: DEPTH_FADE_END,
    INVIS_THRESHOLD: INVIS_THRESHOLD,
    KEYBOARD_SPEED: KEYBOARD_SPEED,
    VELOCITY_LERP: VELOCITY_LERP,
    VELOCITY_DECAY: VELOCITY_DECAY,
    INITIAL_CAMERA_Z: INITIAL_CAMERA_Z,
    ITEMS_PER_CHUNK: ITEMS_PER_CHUNK,
    CAMERA_FOV: CAMERA_FOV,
    CAMERA_NEAR: CAMERA_NEAR,
    CAMERA_FAR: CAMERA_FAR,
    FOG_NEAR: FOG_NEAR,
    FOG_FAR: FOG_FAR,
    BACKGROUND_COLOR: BACKGROUND_COLOR,
    FOG_COLOR: FOG_COLOR,
    getChunkRadiusFor: getChunkRadiusFor,
    buildChunkOffsets: buildChunkOffsets,
  };
})(window);
