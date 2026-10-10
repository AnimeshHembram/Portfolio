// ---------------------------------------------------------------------
// Music — letter navigation (A → H → X)
// ---------------------------------------------------------------------
// The control that replaces the GooeyNav "Songs | My Sounds | FM" bar on
// music.html, m2.html and Radio/radio.html. Same interaction as the AB2
// About page's control (js/ab2/nav.js), written separately so AB2's
// files are not loaded or touched.
//
//   closed : "A"  (hover / keyboard focus shows "H" — CSS only)
//   open   : "X" + the menu
//   choosing an item : switches section, closes, back to "A"
//
// The markup is static in each page (<nav id="musicNav" class="mus-lnav">);
// all visuals are in css/music-letter-nav.css. This file only toggles
// classes/ARIA and reports the choice, through the same onChange(index)
// callback the GooeyNav used — so each page's own section-switching code
// is unchanged. An item's index is its data-index attribute (0 Songs,
// 1 My Sounds, 2 Radio/FM — the same numbering as before), independent
// of the order the items are shown in.
//
// Plain classic script (no import/export), like the rest of this
// portfolio, publishing itself as window.Music.createLetterNav.
(function (global) {
  "use strict";

  /**
   * @param {{
   *   container: HTMLElement,
   *   initialActiveIndex?: number,
   *   onChange?: (index: number) => void
   * }} opts
   * @returns {{ setActive: (index: number) => void, close: () => void } | null}
   */
  function createLetterNav(opts) {
    var nav = opts && opts.container;
    if (!nav) return null;
    var btn = nav.querySelector(".mus-lnav__btn");
    var items = Array.prototype.slice.call(nav.querySelectorAll(".mus-lnav__item"));
    if (!btn || !items.length) return null;

    var active = opts.initialActiveIndex || 0;
    var onChange = typeof opts.onChange === "function" ? opts.onChange : function () {};

    function indexOf(el) { return parseInt(el.getAttribute("data-index"), 10); }

    function paint() {
      items.forEach(function (el) {
        var on = indexOf(el) === active;
        el.classList.toggle("is-current", on);
        if (el.getAttribute("role") === "tab") {
          el.setAttribute("aria-selected", on ? "true" : "false");
        } else if (on) {
          el.setAttribute("aria-current", "true");
        } else {
          el.removeAttribute("aria-current");
        }
      });
    }

    function isOpen() { return nav.classList.contains("is-open"); }

    // rest: hold "A" after closing until the pointer/focus leaves the control
    function setOpen(open, rest, focus) {
      if (open !== isOpen()) {
        nav.classList.toggle("is-open", open);
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        btn.setAttribute("aria-label", open ? "Close music navigation" : "Open music navigation");
      }
      nav.classList.toggle("is-rested", !open && !!rest);
      if (!open && focus) btn.focus();
    }

    btn.addEventListener("click", function () { setOpen(!isOpen(), true, false); });
    btn.addEventListener("pointerleave", function () { nav.classList.remove("is-rested"); });
    btn.addEventListener("blur", function () { nav.classList.remove("is-rested"); });

    items.forEach(function (el) {
      el.addEventListener("click", function () {
        var index = indexOf(el);
        // Close first and hand focus back to the control (the item is about
        // to be hidden), holding "A".
        setOpen(false, true, true);
        if (index === active) return;      // already on this section
        active = index;
        paint();
        onChange(index);
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen()) setOpen(false, true, true);
    });

    document.addEventListener("pointerdown", function (e) {
      if (isOpen() && !nav.contains(e.target)) setOpen(false, false, false);
    });

    // Returning with the browser's Back button: start closed.
    global.addEventListener("pageshow", function (e) {
      if (e.persisted) setOpen(false, false, false);
    });

    paint();

    return {
      setActive: function (index) { active = index; paint(); },
      close: function () { setOpen(false, false, false); },
    };
  }

  global.Music = global.Music || {};
  global.Music.createLetterNav = createLetterNav;
})(window);
