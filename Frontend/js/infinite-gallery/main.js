// ---------------------------------------------------------------------
// Infinite Gallery — entry point
// ---------------------------------------------------------------------
// Wires the generated resource manifest + page UI (loading bar, control
// hints, empty state) to the scene module. The manifest
// (js/infinite-gallery/gallery-manifest.js) is produced by
// Backend/scripts/generate_gallery_manifest.py from whatever real files
// exist under Backend/resources/infinite gallery — this file never
// knows or cares where an entry came from, only its {url, width,
// height, title, ...} shape, which is exactly what
// createInfiniteGalleryScene() already expected in STEP 1.
//
// Plain classic script (no import/export) — see constants.js for why.
// This is the last script in the load order, so window.InfiniteGallery
// is already fully populated by the time this file runs.
var createInfiniteGalleryScene = window.InfiniteGallery.createInfiniteGalleryScene;

// GALLERY_MANIFEST is auto-generated — see gallery-manifest.js's own
// header for how to regenerate it. If it's ever empty (no resources
// added yet, or none of them had a usable representation), this is
// intentionally an empty array, not fake content: the canvas below
// simply has nothing to place, and the empty-state hint (below) is
// shown instead of the control hint.
var GALLERY_MANIFEST = (window.InfiniteGallery && window.InfiniteGallery.GALLERY_MANIFEST) || [];

// Opens the real resource behind a canvas item — called on a short,
// (near-)stationary click/tap on a plane (see scene.js). Never opens
// anything for a drag/pan/zoom gesture.
function openGalleryItem(item) {
  if (!item) return;
  var target = item.type === "github" ? item.link : item.openPath;
  if (!target) return;
  window.open(target, "_blank", "noopener");
}

function getIsTouchDevice() {
  const hasTouchEvent = "ontouchstart" in window;
  const hasTouchPoints = navigator.maxTouchPoints > 0;
  const hasCoarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return hasTouchEvent || hasTouchPoints || hasCoarsePointer;
}

document.addEventListener("DOMContentLoaded", function () {
  const canvas = document.getElementById("infiniteGalleryCanvas");
  if (!canvas) return; // page markup not present — stay safe

  const loaderEl = document.getElementById("igLoader");
  const loaderFillEl = document.getElementById("igLoaderFill");
  const hintEl = document.getElementById("igControlHint");
  const emptyEl = document.getElementById("igEmptyState");

  const isTouchDevice = getIsTouchDevice();
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isEmpty = GALLERY_MANIFEST.length === 0;

  if (hintEl) {
    hintEl.textContent = isTouchDevice ? "Drag to pan · Pinch to zoom" : "Drag to pan · Scroll to zoom · WASD / QE to move";
    hintEl.hidden = isEmpty;
  }
  if (emptyEl) {
    emptyEl.hidden = !isEmpty;
  }

  // Keep the hint in sync if the device's primary pointer type changes
  // (e.g. a 2-in-1 laptop switching between mouse and touch).
  window.matchMedia("(pointer: coarse)").addEventListener("change", function () {
    if (!hintEl) return;
    const touch = getIsTouchDevice();
    hintEl.textContent = touch ? "Drag to pan · Pinch to zoom" : "Drag to pan · Scroll to zoom · WASD / QE to move";
  });

  // Mirrors the reference's PageLoader: a minimum display time so the
  // loading bar never just flashes on a fast/cached load, plus a lerp'd
  // fill so the bar doesn't jump in discrete steps.
  const MIN_VISIBLE_MS = 900;
  const shownAt = performance.now();
  let latestPercent = 0;
  let visualPercent = 0;
  let doneLoading = false;
  let rafId = null;

  function animateLoader() {
    const diff = latestPercent - visualPercent;
    visualPercent += Math.abs(diff) > 0.1 ? diff * 0.12 : diff;
    if (loaderFillEl) loaderFillEl.style.transform = `scaleX(${Math.min(1, Math.max(0, visualPercent / 100))})`;

    const elapsed = performance.now() - shownAt;
    if (doneLoading && visualPercent >= 99 && elapsed >= MIN_VISIBLE_MS) {
      if (loaderEl) loaderEl.classList.add("ig-loader--hidden");
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(animateLoader);
  }
  rafId = requestAnimationFrame(animateLoader);

  try {
    createInfiniteGalleryScene(canvas, {
      media: GALLERY_MANIFEST,
      isTouchDevice,
      reduceMotion,
      onProgress(percent) {
        latestPercent = percent;
      },
      onLoaded() {
        doneLoading = true;
      },
      onItemActivate: openGalleryItem,
    });
  } catch (err) {
    // Most likely cause: WebGL unavailable (old browser, disabled GPU
    // access, etc). Fail visibly with a way back home instead of a blank
    // canvas and a console error.
    console.error("Infinite Gallery: failed to start scene:", err);
    if (rafId) cancelAnimationFrame(rafId);
    if (loaderEl) loaderEl.classList.add("ig-loader--hidden");
    canvas.hidden = true;
    const fallbackEl = document.getElementById("igFallback");
    if (fallbackEl) fallbackEl.hidden = false;
  }
});
