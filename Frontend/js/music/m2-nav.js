// ---------------------------------------------------------------------
// M2 — Music section tabs: start-up only
// ---------------------------------------------------------------------
// Starts the existing GooeyNav (js/music/gooey-nav.js, unchanged) inside
// #musicNav on m2.html, with exactly the options js/music/main.js uses on
// the Music page: same items, particle settings, timings and colours.
//
// What is different from main.js: M2 has no Songs / My Music / Radio panels
// and no Songs player, so there is nothing to show or hide when a tab is
// chosen. The tabs still switch their active state with the full Gooey
// animation; the choice is published as an "m2:navchange" event on the
// document (detail: { index, label }) for whatever is connected later.
//
// Plain classic script (no import/export), like every other script in
// this portfolio, so it runs from file://.
document.addEventListener("DOMContentLoaded", function () {
  var navContainer = document.getElementById("musicNav");
  if (!navContainer || !window.Music || !window.Music.createGooeyNav) return;

  // 2026-10-08: visible labels are now Songs / My Music / Radio (were Songs /
  // My Sounds / FM). Only the text changed: the order, the indexes and the
  // ids below (tab-my-sounds, tab-fm) are the same, so nothing that refers
  // to them needs to change.
  var items = [{ label: "Songs" }, { label: "My Music" }, { label: "Radio" }];
  var tabs = ["tab-songs", "tab-my-sounds", "tab-fm"];
  var FM_INDEX = 2; // the Radio tab

  // 2026-10-07 — Radio opens the standalone Radio page. Songs and My Music
  // are unchanged.
  var FM_URL = "Radio/radio.html";

  var leftForRadio = false;

  var nav = window.Music.createGooeyNav({
    container: navContainer,
    items: items,
    particleCount: 15,
    particleDistances: [90, 10],
    particleR: 100,
    initialActiveIndex: 0,
    animationTime: 600,
    timeVariance: 300,
    colors: [1, 2, 3, 1, 2, 3, 1, 4],
    onChange: function (index) {
      document.dispatchEvent(
        new CustomEvent("m2:navchange", {
          detail: { index: index, label: items[index].label },
        })
      );
      if (index === FM_INDEX) {
        leftForRadio = true;
        window.location.href = FM_URL;
      }
    },
  });

  // Returning from the Radio with the browser's Back button can restore
  // this page exactly as it was left, with Radio still marked active (and so
  // not clickable again): put the marker back on Songs.
  window.addEventListener("pageshow", function (event) {
    if (!event.persisted || !leftForRadio) return;
    leftForRadio = false;
    nav.setActive(0);
  });

  // Same stable ids main.js gives the links on the Music page.
  var links = navContainer.querySelectorAll("nav ul li a");
  links.forEach(function (a, i) {
    if (tabs[i]) a.id = tabs[i];
  });
});
