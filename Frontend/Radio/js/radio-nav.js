// ---------------------------------------------------------------------
// Radio — Music section tabs: start-up only
// ---------------------------------------------------------------------
// Starts the Music/M2 GooeyNav (../js/music/gooey-nav.js, unchanged)
// inside #musicNav on radio.html, with exactly the options
// ../js/music/m2-nav.js uses on M2: same items, particle settings,
// timings and colours. The only differences: Radio is the active tab
// here, and Songs opens the M2 page.
//
//   Songs     -> ../m2.html (the Music page, Songs active)
//   My Music  -> as on M2: only the marker moves (nothing behind it yet)
//   Radio     -> this page; choosing it moves the marker back
//
// The global A / H / X control in the top-left corner is separate
// (../js/ab2/nav.js) and has nothing to do with this file.
//
// Not part of the radio itself: the radio is the React app in js/radio.js
// and neither knows about the other. Plain classic script (no
// import/export), like every other script in this portfolio, so it runs
// from file://.
document.addEventListener("DOMContentLoaded", function () {
  var navContainer = document.getElementById("musicNav");
  if (!navContainer || !window.Music || !window.Music.createGooeyNav) return;

  // 2026-10-08: visible labels are now Songs / My Music / Radio (were Songs /
  // My Sounds / FM). Only the text changed; order, indexes and ids are the same.
  var items = [{ label: "Songs" }, { label: "My Music" }, { label: "Radio" }];
  var tabs = ["tab-songs", "tab-my-sounds", "tab-fm"];
  var FM_INDEX = 2;
  var SONGS_URL = "../m2.html";

  var leftForSongs = false;

  var nav = window.Music.createGooeyNav({
    container: navContainer,
    items: items,
    particleCount: 15,
    particleDistances: [90, 10],
    particleR: 100,
    initialActiveIndex: FM_INDEX,
    animationTime: 600,
    timeVariance: 300,
    colors: [1, 2, 3, 1, 2, 3, 1, 4],
    onChange: function (index) {
      if (index === 0) { // Songs
        leftForSongs = true;
        window.location.href = SONGS_URL;
      }
    },
  });

  // Returning from Songs with the browser's Back button can restore this
  // page exactly as it was left, with Songs still marked active: put the
  // marker back on Radio.
  window.addEventListener("pageshow", function (event) {
    if (!event.persisted || !leftForSongs) return;
    leftForSongs = false;
    nav.setActive(FM_INDEX);
  });

  // Same stable ids the links have on the Music page and on M2.
  var links = navContainer.querySelectorAll("nav ul li a");
  links.forEach(function (a, i) {
    if (tabs[i]) a.id = tabs[i];
  });
});
