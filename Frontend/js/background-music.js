// ---------------------------------------------------------------------
// Background music — one <audio> player, persistent across pages
// ---------------------------------------------------------------------
// Plain classic <script defer>, loaded after js/shortcuts.js and
// js/background-playlist.js on every linked page.
//
// Autoplay strategy (what browsers actually allow):
//   1. On page load, ONE attempt to play with sound (never muted-then-
//      unmuted). Browsers allow this only in some cases (e.g. Chrome after
//      the visitor has already interacted with the site, or for sites
//      they use often), so on a first visit it is usually blocked.
//   2. If blocked, the next real interaction anywhere on the page
//      (click, tap or key press — except M, which means "mute") starts
//      the music. No retry loops, no pop-ups: the music control just
//      shows a subtle "Play music" label.
//   3. The Play/Pause control always works as a fallback.
//
// Persistence: every page of this portfolio is a separate HTML document,
// so the browser stops audio on each navigation. The current track,
// position and play/pause choice are saved per tab (sessionStorage) and
// resumed on the next page — normally a sub-second gap. If the next page
// isn't allowed to resume with sound, step 2 above applies.
//
// Other audio: when a page's own player starts (Music page songs, the M2
// turntable, the Radio), background music pauses so nothing overlaps.
//
// Mute: shares the M shortcut's state (js/shortcuts.js) — the control's
// mute button and the M key are the same switch.
(function () {
  if (window.__portfolioMusic) return;
  window.__portfolioMusic = true;

  var script = document.currentScript;
  var ROOT = script && script.src ? new URL("../", script.src).href : "";
  var STATE_KEY = "portfolio:music";
  var VOLUME = 0.7; // fixed; never ramped up behind the visitor's back

  var probe = document.createElement("audio");
  var TYPES = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: 'audio/ogg; codecs="opus"',
    wav: "audio/wav",
  };
  function playable(src) {
    var ext = (String(src).split("?")[0].split(".").pop() || "").toLowerCase();
    var type = TYPES[ext];
    return !!type && probe.canPlayType(type) !== "";
  }

  var source = (window.PortfolioMusic && window.PortfolioMusic.playlist) || [];
  var tracks = source.filter(function (t) {
    return t && typeof t.src === "string" && playable(t.src);
  });
  if (!tracks.length) return; // nothing playable — add no UI at all

  // --- Saved state ----------------------------------------------------
  function readState() {
    try {
      return JSON.parse(window.sessionStorage.getItem(STATE_KEY) || "null");
    } catch (err) {
      return null;
    }
  }
  var saved = readState();
  var index =
    saved && saved.index >= 0 && saved.index < tracks.length
      ? saved.index
      : Math.floor(Math.random() * tracks.length);
  var resumeAt = saved && typeof saved.time === "number" ? saved.time : 0;
  // userPaused: the visitor pressed pause — respected on every page.
  var userPaused = !!(saved && saved.userPaused);

  var audio = document.createElement("audio");
  audio.className = "bgm-audio";
  audio.preload = "auto";
  audio.volume = VOLUME;
  audio.setAttribute("aria-hidden", "true");
  document.body.appendChild(audio);

  var blocked = false; // autoplay refused; waiting for an interaction
  var yielded = false; // paused because the page's own player started
  var errorsInARow = 0;

  function saveState() {
    try {
      window.sessionStorage.setItem(
        STATE_KEY,
        JSON.stringify({
          index: index,
          time: audio.currentTime || resumeAt || 0,
          userPaused: userPaused,
        })
      );
    } catch (err) {
      /* storage unavailable — music still works on this page */
    }
  }

  function load(i, startAt) {
    index = (i + tracks.length) % tracks.length;
    resumeAt = startAt || 0;
    audio.src = new URL(tracks[index].src, ROOT || window.location.href).href;
    ui.setTrack(tracks[index]);
  }

  audio.addEventListener("loadedmetadata", function () {
    if (resumeAt > 0 && isFinite(audio.duration) && resumeAt < audio.duration - 1) {
      try {
        audio.currentTime = resumeAt;
      } catch (err) {
        /* seeking not ready — start from the top */
      }
    }
    resumeAt = 0;
  });

  // --- Playing --------------------------------------------------------
  var pending = null;

  function play() {
    if (pending) return pending;
    var result;
    try {
      result = audio.play();
    } catch (err) {
      result = Promise.reject(err);
    }
    if (!result || typeof result.then !== "function") result = Promise.resolve();
    pending = result.then(
      function () {
        pending = null;
        blocked = false;
        yielded = false;
        disarm();
        ui.update();
        return true;
      },
      function (err) {
        pending = null;
        if (err && err.name === "NotAllowedError") {
          blocked = true;
          arm();
        } else if (err && err.name === "AbortError") {
          /* a newer load() replaced this play() — not a failure */
        } else {
          blocked = true; // unknown failure: let an interaction retry
          arm();
        }
        ui.update();
        return false;
      }
    );
    return pending;
  }

  function pause(byUser) {
    if (byUser) userPaused = true;
    audio.pause();
    disarm();
    blocked = false;
    saveState();
    ui.update();
  }

  function toggle() {
    if (audio.paused) {
      userPaused = false;
      yielded = false;
      play();
      saveState();
    } else {
      pause(true);
    }
  }

  function next() {
    var wasPlaying = !audio.paused || blocked;
    load(index + 1, 0);
    saveState();
    if (wasPlaying && !userPaused) play();
    else ui.update();
  }

  audio.addEventListener("ended", function () {
    errorsInARow = 0;
    load(index + 1, 0);
    saveState();
    play();
  });

  audio.addEventListener("error", function () {
    // Missing/corrupt/unsupported file: skip it, but never spin forever.
    errorsInARow += 1;
    if (errorsInARow >= tracks.length) {
      ui.setError(true);
      return;
    }
    var shouldPlay = !userPaused && !yielded;
    load(index + 1, 0);
    saveState();
    if (shouldPlay) play();
  });

  audio.addEventListener("playing", function () {
    errorsInARow = 0;
    ui.setError(false);
  });
  ["play", "pause", "volumechange"].forEach(function (type) {
    audio.addEventListener(type, function () {
      ui.update();
    });
  });

  var lastSave = 0;
  audio.addEventListener("timeupdate", function () {
    var now = Date.now();
    if (now - lastSave > 1000) {
      lastSave = now;
      saveState();
    }
  });
  window.addEventListener("pagehide", saveState);

  // --- First-interaction fallback ------------------------------------
  var ARM_EVENTS = ["pointerdown", "pointerup", "touchend", "keydown", "click"];
  var armed = false;

  function onInteraction(e) {
    if (!blocked || userPaused || yielded) return;
    if (ui.root.contains(e.target)) return; // the control handles itself
    if (e.type === "keydown") {
      var k = e.key || "";
      // M means "mute", Escape/Tab/modifiers aren't a request for music.
      if (/^(m|M|Escape|Tab|Shift|Control|Alt|Meta|CapsLock)$/.test(k)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
    }
    play();
  }

  function arm() {
    if (armed) return;
    armed = true;
    ARM_EVENTS.forEach(function (type) {
      window.addEventListener(type, onInteraction, true);
    });
  }

  function disarm() {
    if (!armed) return;
    armed = false;
    ARM_EVENTS.forEach(function (type) {
      window.removeEventListener(type, onInteraction, true);
    });
  }

  // --- Yield to the page's own audio ---------------------------------
  function yieldTo(el) {
    if (el === audio) return;
    if (!audio.paused || blocked) {
      yielded = true;
      blocked = false;
      disarm();
      audio.pause();
      saveState();
      ui.update();
    }
  }
  // <audio>/<video> in the page (Music page player)
  document.addEventListener(
    "play",
    function (e) {
      if (e.target instanceof window.HTMLMediaElement) yieldTo(e.target);
    },
    true
  );
  // media created in code, e.g. the Radio app (reported by js/shortcuts.js)
  document.addEventListener("portfolio:mediaplay", function (e) {
    yieldTo(e.detail);
  });
  // the M2 turntable (Web Audio) — its existing "playstatechange" event
  document.addEventListener("playstatechange", function (e) {
    if (e.detail && e.detail.playing) yieldTo(null);
  });

  // --- Control (UI) ---------------------------------------------------
  // Stylesheet next to this file's folder, like js/shortcuts.js.
  if (ROOT) {
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = ROOT + "css/background-music.css";
    document.head.appendChild(link);
  }

  var ui = (function () {
    var root = document.createElement("div");
    root.className = "bgm";
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "Background music");
    root.innerHTML =
      '<button class="bgm__disc" type="button" aria-label="Play music"><span class="bgm__vinyl" aria-hidden="true"></span></button>' +
      '<span class="bgm__hint" aria-hidden="true">Play music</span>' +
      '<div class="bgm__panel">' +
      '<span class="bgm__title" aria-live="polite"></span>' +
      '<button class="bgm__btn bgm__next" type="button" aria-label="Next song" title="Next song"></button>' +
      '<button class="bgm__btn bgm__mute" type="button" aria-label="Mute" title="Mute (M)"></button>' +
      '<a class="bgm__credit" target="_blank" rel="noopener license">CC</a>' +
      "</div>";
    document.body.appendChild(root);

    var disc = root.querySelector(".bgm__disc");
    var title = root.querySelector(".bgm__title");
    var muteBtn = root.querySelector(".bgm__mute");
    var credit = root.querySelector(".bgm__credit");

    disc.addEventListener("click", toggle);
    root.querySelector(".bgm__next").addEventListener("click", next);
    muteBtn.addEventListener("click", function () {
      if (window.PortfolioShortcuts && window.PortfolioShortcuts.toggleMute) {
        window.PortfolioShortcuts.toggleMute();
      } else {
        audio.muted = !audio.muted;
      }
    });

    function state() {
      if (root.classList.contains("is-error")) return "error";
      if (!audio.paused) return "playing";
      if (blocked) return "blocked";
      return "paused";
    }

    return {
      root: root,
      setTrack: function (t) {
        title.textContent = t.artist ? t.title + " · " + t.artist : t.title;
        title.title = t.credit || title.textContent;
        if (t.creditUrl) {
          credit.href = t.creditUrl;
          credit.title = t.credit || "Licence";
          credit.setAttribute("aria-label", "Licence: " + (t.credit || "credit"));
          credit.hidden = false;
        } else {
          credit.hidden = true;
        }
      },
      setError: function (on) {
        root.classList.toggle("is-error", on);
        this.update();
      },
      update: function () {
        var s = state();
        root.setAttribute("data-state", s);
        disc.setAttribute("aria-label", s === "playing" ? "Pause music" : "Play music");
        disc.setAttribute("aria-pressed", s === "playing" ? "true" : "false");
        muteBtn.setAttribute("aria-pressed", audio.muted ? "true" : "false");
        muteBtn.setAttribute("aria-label", audio.muted ? "Unmute" : "Mute");
        muteBtn.title = audio.muted ? "Unmute (M)" : "Mute (M)";
      },
    };
  })();

  // The night desktop's "Music On/Off" hotspot becomes a real toggle.
  Array.prototype.forEach.call(document.querySelectorAll(".hotspot-music"), function (spot) {
    spot.addEventListener("click", toggle);
  });

  // Coming back via the Back button (bfcache): resume if it was playing.
  window.addEventListener("pageshow", function (e) {
    if (e.persisted && audio.paused && !userPaused && !yielded) play();
  });

  // --- Start ----------------------------------------------------------
  load(index, resumeAt);
  ui.update();
  if (!userPaused) {
    play(); // the single on-load attempt
  }
})();
