// ---------------------------------------------------------------------
// Music — entry point (Phase 1: frontend only)
// ---------------------------------------------------------------------
// Wires the GooeyNav switcher to the three placeholder panels (Songs /
// My Sounds / FM). Nothing here talks to a music-selection algorithm,
// an FM/location algorithm, or the Backend resource system — those are
// Phase 2 and Phase 3. Swapping in real behavior later means replacing
// what's inside each panel and/or what onChange does below; the nav
// itself and the page shell don't need to change.
//
// Plain classic script (no import/export) — see gooey-nav.js for why.
document.addEventListener("DOMContentLoaded", function () {
  var navContainer = document.getElementById("musicNav");
  if (!navContainer || !window.Music || !window.Music.createGooeyNav) return;

  var panels = [
    document.getElementById("panel-songs"),
    document.getElementById("panel-my-sounds"),
    document.getElementById("panel-fm"),
  ];
  var tabs = ["tab-songs", "tab-my-sounds", "tab-fm"];

  function showPanel(index) {
    panels.forEach(function (panel, i) {
      if (!panel) return;
      panel.hidden = i !== index;
    });
  }

  showPanel(0);

  window.Music.createGooeyNav({
    container: navContainer,
    items: [{ label: "Songs" }, { label: "My Sounds" }, { label: "FM" }],
    particleCount: 15,
    particleDistances: [90, 10],
    particleR: 100,
    initialActiveIndex: 0,
    animationTime: 600,
    timeVariance: 300,
    colors: [1, 2, 3, 1, 2, 3, 1, 4],
    onChange: function (index) {
      showPanel(index);
    },
  });

  // Give each <li><a> a stable id matching its panel's aria-labelledby,
  // for screen readers — done here rather than inside gooey-nav.js so
  // the nav module stays generic/reusable and doesn't need to know
  // about "tab-songs" etc.
  var links = navContainer.querySelectorAll("nav ul li a");
  links.forEach(function (a, i) {
    if (tabs[i]) a.id = tabs[i];
  });

  // ---- Songs: Cassette Player ------------------------------------------
  // Reference assets stay where they already are (assets/New folder/
  // CassettePlayer/…) rather than being copied — the space in "New
  // folder" just needs URL-encoding for file:// to resolve it. The four
  // songs listed are the demo tracks bundled with the reference
  // implementation (temporary placeholder — see the note printed under
  // the player in music.html); swapping in the real library later is a
  // matter of changing this options object, not this file's logic.
  var vcContainer = document.getElementById("vc-container");
  if (vcContainer && window.Music && window.Music.createCassettePlayer) {
    var CASSETTE_BASE = "assets/New%20folder/CassettePlayer/";
    window.Music.createCassettePlayer(vcContainer, {
      songs: [
        "BlueDucks_FourFlossFiveSix",
        "BlankKytt_ThursdaySnowReprise",
        "BlueDucks_FlossSuffersFromGammaRadiation",
        "BlankKyt_RSPN",
      ],
      songsBasePath: CASSETTE_BASE + "songs/",
      soundsBasePath: CASSETTE_BASE + "sounds/",
      initialVolume: 0.7,
    });
  }

  // The cassette widget's CSS (adapted from the reference's own
  // style.css/knobKnob.css) assumes its original ~672px-wide layout —
  // that's what the tape, control bar and volume-knob offsets are all
  // measured against, and reflowing that at narrow widths would distort
  // the design the user asked to preserve. So .mus-cassette__stage keeps
  // its natural size and is scaled down as a whole (never up) to fit
  // whatever width the Songs panel actually has, instead of being
  // redesigned to be "responsive" — no horizontal overflow, no
  // distortion, same proportions at every size.
  var stage = document.querySelector(".mus-cassette__stage");
  var stageOuter = document.querySelector(".mus-cassette");
  if (stage && stageOuter && "ResizeObserver" in window) {
    var naturalWidth = 0;
    var naturalHeight = 0;

    function measureNatural() {
      // Measure unscaled: momentarily clear the transform so
      // getBoundingClientRect reports the stage's true natural size,
      // not whatever it was last scaled to.
      var prevTransform = stage.style.transform;
      stage.style.transform = "none";
      naturalWidth = stage.offsetWidth;
      naturalHeight = stage.offsetHeight;
      stage.style.transform = prevTransform;
    }

    function applyScale() {
      if (!naturalWidth) measureNatural();
      if (!naturalWidth) return;

      var available = stageOuter.clientWidth;
      var scale = Math.min(1, available / naturalWidth);

      stage.style.transform = "scale(" + scale + ")";
      stageOuter.style.height = Math.ceil(naturalHeight * scale) + "px";
    }

    measureNatural();
    applyScale();

    new ResizeObserver(applyScale).observe(stageOuter);
  }
});
