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

  // ---- Songs: player ------------------------------------------------------
  // Reference assets stay where they already are (assets/New folder/
  // CassettePlayer/songs/…) rather than being copied — the space in "New
  // folder" just needs URL-encoding for file:// to resolve it. These four
  // tracks are the same temporary placeholders the earlier CassettePlayer
  // used (see the note printed under the player in music.html), just
  // reshaped into the { title, artist, albumArt, audio } objects
  // songs-player.js expects — that shape is exactly what
  // Backend/resources/music is meant to hand this later (Phase 2/3), so
  // swapping in the real library means changing this array, not this
  // file's logic or songs-player.js itself. albumArt is a single shared
  // placeholder SVG since no real artwork exists yet either.
  var songsPlayerEl = document.getElementById("songsPlayer");
  if (songsPlayerEl && window.Music && window.Music.createSongsPlayer) {
    var CASSETTE_SONGS_BASE = "assets/New%20folder/CassettePlayer/songs/";
    var PLACEHOLDER_ART = "assets/music/placeholder-cover.svg";

    window.Music.createSongsPlayer(songsPlayerEl, {
      songs: [
        {
          title: "Four Floss Five Six",
          artist: "Blue Ducks",
          albumArt: PLACEHOLDER_ART,
          audio: CASSETTE_SONGS_BASE + "BlueDucks_FourFlossFiveSix.mp3",
        },
        {
          title: "Thursday Snow (Reprise)",
          artist: "Blank & Kytt",
          albumArt: PLACEHOLDER_ART,
          audio: CASSETTE_SONGS_BASE + "BlankKytt_ThursdaySnowReprise.mp3",
        },
        {
          title: "Floss Suffers From Gamma Radiation",
          artist: "Blue Ducks",
          albumArt: PLACEHOLDER_ART,
          audio:
            CASSETTE_SONGS_BASE +
            "BlueDucks_FlossSuffersFromGammaRadiation.mp3",
        },
        {
          title: "RSPN",
          artist: "Blank & Kytt",
          albumArt: PLACEHOLDER_ART,
          audio: CASSETTE_SONGS_BASE + "BlankKyt_RSPN.mp3",
        },
      ],
    });
  }
});
