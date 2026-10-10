/* =====================================================================
   AB2 — navigation control (A → H → X)
   Used only by ab2.html. Independent of the 3D scripts: it only toggles
   classes on #ab2-nav; all visuals live in css/ab2.css.

     closed  : "A"  (hover / keyboard focus shows "H" — CSS only)
     open    : "X" + menu
   Closing returns to "A" and holds it until the pointer or focus leaves,
   so the control doesn't jump straight back to "H" under the cursor.
   ===================================================================== */
(function () {
  "use strict";

  var nav = document.getElementById("ab2-nav");
  var btn = document.getElementById("ab2-nav-btn");
  if (!nav || !btn) return;

  function isOpen() { return nav.classList.contains("is-open"); }

  function setOpen(open, opts) {
    opts = opts || {};
    if (open === isOpen()) return;
    nav.classList.toggle("is-open", open);
    nav.classList.toggle("is-rested", !open && !opts.silent);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    if (!open && opts.focus) btn.focus();
  }

  btn.addEventListener("click", function () { setOpen(!isOpen()); });

  // Let "H" come back once the pointer or focus has actually left.
  btn.addEventListener("pointerleave", function () { nav.classList.remove("is-rested"); });
  btn.addEventListener("blur", function () { nav.classList.remove("is-rested"); });

  // Escape closes and hands focus back to the control.
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) setOpen(false, { focus: true });
  });

  // A click or tap anywhere else closes it.
  document.addEventListener("pointerdown", function (e) {
    if (isOpen() && !nav.contains(e.target)) setOpen(false, { silent: true });
  });

  // Coming back with the browser's Back button: start closed.
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) setOpen(false, { silent: true });
  });
})();
