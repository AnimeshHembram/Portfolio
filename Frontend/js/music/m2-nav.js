// ---------------------------------------------------------------------
// M2 — top navigation bar: start-up only
// ---------------------------------------------------------------------
// Starts the existing GooeyNav (js/music/gooey-nav.js, unchanged) inside
// #musicNav on m2.html, with exactly the options js/music/main.js uses on
// the Music page: same items, particle settings, timings and colours.
//
// What is different from main.js: M2 has no Songs / My Sounds / FM panels
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

  var items = [{ label: "Songs" }, { label: "My Sounds" }, { label: "FM" }];
  var tabs = ["tab-songs", "tab-my-sounds", "tab-fm"];

  window.Music.createGooeyNav({
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
    },
  });

  // Same stable ids main.js gives the links on the Music page.
  var links = navContainer.querySelectorAll("nav ul li a");
  links.forEach(function (a, i) {
    if (tabs[i]) a.id = tabs[i];
  });
});
