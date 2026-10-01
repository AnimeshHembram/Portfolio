// ---------------------------------------------------------------------
// Infinite Gallery — texture cache / loader
// ---------------------------------------------------------------------
// Near-verbatim port of edoardolunardi/infinite-canvas's
// src/infinite-canvas/texture-manager.ts (MIT licensed, Codrops). That
// file was already plain Three.js with no React dependency at all, so
// the only changes here are dropping TypeScript types and switching from
// an ES import to reading Three.js off window (see constants.js for why
// this build uses plain classic scripts instead of ES modules).
//
// Purpose: the same media URL can be requested by many planes across
// many chunks. This cache guarantees each URL is only ever fetched once,
// and lets any number of late-arriving planes subscribe to the same
// in-flight load via onLoad callbacks.
(function (global) {
  "use strict";

  var THREE = global.THREE;

  var textureCache = new Map();
  var loadCallbacks = new Map();
  var loader = new THREE.TextureLoader();
  // Three.js defaults loader.crossOrigin to "anonymous", which makes the
  // browser fetch every texture in CORS mode — and a file:// page can
  // never satisfy CORS, so every image load is rejected outright there
  // ("blocked by CORS policy... only supported for ... http, https").
  // Clearing it (undefined, not '') skips setting img.crossOrigin at all,
  // so images load as plain same-directory requests under file:// (how
  // this portfolio is previewed) and behave exactly the same under a
  // real http(s) server, since these placeholders are never loaded
  // cross-domain anyway.
  loader.crossOrigin = undefined;

  function isTextureLoaded(tex) {
    var img = tex.image;
    return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
  }

  /**
   * @param {{url: string}} item
   * @param {(texture: THREE.Texture) => void} [onLoad]
   * @returns {THREE.Texture}
   */
  function getTexture(item, onLoad) {
    var key = item.url;
    var existing = textureCache.get(key);

    if (existing) {
      if (onLoad) {
        if (isTextureLoaded(existing)) {
          onLoad(existing);
        } else {
          var cbs = loadCallbacks.get(key);
          if (cbs) cbs.add(onLoad);
        }
      }
      return existing;
    }

    var callbacks = new Set();
    if (onLoad) callbacks.add(onLoad);
    loadCallbacks.set(key, callbacks);

    var texture = loader.load(
      key,
      function (tex) {
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy = 4;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;

        var cbs = loadCallbacks.get(key);
        if (cbs) {
          cbs.forEach(function (cb) {
            try {
              cb(tex);
            } catch (err) {
              console.error("Infinite Gallery: texture callback failed: " + err);
            }
          });
        }
        loadCallbacks.delete(key);
      },
      undefined,
      function (err) {
        console.error("Infinite Gallery: texture load failed:", key, err);
      }
    );

    textureCache.set(key, texture);
    return texture;
  }

  global.InfiniteGallery.TextureManager = { getTexture: getTexture };
})(window);
