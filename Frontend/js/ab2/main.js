/* =====================================================================
   AB2 — boot, mode switching, scroll & pointer input
   Used only by ab2.html.

   Modes
     3D   : WebGL available and reduced motion NOT requested (default).
     flat : no WebGL, reduced motion, 3D failed, or the visitor chose "2D view".
   Test overrides: ?view=flat  or  ?view=3d  (3d still needs WebGL).

   Only dependency: three.js (MIT), loaded on demand from jsDelivr as an ES
   module, so flat-mode visitors never download it. Scrolling is native
   (smoothed here with a few lines of easing) — Lenis wasn't needed.
   ===================================================================== */
(function () {
  "use strict";

  var THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.module.min.js";

  var AB2 = (window.AB2 = window.AB2 || {});
  var root = document.documentElement;
  clearTimeout(window.__ab2Failsafe);

  var host = document.getElementById("ab2-host");
  var page = document.getElementById("ab2-page");
  var stage = document.getElementById("ab2-stage");
  var toggle = document.getElementById("ab2-toggle");

  var params = new URLSearchParams(location.search);
  var forced = params.get("view");
  var reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
  // Mouse parallax is off: at rest the 3D view must look exactly like the
  // approved flat composition. Set to true to re-enable the camera nudge.
  var PARALLAX = false;
  var finePointer = PARALLAX && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  var scene = null;
  var starting = null;
  var mode = null;
  var scrollTarget = 0;
  var pointerTarget = { x: 0, y: 0 };

  function hasWebGL() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
    } catch (e) {
      return false;
    }
  }

  var webgl = hasWebGL();

  function setToggle() {
    toggle.hidden = !webgl;
    toggle.textContent = mode === "3d" ? "2D view" : "3D view";
    toggle.title = mode === "3d" ? "Switch to the flat, static layout" : "Switch to the interactive 3D view";
  }

  // ---------- Flat ----------
  function enterFlat(reason) {
    if (reason) console.info("[AB2] Flat layout:", reason);
    mode = "flat";
    if (scene) scene.stop();
    root.classList.remove("ab2-3d", "ab2-ready");
    root.classList.add("ab2-flat");
    window.scrollTo(0, 0);
    setToggle();
  }

  // ---------- 3D ----------
  function readScroll() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    scrollTarget = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  }

  function beforeFrame(dt) {
    // Frame-rate independent easing toward the latest inputs.
    var k = 1 - Math.exp(-dt * 5);
    scene.progress += (scrollTarget - scene.progress) * k;
    if (Math.abs(scrollTarget - scene.progress) < 1e-4) scene.progress = scrollTarget;
    var kp = 1 - Math.exp(-dt * 4);
    // Parallax only near the rest pose so it doesn't fight the scroll path.
    var near = 1 - Math.min(1, Math.min(scene.progress, 1 - scene.progress) * 8);
    var tx = pointerTarget.x * near, ty = pointerTarget.y * near;
    scene.pointer.x += (tx - scene.pointer.x) * kp;
    scene.pointer.y += (ty - scene.pointer.y) * kp;
    if (Math.abs(tx - scene.pointer.x) < 1e-4) scene.pointer.x = tx;
    if (Math.abs(ty - scene.pointer.y) < 1e-4) scene.pointer.y = ty;
  }

  function enter3D() {
    if (!webgl) return enterFlat("WebGL unavailable");
    mode = "3d";
    root.classList.remove("ab2-flat", "ab2-ready");
    root.classList.add("ab2-3d");
    window.scrollTo(0, 0);
    scrollTarget = 0;
    setToggle();

    if (scene) {
      // Returning from flat view: layout may have changed while hidden.
      scene.progress = 0;
      return scene.relayout().then(function () {
        root.classList.add("ab2-ready");
        scene.skipIntro();
        scene.start();
      }).catch(fail);
    }
    if (starting) return starting;

    starting = import(THREE_URL)
      .then(function (THREE) {
        var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
        // Make sure the heavy weights are loaded before measuring glyphs.
        var loads = document.fonts && document.fonts.load
          ? Promise.all([
              document.fonts.load('800 64px "Inter"'),
              document.fonts.load('600 16px "Inter"'),
              document.fonts.load('500 16px "Inter"')
            ]).catch(function () {})
          : Promise.resolve();
        return Promise.all([ready, loads]).then(function () { return THREE; });
      })
      .then(function (THREE) {
        scene = new AB2.Scene(THREE, { host: host, page: page, stage: stage, onLost: fail });
        scene.beforeFrame = beforeFrame;
        return scene.init();
      })
      .then(function () {
        if (mode !== "3d") return; // visitor switched away while loading
        root.classList.add("ab2-ready");
        if (reduceMq.matches) scene.skipIntro();
        else scene.playIntro();
        scene.start();
      })
      .catch(fail)
      .then(function () { starting = null; });
    return starting;
  }

  function fail(err) {
    console.warn("[AB2] 3D view unavailable, showing flat layout.", err);
    webgl = webgl && !(err && /taint|security/i.test(String(err && (err.name + err.message))));
    enterFlat();
  }

  // ---------- Events ----------
  toggle.addEventListener("click", function () {
    if (mode === "3d") enterFlat();
    else enter3D();
  });

  window.addEventListener("scroll", function () {
    if (mode === "3d") readScroll();
  }, { passive: true });

  if (finePointer) {
    window.addEventListener("pointermove", function (e) {
      if (mode !== "3d") return;
      pointerTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointerTarget.y = -((e.clientY / window.innerHeight) * 2 - 1);
    }, { passive: true });
    document.addEventListener("pointerleave", function () {
      pointerTarget.x = 0;
      pointerTarget.y = 0;
    });
  }

  // Re-measure only when the parked page actually changed size (mobile
  // browser toolbars fire lots of resize events that don't affect 100lvh).
  var resizeTimer = 0;
  var lastW = 0, lastH = 0;
  window.addEventListener("resize", function () {
    if (mode !== "3d" || !scene) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var r = host.getBoundingClientRect();
      if (Math.abs(r.width - lastW) < 1 && Math.abs(r.height - lastH) < 1) return;
      lastW = r.width; lastH = r.height;
      scene.relayout().catch(fail);
      readScroll();
    }, 180);
  });

  document.addEventListener("visibilitychange", function () {
    if (!scene || mode !== "3d") return;
    if (document.hidden) scene.stop();
    else scene.start();
  });

  // ---------- Boot ----------
  if (forced === "flat") enterFlat("?view=flat");
  else if (forced === "3d") enter3D();
  else if (reduceMq.matches) enterFlat("prefers-reduced-motion");
  else if (!webgl) enterFlat("WebGL unavailable");
  else enter3D();

  AB2.debug = function () {
    return { mode: mode, webgl: webgl, scene: scene };
  };
})();
