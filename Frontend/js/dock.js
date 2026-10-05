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

// ---------------------------------------------------------------------
// Night-mode hidden dock + hover/focus reveal (Phase 3.3)
// ---------------------------------------------------------------------
// Deliberately a separate, independent IIFE from the magnification code
// above: this state machine has nothing to do with cursor-distance
// sizing, runs unconditionally (including on touch and reduced-motion,
// where it's a harmless no-op — see below), and keeping it isolated
// means neither piece of code can accidentally interfere with the
// other's control flow or early-return paths.
(function () {
  var zone = document.getElementById("dockHoverZone");
  if (!zone) return; // hover-zone markup not present — stay safe

  // This whole feature is CSS-scoped to [data-mode="night"] and
  // @media (hover: hover) (see style.css) — on day mode or a
  // touch/no-hover device, toggling this class never changes anything
  // visible, since no CSS rule there reacts to it. That means this
  // code doesn't need to duplicate that mode/hover-capability check
  // itself; it just always keeps the class in sync with hover/focus
  // state, and the CSS decides whether that has any effect.
  var HIDE_DELAY = 400; // ms — matches the requested reveal-hold behavior
  var hideTimer = null;

  function show() {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
    zone.classList.add("dock-visible");
  }

  function scheduleHide() {
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(function () {
      hideTimer = null;
      // Re-check live state at fire-time rather than trusting the
      // leave event alone — this is what makes a quick leave-then-
      // re-enter (or tabbing from one dock link straight to the next,
      // which fires focusout then focusin) never cause a visible
      // flicker: if the pointer is back inside, or focus is still
      // inside, by the time the timer actually fires, it backs off
      // instead of hiding.
      if (zone.matches(":hover")) return;
      if (zone.contains(document.activeElement)) return;
      zone.classList.remove("dock-visible");
    }, HIDE_DELAY);
  }

  // mouseenter/mouseleave (not mouseover/mouseout) on the zone itself —
  // these fire exactly once on true entry/exit of the zone's own box,
  // never when the cursor moves between children inside it (the empty
  // hotspot area, the dock, individual icons). That's what makes
  // "hotspot to dock" and "between icons" transitions flicker-free by
  // construction, with no extra bookkeeping needed here.
  zone.addEventListener("mouseenter", show);
  zone.addEventListener("mouseleave", scheduleHide);

  // focusin/focusout bubble (unlike focus/blur), so binding them on the
  // zone catches focus moving into or out of any dock link inside it —
  // this is the keyboard-equivalent of hover, so Tabbing through the
  // dock's links keeps it revealed the same way moving the mouse
  // across it does.
  zone.addEventListener("focusin", show);
  zone.addEventListener("focusout", scheduleHide);
})();

// ---------------------------------------------------------------------
// "About Me" dock icon — click + keyboard navigation to ab2.html
// ---------------------------------------------------------------------
// A separate, independent IIFE for the same reason as the two above: this
// has nothing to do with magnification or the night-mode reveal state
// machine, and keeping it isolated means it can't interfere with either.
//
// Scoped to the ONE dock-slot whose data-tooltip is "About Me" — every
// other slot is left exactly as it was (still non-interactive). Since
// dock.js is a single shared file loaded by index.html, day.html AND
// night.html alike, this wiring takes effect everywhere the dock renders
// — there's no separate per-mode copy of the dock to gate it with.
(function () {
  var ABOUT_ME_URL = "ab2.html"; // AB2 is now the official About Me page — about.html kept only as an untouched backup, no longer linked from anywhere

  var slots = Array.prototype.slice.call(
    document.querySelectorAll('.dock-slot[data-tooltip="About Me"]')
  );
  if (!slots.length) return;

  slots.forEach(function (slot) {
    // Was a plain, non-interactive <div> — add just enough for it to act
    // like a real control: keyboard-focusable, announced as a button,
    // and labeled (its only visible text today is a hover-only tooltip).
    slot.setAttribute("tabindex", "0");
    slot.setAttribute("role", "button");
    slot.setAttribute("aria-label", "About Me");
    slot.style.cursor = "pointer";

    function go() {
      window.location.href = ABOUT_ME_URL;
    }

    slot.addEventListener("click", go);
    slot.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault(); // stop Space from also scrolling the page
        go();
      }
    });
  });
})();

// ---------------------------------------------------------------------
// "Gallery" dock icon — click + keyboard navigation to infinite-gallery.html
// ---------------------------------------------------------------------
// Same pattern as the "About Me" block above, targeting the Gallery slot
// instead. Infinite Gallery (STEP 1) is a new, separate page — nothing
// about the dock's markup, styling, or other slots changes here.
(function () {
  var GALLERY_URL = "infinite-gallery.html";

  var slots = Array.prototype.slice.call(
    document.querySelectorAll('.dock-slot[data-tooltip="Gallery"]')
  );
  if (!slots.length) return;

  slots.forEach(function (slot) {
    slot.setAttribute("tabindex", "0");
    slot.setAttribute("role", "button");
    slot.setAttribute("aria-label", "Gallery");
    slot.style.cursor = "pointer";

    function go() {
      window.location.href = GALLERY_URL;
    }

    slot.addEventListener("click", go);
    slot.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        go();
      }
    });
  });
})();

// ---------------------------------------------------------------------
// "Music" dock icon — click + keyboard navigation to m2.html
// ---------------------------------------------------------------------
// Same pattern as the "About Me" and "Gallery" blocks above, targeting
// the Music slot instead. Music (PHASE 1) is a new, separate page —
// nothing about the dock's markup, styling, or other slots changes
// here. Not to be confused with the unrelated "Music On/Off" hotspot on
// the landing page (index.html's .hotspot-music), which toggles
// background ambience and is untouched by this block.
(function () {
  var MUSIC_URL = "m2.html";

  var slots = Array.prototype.slice.call(
    document.querySelectorAll('.dock-slot[data-tooltip="Music"]')
  );
  if (!slots.length) return;

  slots.forEach(function (slot) {
    slot.setAttribute("tabindex", "0");
    slot.setAttribute("role", "button");
    slot.setAttribute("aria-label", "Music");
    slot.style.cursor = "pointer";

    function go() {
      window.location.href = MUSIC_URL;
    }

    slot.addEventListener("click", go);
    slot.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        go();
      }
    });
  });
})();
