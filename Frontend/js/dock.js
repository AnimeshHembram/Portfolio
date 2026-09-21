(function () {
  var dock = document.getElementById("dock");
  if (!dock) return; // dock markup not present — stay safe

  var slots = Array.prototype.slice.call(dock.querySelectorAll(".dock-slot"));
  if (!slots.length) return;

  // Cursor-distance magnification needs both a real pointer (not touch)
  // and a cursor that can actually rest at a specific X position. Touch
  // devices have neither, so we skip all of the JS below and let the
  // CSS-only resting size (set per breakpoint in style.css) stand as
  // the final look — no half-working hover effect that can never fire.
  var canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!canHover || reduceMotion) return;

  // Distance-to-scale falloff, matching the reference dock's own
  // defaults (base 40px, magnified 60px = 1.5x, 140px influence
  // radius) — read as a ratio off each slot's actual CSS width so the
  // effect stays correct at every responsive breakpoint (34px/26px/
  // 20px slots) without this file needing to know those values.
  var MAGNIFY_RATIO = 1.5;
  var INFLUENCE_DISTANCE = 140; // px, screen space — same at every breakpoint

  // Vanilla mass-spring-damper simulation standing in for the
  // reference's spring-based easing library. Every slot eases its
  // current size toward a target size each frame rather than jumping
  // to it, which is what produces the smooth, slightly bouncy feel on
  // both hover-in and hover-out.
  var SPRING_STIFFNESS = 170;
  var SPRING_DAMPING = 12;
  var SPRING_MASS = 0.1;

  var state = slots.map(function (slot) {
    var baseSize = slot.getBoundingClientRect().width;
    return {
      el: slot,
      baseSize: baseSize,
      targetSize: baseSize,
      currentSize: baseSize,
      velocity: 0,
      centerX: 0,
    };
  });

  function readBaseSizes() {
    // Base size can change across a responsive breakpoint (a resize,
    // or a device rotation) — re-read it from CSS each time so the
    // resting size and the magnified target stay in sync with the
    // stylesheet instead of freezing at whatever size loaded first.
    state.forEach(function (s) {
      // Only trust the live rect when not currently mid-animation, so
      // a magnified slot's inflated width isn't mistaken for its new
      // base size.
      if (Math.abs(s.currentSize - s.targetSize) < 0.5) {
        var w = s.el.getBoundingClientRect().width;
        if (w > 0) s.baseSize = w;
      }
    });
  }

  function updateCenters() {
    state.forEach(function (s) {
      var rect = s.el.getBoundingClientRect();
      s.centerX = rect.left + rect.width / 2;
    });
  }

  var dockRect = null;
  function updateDockRect() {
    dockRect = dock.getBoundingClientRect();
  }

  var pointerInsideZone = false;

  function setTargetsFromPointer(mouseX) {
    state.forEach(function (s) {
      var dist = mouseX - s.centerX;
      var abs = Math.abs(dist);
      if (abs >= INFLUENCE_DISTANCE) {
        s.targetSize = s.baseSize;
        return;
      }
      var t = 1 - abs / INFLUENCE_DISTANCE; // 1 at cursor, 0 at edge of influence
      s.targetSize = s.baseSize + (s.baseSize * MAGNIFY_RATIO - s.baseSize) * t;
    });
  }

  function resetTargets() {
    state.forEach(function (s) {
      s.targetSize = s.baseSize;
    });
  }

  window.addEventListener("mousemove", function (e) {
    if (!dockRect) updateDockRect();
    // Cheap pre-check: only bother with per-slot distance math while the
    // cursor is anywhere near the dock's vertical band. Saves work on
    // every mousemove across the rest of the page.
    var nearVertically =
      e.clientY >= dockRect.top - INFLUENCE_DISTANCE &&
      e.clientY <= dockRect.bottom + INFLUENCE_DISTANCE;
    var nearHorizontally =
      e.clientX >= dockRect.left - INFLUENCE_DISTANCE &&
      e.clientX <= dockRect.right + INFLUENCE_DISTANCE;

    if (nearVertically && nearHorizontally) {
      if (!pointerInsideZone) {
        // Just entered the influence zone — refresh geometry in case
        // layout shifted (e.g. a resize) since the last time we cared.
        updateCenters();
        pointerInsideZone = true;
      }
      setTargetsFromPointer(e.clientX);
    } else if (pointerInsideZone) {
      pointerInsideZone = false;
      resetTargets();
    }
  });

  dock.addEventListener("mouseleave", function () {
    pointerInsideZone = false;
    resetTargets();
  });

  window.addEventListener("resize", function () {
    updateDockRect();
    updateCenters();
    readBaseSizes();
  });

  updateDockRect();
  updateCenters();

  // Spring loop — steps every slot's current size toward its target
  // size each frame using a damped-spring integrator, then writes the
  // result as inline width/height (transform-origin: bottom in CSS
  // keeps the growth pointing upward). Runs continuously but the math
  // is trivial for 6-8 slots; pauses while the tab is hidden.
  //
  // Fixed-size sub-stepping: at SPRING_MASS = 0.1, dividing force by
  // mass scales both the stiffness and damping terms up 10x, which
  // makes the semi-implicit Euler integrator numerically unstable at
  // ordinary frame timings — a single per-frame step at ~60fps already
  // sits right at the edge of the stable range, and any normal frame-
  // time jitter (not just tab-switch spikes) pushes it over, so the
  // velocity feedback compounds every frame instead of settling and
  // the slots' sizes diverge to enormous values within a few frames.
  // Splitting each frame's dt into several small fixed sub-steps keeps
  // every individual step's timestep well inside the stable range
  // regardless of the outer frame rate, which is what actually fixes
  // this rather than just re-tuning the constants for one target FPS.
  var MAX_SUBSTEP = 1 / 240;
  var rafId = null;
  var lastTime = null;

  function integrate(s, dt) {
    var displacement = s.targetSize - s.currentSize;
    var springForce = displacement * SPRING_STIFFNESS;
    var dampingForce = -s.velocity * SPRING_DAMPING;
    var acceleration = (springForce + dampingForce) / SPRING_MASS;
    s.velocity += acceleration * dt;
    s.currentSize += s.velocity * dt;
  }

  function step(now) {
    if (lastTime === null) lastTime = now;
    var dt = Math.min((now - lastTime) / 1000, 1 / 30); // clamp for tab-switch spikes
    lastTime = now;

    var substeps = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
    var subDt = dt / substeps;

    state.forEach(function (s) {
      for (var i = 0; i < substeps; i++) {
        integrate(s, subDt);
      }
      // Snap tiny residual motion to the target so the spring actually
      // comes to rest instead of oscillating in sub-pixel amounts forever.
      if (Math.abs(s.targetSize - s.currentSize) < 0.05 && Math.abs(s.velocity) < 0.5) {
        s.currentSize = s.targetSize;
        s.velocity = 0;
      }

      var size = s.currentSize.toFixed(2) + "px";
      s.el.style.width = size;
      s.el.style.height = size;
    });

    rafId = requestAnimationFrame(step);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      lastTime = null;
    } else if (!rafId) {
      rafId = requestAnimationFrame(step);
    }
  });

  rafId = requestAnimationFrame(step);
})();
