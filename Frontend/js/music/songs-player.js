// ---------------------------------------------------------------------
// Music — Songs player (Phase 1: frontend only)
// ---------------------------------------------------------------------
// Vanilla HTML5-audio player for the Songs panel. Replaces the earlier
// CassettePlayer port (removed) — same plain-<script>, no-framework
// architecture as every other file here: a single window.Music.* export,
// driven by DOM lookups inside the container main.js hands it.
//
// Usage (see main.js):
//   window.Music.createSongsPlayer(containerEl, { songs: [...] })
// where each entry in `songs` is a plain object:
//   { title: "", artist: "", albumArt: "", audio: "" }
// That is deliberately the exact shape Backend/resources/music is meant
// to hand this later (Phase 2/3) — swapping real songs in means changing
// what array gets passed in, not anything in this file.
//
// No queue-building/recommendation logic lives here — `songs` is just
// played in the order given, with Prev/Next wrapping around it. A basic
// shuffle toggle picks a random next track instead of the sequential
// one, and a basic repeat toggle replays the current track on `ended`
// instead of advancing — no real reordering/queue logic beyond that.
// That's as far as Phase 1 goes; the selection algorithm is a separate,
// later phase. UI redesigned off the ChetanVerma reference
// (https://ui.chetanverma.com/components/audio-player) — compact card,
// click/drag seek bar, five-button transport pill — adapted into plain
// HTML/CSS/vanilla JS; no React/Tailwind/build tooling introduced. The
// old wide card + clickable queue list is gone.
//
// ---- Artwork-reactive background -----------------------------------
// Also drives the ambient background behind the player (.mus-player-bg
// in music.html/music.css), adapted from the Groove Widget reference
// (Backend/resources/music/Groove-Widget-main — a full React player we
// only borrowed the *technique* from, not its code). That technique is:
// an oversized blurred copy of the current album art, plus color glows
// tinted by the artwork. The reference hardcodes that color by hand per
// track; here it's actually sampled off the artwork with a <canvas>,
// which is the one piece that doesn't port over unchanged — see
// extractDominantColors() below for why it has to degrade gracefully.
//
// There is deliberately no separate "current background track" — every
// update here is driven from inside load() below, off the exact same
// `song` object the player itself just switched to, so the background
// can never drift out of sync with what's actually playing.
(function () {
  window.Music = window.Music || {};

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  // Safe dark neutral used for the glow color variables whenever real
  // extraction isn't available — but see updateBackground() for the
  // actual fallback behavior: the glows are faded out via
  // --mus-glow-opacity rather than shown in this flat gray, so the
  // blurred-artwork layer (boosted in saturation to compensate) carries
  // the real color information instead of this value ever being seen.
  var FALLBACK_GLOW_COLOR = "#303030";

  // Caches extracted colors (and extraction failures) by artwork URL, so
  // a track that's revisited — or that shares artwork with another track,
  // like today's placeholder covers — never re-samples pixels. Shared
  // across every createSongsPlayer() call in this module rather than
  // per-instance, since artwork URLs are the real identity here, not the
  // player instance; there is only ever one Songs player on the page.
  var colorCache = {};

  // Samples the current album art on a hidden <canvas> and averages it
  // into TWO tones (top half / bottom half of the image) rather than one
  // flat average, so the two background glows (see music.css) read as
  // genuinely different areas of color instead of one color painted
  // twice — closer to how varied real album art actually looks, for the
  // same single canvas read.
  //
  // This is the one part of the effect that genuinely can't be a
  // straight port of the Groove Widget reference: that project runs
  // under Vite/a real HTTP origin, where this works fine, but this
  // portfolio is opened directly as file:///...music.html — and reading
  // pixels back off a file:// image paints the canvas as "tainted" and
  // throws a SecurityError on getImageData, by browser design,
  // regardless of the image being perfectly local. Tested directly
  // against this portfolio's own artwork path before writing this: it
  // does throw here. So this function tries the real extraction (useful
  // the moment this is ever served over http/https instead of opened as
  // a file), and on ANY failure — the security error, a decode error, a
  // 404 — quietly caches "no colors" and calls back with null. Callers
  // treat null as "fall back to the artwork layer alone", never as an
  // error to surface; nothing here ever throws past this function or
  // logs anything to the console.
  function extractDominantColors(url, callback) {
    if (!url || !window.HTMLCanvasElement) {
      callback(null);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(colorCache, url)) {
      callback(colorCache[url]);
      return;
    }

    function average(data, size, yStart, yEnd) {
      var r = 0,
        g = 0,
        b = 0,
        count = 0;
      for (var y = yStart; y < yEnd; y++) {
        for (var x = 0; x < size; x++) {
          var i = (y * size + x) * 4;
          // Skip fully transparent pixels so they don't skew the
          // average toward black on artwork with transparent padding.
          if (data[i + 3] === 0) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
      }
      if (count === 0) return null;
      return (
        "rgb(" +
        Math.round(r / count) +
        ", " +
        Math.round(g / count) +
        ", " +
        Math.round(b / count) +
        ")"
      );
    }

    var img = new Image();
    img.onload = function () {
      var colors = null;
      try {
        var size = 32;
        var canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, size, size);
        var data = ctx.getImageData(0, 0, size, size).data;

        var top = average(data, size, 0, size / 2);
        var bottom = average(data, size, size / 2, size);
        if (top || bottom) {
          colors = { primary: top || bottom, secondary: bottom || top };
        }
      } catch (e) {
        // SecurityError (tainted canvas under file://) or anything else
        // — no colors this time, no console noise, player keeps working.
        colors = null;
      }
      colorCache[url] = colors;
      callback(colors);
    };
    img.onerror = function () {
      colorCache[url] = null;
      callback(null);
    };
    img.src = url;
  }

  // Minimal inline icons (no icon-font dependency, unlike the old
  // CassettePlayer's "playericons" webfont). Stroke-based, lucide-style,
  // to match the ChetanVerma reference's own lucide-react icon set —
  // these are generic, functional interface glyphs (play/pause/skip/
  // shuffle/repeat), not reproductions of any specific artwork.
  var ICON_ATTRS =
    'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  var ICON_PLAY =
    '<svg ' + ICON_ATTRS + '><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>';
  var ICON_PAUSE =
    '<svg ' +
    ICON_ATTRS +
    '><rect x="14" y="4" width="4" height="16" rx="1"></rect><rect x="6" y="4" width="4" height="16" rx="1"></rect></svg>';
  var ICON_PREV =
    '<svg ' +
    ICON_ATTRS +
    '><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg>';
  var ICON_NEXT =
    '<svg ' +
    ICON_ATTRS +
    '><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>';
  var ICON_SHUFFLE =
    '<svg ' +
    ICON_ATTRS +
    '><path d="m18 14 4 4-4 4"></path><path d="m18 2 4 4-4 4"></path><path d="M2 18h1.973a4 4 0 0 0 3.3-1.76l5.454-8.08A4 4 0 0 1 16.027 6H22"></path><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"></path><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"></path></svg>';
  var ICON_REPEAT =
    '<svg ' +
    ICON_ATTRS +
    '><path d="m17 2 4 4-4 4"></path><path d="M3 11v-1a4 4 0 0 1 4-4h14"></path><path d="m7 22-4-4 4-4"></path><path d="M21 13v1a4 4 0 0 1-4 4H3"></path></svg>';

  function createSongsPlayer(container, options) {
    if (!container) return null;
    options = options || {};
    var songs = options.songs || [];
    if (!songs.length) return null;

    var els = {
      artImg: container.querySelector("#playerArtImg"),
      title: container.querySelector("#playerTitle"),
      artist: container.querySelector("#playerArtist"),
      seek: container.querySelector("#playerSeek"),
      seekFill: container.querySelector("#playerSeekFill"),
      timeCurrent: container.querySelector("#playerTimeCurrent"),
      timeTotal: container.querySelector("#playerTimeTotal"),
      shuffle: container.querySelector("#playerShuffle"),
      prev: container.querySelector("#playerPrev"),
      playPause: container.querySelector("#playerPlayPause"),
      next: container.querySelector("#playerNext"),
      repeat: container.querySelector("#playerRepeat"),
      audio: container.querySelector("#playerAudio"),
    };
    if (!els.audio || !els.seek) return null;

    // Background layer lookups are deliberately separate from the
    // `!els.audio || !els.seek` guard above: the player itself must keep
    // working even on an older/partial copy of music.html that doesn't
    // have .mus-player-bg yet (or if a future edit removes it) — the
    // background is a visual extra, never a dependency of playback. Every
    // lookup is re-checked for null before use below.
    var bg = {
      root: container.parentNode
        ? container.parentNode.querySelector("#playerBg")
        : null,
      layers: [
        container.parentNode
          ? container.parentNode.querySelector("#playerBgLayerA")
          : null,
        container.parentNode
          ? container.parentNode.querySelector("#playerBgLayerB")
          : null,
      ],
      glowA: container.parentNode
        ? container.parentNode.querySelector("#playerBgGlowA")
        : null,
      glowB: container.parentNode
        ? container.parentNode.querySelector("#playerBgGlowB")
        : null,
    };
    var bgVisibleLayer = 0; // index into bg.layers currently shown
    var bgReady = false; // true once the first (instant) background is set

    els.playPause.innerHTML = ICON_PLAY;
    els.prev.innerHTML = ICON_PREV;
    els.next.innerHTML = ICON_NEXT;
    if (els.shuffle) els.shuffle.innerHTML = ICON_SHUFFLE;
    if (els.repeat) els.repeat.innerHTML = ICON_REPEAT;

    var index = 0;
    var isScrubbing = false;
    // Basic shuffle/repeat state — per the brief, no recommendation
    // algorithm or advanced queue logic yet, just: repeat replays the
    // current track instead of advancing on `ended`, and shuffle picks
    // a random next track instead of the next sequential one (both
    // still funnel through load(), the one source of truth below).
    var shuffleOn = false;
    var repeatOn = false;

    function randomIndexExcept(exclude) {
      if (songs.length <= 1) return exclude;
      var i;
      do {
        i = Math.floor(Math.random() * songs.length);
      } while (i === exclude);
      return i;
    }

    function goNext() {
      load(shuffleOn ? randomIndexExcept(index) : index + 1, true);
    }

    // Updates the ambient background to match `song` — called from load()
    // below with the exact same song object the player just switched to,
    // so there is one single source of truth for "current track" and the
    // background can't end up out of sync with it. `instant` (true only
    // for the very first load) skips the crossfade/color transition so
    // the background doesn't visibly fade in "from nothing" on page load.
    function updateBackground(song, instant) {
      if (!song) return;

      // Artwork layer crossfade. If the background markup isn't present
      // for some reason, this is a silent no-op — the player itself
      // (art/title/audio) already updated independently of this.
      var oldLayer = bg.layers[bgVisibleLayer];
      var newLayerIndex = bgVisibleLayer === 0 ? 1 : 0;
      var newLayer = bg.layers[newLayerIndex];

      if (newLayer) {
        newLayer.style.backgroundImage = song.albumArt
          ? 'url("' + song.albumArt + '")'
          : "none";

        if (instant || !oldLayer) {
          // First paint: show it immediately, no fade-from-nothing.
          newLayer.classList.add("mus-player-bg__layer--no-transition");
          newLayer.classList.add("is-visible");
          if (oldLayer) oldLayer.classList.remove("is-visible");
          // Force layout so the no-transition class is actually applied
          // before being removed, otherwise the browser can coalesce
          // both class changes into one frame and the "no transition"
          // never takes effect.
          void newLayer.offsetWidth;
          newLayer.classList.remove("mus-player-bg__layer--no-transition");
        } else {
          newLayer.classList.add("is-visible");
          oldLayer.classList.remove("is-visible");
        }
      }
      bgVisibleLayer = newLayerIndex;
      bgReady = true;

      // Color glows: only (re)extracted when the artwork actually changes,
      // and cached by URL — see extractDominantColors' own comment for
      // why this can't produce real colors under file://. The CSS
      // transitions on --mus-track-color/-2 and --mus-glow-opacity (both
      // set on bg.root, which the glow elements inherit from) are what
      // make this crossfade smoothly; this function only ever sets the
      // target values, never animates them itself.
      //
      // When extraction genuinely fails (the file:// case, today), the
      // glows stay off (--mus-glow-opacity: 0) — tried turning them on
      // at a low opacity here first (to stop the corners looking dark
      // next to the center), but under *normal* alpha blending that
      // just produced a different visible artifact: two soft but
      // distinct blobs with their own fading edges, darker in the gaps
      // between them than the page's own base tone (measured: pixels
      // as low as 19 against a base of 28) — i.e. another "patch that
      // looks cut into the background" instead of one continuous wash.
      // The real fix (see music.css's .mus-player-bg) is
      // mix-blend-mode: screen on the background container: screen can
      // only ever lighten the base, never darken it, so nothing can
      // render darker than the page itself again regardless of how the
      // layers/glows are combined. With that in place the single
      // full-viewport blurred-artwork layer alone reaches every pixel,
      // so the corner glows aren't needed to fill gaps and are left off
      // here, same as before.
      if (bg.root) {
        var glowEls = [bg.glowA, bg.glowB].filter(Boolean);
        if (instant) {
          glowEls.forEach(function (el) {
            el.classList.add("mus-player-bg__layer--no-transition");
          });
        }
        extractDominantColors(song.albumArt, function (colors) {
          if (!bg.root) return;
          if (colors) {
            bg.root.style.setProperty("--mus-track-color", colors.primary);
            bg.root.style.setProperty(
              "--mus-track-color-2",
              colors.secondary
            );
            bg.root.style.setProperty("--mus-glow-opacity", "0.38");
            bg.root.style.setProperty("--mus-player-bg-opacity", "0.42");
            bg.root.style.setProperty("--mus-player-bg-saturate", "1.6");
          } else {
            bg.root.style.setProperty(
              "--mus-track-color",
              FALLBACK_GLOW_COLOR
            );
            bg.root.style.setProperty(
              "--mus-track-color-2",
              FALLBACK_GLOW_COLOR
            );
            bg.root.style.setProperty("--mus-glow-opacity", "0");
            bg.root.style.setProperty("--mus-player-bg-opacity", "0.85");
            bg.root.style.setProperty("--mus-player-bg-saturate", "1.9");
          }
          if (instant) {
            glowEls.forEach(function (el) {
              void el.offsetWidth;
              el.classList.remove("mus-player-bg__layer--no-transition");
            });
          }
        });
      }
    }

    function setPlayingUI(isPlaying) {
      els.playPause.innerHTML = isPlaying ? ICON_PAUSE : ICON_PLAY;
      els.playPause.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
    }

    // Custom div-based seek bar (replaces the old native <input
    // type="range">), matching the ChetanVerma reference's own
    // CustomSlider: click/drag anywhere on the track to seek, a plain
    // width-animated fill, no native thumb. Works for both mouse and
    // touch; a keydown handler below adds Left/Right-arrow nudging so
    // keyboard users keep basic seek access.
    function applySeekVisual(pct) {
      pct = Math.max(0, Math.min(1, pct));
      if (els.seekFill) els.seekFill.style.width = pct * 100 + "%";
      els.seek.setAttribute("aria-valuenow", String(Math.round(pct * 100)));
      return pct;
    }

    function pointerX(e) {
      if (e.touches && e.touches.length) return e.touches[0].clientX;
      if (e.changedTouches && e.changedTouches.length)
        return e.changedTouches[0].clientX;
      return e.clientX;
    }

    function pctFromPointer(e) {
      var rect = els.seek.getBoundingClientRect();
      if (!rect.width) return 0;
      return (pointerX(e) - rect.left) / rect.width;
    }

    function handleSeekStart(e) {
      isScrubbing = true;
      var pct = applySeekVisual(pctFromPointer(e));
      var dur = els.audio.duration;
      if (dur) els.timeCurrent.textContent = formatTime(pct * dur);
      e.preventDefault();
    }

    function handleSeekMove(e) {
      if (!isScrubbing) return;
      var pct = applySeekVisual(pctFromPointer(e));
      var dur = els.audio.duration;
      if (dur) els.timeCurrent.textContent = formatTime(pct * dur);
    }

    function handleSeekEnd(e) {
      if (!isScrubbing) return;
      isScrubbing = false;
      var pct = applySeekVisual(pctFromPointer(e));
      var dur = els.audio.duration;
      if (dur) els.audio.currentTime = pct * dur;
    }

    els.seek.addEventListener("mousedown", handleSeekStart);
    window.addEventListener("mousemove", handleSeekMove);
    window.addEventListener("mouseup", handleSeekEnd);
    els.seek.addEventListener("touchstart", handleSeekStart, {
      passive: false,
    });
    window.addEventListener("touchmove", handleSeekMove, { passive: false });
    window.addEventListener("touchend", handleSeekEnd);
    els.seek.addEventListener("keydown", function (e) {
      var dur = els.audio.duration;
      if (!dur) return;
      var step = dur * 0.02;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        els.audio.currentTime = Math.min(dur, els.audio.currentTime + step);
        e.preventDefault();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        els.audio.currentTime = Math.max(0, els.audio.currentTime - step);
        e.preventDefault();
      }
    });

    function load(i, autoplay) {
      index = ((i % songs.length) + songs.length) % songs.length;
      var song = songs[index];

      els.audio.src = song.audio;
      els.artImg.src = song.albumArt;
      els.artImg.alt = song.title + " — " + song.artist + " album art";
      els.title.textContent = song.title;
      els.artist.textContent = song.artist;

      // Background follows the same `song` this function just switched
      // the player to — see updateBackground()'s own comment for why
      // that's the only "current track" this relies on. !bgReady is only
      // true for the very first load() call (the page's initial track),
      // so that one paints instantly instead of crossfading from nothing.
      updateBackground(song, !bgReady);

      applySeekVisual(0);
      els.timeCurrent.textContent = "0:00";
      els.timeTotal.textContent = "0:00";

      if (autoplay) {
        var p = els.audio.play();
        if (p && p.catch) p.catch(function () {});
      } else {
        setPlayingUI(false);
      }
    }

    els.playPause.addEventListener("click", function () {
      if (els.audio.paused) {
        var p = els.audio.play();
        if (p && p.catch) p.catch(function () {});
      } else {
        els.audio.pause();
      }
    });
    els.prev.addEventListener("click", function () {
      load(index - 1, true);
    });
    els.next.addEventListener("click", function () {
      goNext();
    });
    if (els.shuffle) {
      els.shuffle.addEventListener("click", function () {
        shuffleOn = !shuffleOn;
        els.shuffle.classList.toggle("is-active", shuffleOn);
        els.shuffle.setAttribute("aria-pressed", String(shuffleOn));
      });
    }
    if (els.repeat) {
      els.repeat.addEventListener("click", function () {
        repeatOn = !repeatOn;
        els.repeat.classList.toggle("is-active", repeatOn);
        els.repeat.setAttribute("aria-pressed", String(repeatOn));
      });
    }

    els.audio.addEventListener("play", function () {
      setPlayingUI(true);
    });
    els.audio.addEventListener("pause", function () {
      setPlayingUI(false);
    });
    els.audio.addEventListener("ended", function () {
      if (repeatOn) {
        load(index, true);
      } else {
        goNext();
      }
    });

    els.audio.addEventListener("loadedmetadata", function () {
      els.timeTotal.textContent = formatTime(els.audio.duration);
    });

    els.audio.addEventListener("timeupdate", function () {
      if (isScrubbing) return;
      els.timeCurrent.textContent = formatTime(els.audio.currentTime);
      if (els.audio.duration) {
        applySeekVisual(els.audio.currentTime / els.audio.duration);
      }
    });

    load(0, false);

    return {
      play: function () {
        var p = els.audio.play();
        if (p && p.catch) p.catch(function () {});
      },
      pause: function () {
        els.audio.pause();
      },
      next: function () {
        goNext();
      },
      prev: function () {
        load(index - 1, true);
      },
    };
  }

  window.Music.createSongsPlayer = createSongsPlayer;
})();
