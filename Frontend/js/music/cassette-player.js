// ---------------------------------------------------------------------
// Music — Songs: Cassette Player (vanilla port)
// ---------------------------------------------------------------------
// A behavioral port of Codrops' "Old School Cassette Player with HTML5
// Audio" (jquery.cassette.js + knobKnob.jquery.js), supplied by the user
// as the reference for how the SONGS panel should look and work. Same
// no-build-step / no-framework constraint as the rest of this portfolio,
// so the jQuery plugin is rewritten here as plain DOM/JS — same state
// machine, same DOM structure/CSS classes (vc-tape, vc-controls, vc-
// volume-wrap, .knob), same interaction feel. Not a redesign.
//
// Dropped from the original bundle (both are legacy IE-era shims with
// nothing left to do in a modern browser, and neither adds any visual
// or behavioral effect of its own): js/transform.js (a jQuery cssHooks
// polyfill for animating the `transform` CSS property in old IE — every
// current browser supports `transform` natively) and
// js/modernizr.custom.*.js (feature-detection only used by the original
// demo page to print "your browser doesn't support X" messages).
//
// This is Phase 1 UI/mechanics integration only. The four bundled songs
// (Blue Ducks / Blank & Kytt, both Creative Commons) are a temporary
// placeholder so Play/Rewind/Fast-Forward/Switch-Side are all genuinely
// testable right now — they are NOT the user's song library. No
// recommendation/selection algorithm, mood/language logic, listening
// history, or Backend resource wiring is added here; that is Phase 2/3.
// Swapping in the real library later means changing the `songs` /
// `songsBasePath` options this is constructed with in main.js — nothing
// in this file needs to change.
//
// Plain classic script (no import/export) — same convention as every
// other page in this portfolio — publishing itself as
// window.Music.createCassettePlayer.
(function (global) {
  "use strict";

  // ---- shared helpers ---------------------------------------------------

  function getSupportedType() {
    var audio = document.createElement("audio");
    if (audio.canPlayType && audio.canPlayType("audio/mpeg;")) return "mp3";
    if (audio.canPlayType && audio.canPlayType("audio/ogg;")) return "ogg";
    return "wav";
  }

  // ---- Song / Side (playlist model — unchanged from the original) -------

  function Song(basePath, name, id) {
    this.id = id;
    this.name = name;
    this.duration = 0;
    this.sources = {
      mp3: basePath + name + ".mp3",
      ogg: basePath + name + ".ogg",
    };
  }

  Song.prototype.getSource = function (type) {
    return this.sources[type];
  };

  Song.prototype.getDuration = function () {
    return this.duration;
  };

  // Loads just enough of the file to read its duration. Resolves either
  // way (even on error) so one bad/missing song can't hang the whole
  // player waiting for metadata that will never arrive.
  Song.prototype.loadMetadata = function () {
    var self = this;
    return new Promise(function (resolve) {
      var tmp = document.createElement("audio");
      tmp.preload = "auto";

      function onLoaded() {
        cleanup();
        self.duration = tmp.duration || 0;
        resolve(self);
      }
      function onError() {
        cleanup();
        self.duration = 0;
        resolve(self);
      }
      function cleanup() {
        tmp.removeEventListener("loadedmetadata", onLoaded);
        tmp.removeEventListener("error", onError);
      }

      tmp.addEventListener("loadedmetadata", onLoaded);
      tmp.addEventListener("error", onError);
      tmp.src = self.getSource(getSupportedType());
    });
  };

  function Side(id, playlist, status) {
    this.id = id;
    this.status = status; // 'start' | 'middle' | 'end'
    this.playlist = playlist.slice().sort(function (a, b) {
      return a.id - b.id;
    });
    this.playlistCount = this.playlist.length;
    this.duration = 0;
    for (var i = 0; i < this.playlist.length; i++) {
      this.duration += this.playlist[i].duration || 0;
    }
  }

  Side.prototype.getSong = function (num) {
    return this.playlist[num];
  };
  Side.prototype.getPlaylist = function () {
    return this.playlist;
  };
  Side.prototype.getDuration = function () {
    return this.duration;
  };
  Side.prototype.getPlaylistCount = function () {
    return this.playlistCount;
  };
  Side.prototype.setPositionStatus = function (status) {
    this.status = status;
  };
  Side.prototype.getPositionStatus = function () {
    return this.status;
  };

  // ---- SoundFx (button click / rewind / fast-forward / switch cues) -----

  function SoundFx(basePath) {
    this.basePath = basePath;
    this.audio = document.createElement("audio");
    this.audio.preload = "auto";
  }

  SoundFx.prototype.play = function (action, loop) {
    var self = this;
    return new Promise(function (resolve) {
      var src = self.basePath + action + "." + getSupportedType();
      self.audio.src = src;
      if (loop) {
        self.audio.loop = true;
      } else {
        self.audio.removeAttribute("loop");
      }

      function onCanPlay() {
        self.audio.removeEventListener("canplay", onCanPlay);
        // Mirrors the original: resolve slightly after playback starts
        // rather than waiting for 'ended' (which some browsers don't
        // fire reliably for very short looping clips).
        setTimeout(resolve, 500);
        var p = self.audio.play();
        if (p && typeof p.catch === "function") p.catch(function () {});
      }
      self.audio.addEventListener("canplay", onCanPlay);
    });
  };

  // ---- knob (vanilla port of knobKnob.jquery.js, used for the volume
  //      dial only) -------------------------------------------------------

  function createKnob(wrapperEl, options) {
    options = Object.assign({ snap: 0, value: 0, turn: function () {} }, options || {});

    wrapperEl.innerHTML = '<div class="knob"><div class="top"></div><div class="base"></div></div>';
    var knob = wrapperEl.querySelector(".knob");
    var knobTop = knob.querySelector(".top");

    var startDeg = -1;
    var currentDeg = 0;
    var rotation = 0;
    var lastDeg = 0;

    if (options.value > 0 && options.value <= 359) {
      rotation = lastDeg = currentDeg = options.value;
      knobTop.style.transform = "rotate(" + currentDeg + "deg)";
      options.turn(currentDeg / 359);
    }

    function onMove(e) {
      var point = e.touches ? e.touches[0] : e;
      var rect = knob.getBoundingClientRect();
      var center = { y: rect.top + rect.height / 2, x: rect.left + rect.width / 2 };

      var a = center.y - point.clientY;
      var b = center.x - point.clientX;
      var deg = Math.atan2(a, b) * (180 / Math.PI);
      if (deg < 0) deg = 360 + deg;

      if (startDeg === -1) startDeg = deg;

      var tmp = Math.floor(deg - startDeg + rotation);
      if (tmp < 0) tmp = 360 + tmp;
      else if (tmp > 359) tmp = tmp % 360;

      if (options.snap && tmp < options.snap) tmp = 0;

      // Blocks a jump across the 0/359 boundary rather than spinning
      // the knob the "long way round".
      if (Math.abs(tmp - lastDeg) > 180) return;

      currentDeg = tmp;
      lastDeg = tmp;
      knobTop.style.transform = "rotate(" + currentDeg + "deg)";
      options.turn(currentDeg / 360);
    }

    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchend", onUp);
      rotation = currentDeg;
      startDeg = -1;
    }

    function onDown(e) {
      e.preventDefault();
      document.addEventListener("mousemove", onMove);
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("mouseup", onUp);
      document.addEventListener("touchend", onUp);
    }

    knob.addEventListener("mousedown", onDown);
    knob.addEventListener("touchstart", onDown, { passive: false });
  }

  // ---- the player itself --------------------------------------------------

  function createCassettePlayer(container, options) {
    options = Object.assign(
      {
        // song names; assumes songsBasePath + name + '.mp3'/'.ogg'
        songs: [],
        songsBasePath: "songs/",
        soundsBasePath: "sounds/",
        fallbackMessage: "HTML5 audio not supported",
        initialVolume: 0.7,
      },
      options || {}
    );

    var state = {
      currentSide: 1,
      cntTime: 0,
      timeIterator: 0,
      elapsed: 0,
      lastaction: "",
      isMoving: false,
      isSeeking: false,
      timertimeout: null,
      wheelLeftVal: undefined,
      wheelRightVal: undefined,
    };

    var side1, side2, audio, sound;
    var els = {};

    var loaderEl = container.querySelector(".vc-loader");
    if (loaderEl) loaderEl.style.display = "block";

    loadSides(options.songs, options.songsBasePath).then(function (sides) {
      side1 = sides.side1;
      side2 = sides.side2;
      if (loaderEl) loaderEl.style.display = "none";
      createPlayer();
    });

    function loadSides(names, basePath) {
      var songs = names.map(function (name, i) {
        return new Song(basePath, name, i);
      });
      return Promise.all(
        songs.map(function (s) {
          return s.loadMetadata();
        })
      ).then(function (loaded) {
        var p1 = [];
        var p2 = [];
        var half = loaded.length / 2;
        loaded.forEach(function (song) {
          if (song.id < half) p1.push(song);
          else p2.push(song);
        });
        return { side1: new Side("side1", p1, "start"), side2: new Side("side2", p2, "end") };
      });
    }

    function getSide() {
      return state.currentSide === 1 ? { current: side1, reverse: side2 } : { current: side2, reverse: side1 };
    }

    function createPlayer() {
      audio = document.createElement("audio");
      audio.id = "audioElem";
      var fallback = document.createElement("span");
      fallback.textContent = options.fallbackMessage;
      audio.appendChild(fallback);
      container.insertBefore(audio, container.firstChild);

      sound = new SoundFx(options.soundsBasePath);

      createControls();

      els.tape = container.querySelector(".vc-tape");
      els.wheelLeft = container.querySelector(".vc-tape-wheel-left");
      els.wheelRight = container.querySelector(".vc-tape-wheel-right");
      els.sideA = container.querySelector(".vc-tape-side-a");
      els.sideB = container.querySelector(".vc-tape-side-b");
      if (els.sideA) els.sideA.style.display = "block";

      loadEvents();
    }

    function createControls() {
      els.controls = document.createElement("ul");
      els.controls.className = "vc-controls";
      els.controls.style.display = "none";

      function makeButton(cls, label) {
        var li = document.createElement("li");
        li.className = cls;
        li.appendChild(document.createTextNode(label));
        li.appendChild(document.createElement("span"));
        return li;
      }

      els.cPlay = makeButton("vc-control-play", "Play");
      els.cRewind = makeButton("vc-control-rewind", "Rew");
      els.cForward = makeButton("vc-control-fforward", "FF");
      els.cStop = makeButton("vc-control-stop", "Stop");
      els.cSwitch = makeButton("vc-control-switch", "Switch");

      [els.cPlay, els.cRewind, els.cForward, els.cStop, els.cSwitch].forEach(function (li) {
        els.controls.appendChild(li);
      });
      container.appendChild(els.controls);

      els.volumeWrap = document.createElement("div");
      els.volumeWrap.className = "vc-volume-wrap";
      els.volumeWrap.style.display = "none";
      var volumeControl = document.createElement("div");
      volumeControl.className = "vc-volume-control";
      var volumeKnob = document.createElement("div");
      volumeKnob.className = "vc-volume-knob";
      volumeControl.appendChild(volumeKnob);
      els.volumeWrap.appendChild(volumeControl);
      container.appendChild(els.volumeWrap);

      var probe = document.createElement("audio");
      var canPlay = probe.canPlayType && (probe.canPlayType("audio/mpeg") || probe.canPlayType("audio/ogg"));

      if (canPlay) {
        els.controls.style.display = "";
        els.volumeWrap.style.display = "";
        createKnob(volumeKnob, {
          snap: 10,
          value: 359 * options.initialVolume,
          turn: function (ratio) {
            changeVolume(ratio);
          },
        });
        audio.volume = options.initialVolume;
      }
      // else: no HTML5 audio support — controls/volume stay hidden, same
      // as the original (which left a flash-fallback TODO that was never
      // implemented; not adding one here either — out of scope).
    }

    function loadEvents() {
      els.cSwitch.addEventListener("mousedown", function () {
        setButtonActive(els.cSwitch);
        switchSides();
      });
      els.cPlay.addEventListener("mousedown", function () {
        setButtonActive(els.cPlay);
        play();
      });
      els.cStop.addEventListener("mousedown", function () {
        setButtonActive(els.cStop);
        stop();
      });
      els.cForward.addEventListener("mousedown", function () {
        setButtonActive(els.cForward);
        forward();
      });
      els.cRewind.addEventListener("mousedown", function () {
        setButtonActive(els.cRewind);
        rewind();
      });

      audio.addEventListener("timeupdate", function () {
        state.cntTime = state.timeIterator + audio.currentTime;
        updateWheelValue(getWheelValues(state.cntTime));
      });

      audio.addEventListener("ended", function () {
        state.timeIterator += audio.duration;
        play();
      });
    }

    function setButtonActive(el) {
      el.classList.add("vc-control-pressed");
      setTimeout(function () {
        el.classList.remove("vc-control-pressed");
      }, 100);
    }

    function changeVolume(ratio) {
      audio.volume = ratio;
    }

    function prepare(song) {
      audio.src = song.getSource(getSupportedType());
    }

    function switchSides() {
      if (state.isMoving) {
        // eslint-disable-next-line no-alert
        alert("Please stop the player before switching sides.");
        return;
      }

      sound.play("switch");
      state.lastaction = "";

      if (state.currentSide === 1) {
        state.currentSide = 2;
        els.tape.style.transform = "rotate3d(0, 1, 0, 180deg)";
        setTimeout(function () {
          els.sideA.style.display = "none";
          els.sideB.style.display = "block";
          state.cntTime = getPosTime();
        }, 200);
      } else {
        state.currentSide = 1;
        els.tape.style.transform = "rotate3d(0, 1, 0, 0deg)";
        setTimeout(function () {
          els.sideB.style.display = "none";
          els.sideA.style.display = "block";
          state.cntTime = getPosTime();
        }, 200);
      }
    }

    function updateButtons(button) {
      var activeClass = "vc-control-active";
      els.cPlay.classList.remove(activeClass);
      els.cStop.classList.remove(activeClass);
      els.cRewind.classList.remove(activeClass);
      els.cForward.classList.remove(activeClass);

      if (button === "play") els.cPlay.classList.add(activeClass);
      else if (button === "rewind") els.cRewind.classList.add(activeClass);
      else if (button === "forward") els.cForward.classList.add(activeClass);
    }

    function play() {
      updateButtons("play");

      sound.play("click").then(function () {
        var data = updateStatus();
        if (!data) return;

        prepare(getSide().current.getSong(data.songIdx));

        function onCanPlay() {
          audio.removeEventListener("canplay", onCanPlay);
          audio.currentTime = data.timeInSong;
          var p = audio.play();
          if (p && typeof p.catch === "function") p.catch(function () {});
          state.isMoving = true;
          setWheelAnimation("2s", "play");
        }
        audio.addEventListener("canplay", onCanPlay);
      });
    }

    function updateStatus() {
      var posTime = state.cntTime;

      stop(true);
      setSidesPosStatus("middle");

      if (state.lastaction === "forward") posTime += state.elapsed;
      else if (state.lastaction === "rewind") posTime -= state.elapsed;

      if (posTime >= getSide().current.getDuration()) {
        stop(true);
        setSidesPosStatus("end");
        return false;
      }

      resetElapsed();

      var data = getSongInfoByTime(posTime);
      state.cntTime = posTime;
      state.timeIterator = data.iterator;
      return data;
    }

    function rewind() {
      if (getSide().current.getPositionStatus() === "start") return;

      updateButtons("rewind");

      sound.play("click").then(function () {
        updateStatus();
        state.isMoving = true;
        state.lastaction = "rewind";
        sound.play("rewind", true);
        setWheelAnimation("0.5s", "rewind");
        timer();
      });
    }

    function forward() {
      if (getSide().current.getPositionStatus() === "end") return;

      updateButtons("forward");

      sound.play("click").then(function () {
        updateStatus();
        state.isMoving = true;
        state.lastaction = "forward";
        sound.play("fforward", true);
        setWheelAnimation("0.5s", "forward");
        timer();
      });
    }

    function stop(silent) {
      if (!silent) {
        updateButtons("stop");
        sound.play("click");
      }
      state.isMoving = false;
      stopWheels();
      audio.pause();
      stopTimer();
    }

    function setSidesPosStatus(position) {
      getSide().current.setPositionStatus(position);
      if (position === "middle") getSide().reverse.setPositionStatus(position);
      else if (position === "start") getSide().reverse.setPositionStatus("end");
      else if (position === "end") getSide().reverse.setPositionStatus("start");
    }

    // given a point in time for the current side, returns which song of
    // that side is playing at that point, and the time within that song
    function getSongInfoByTime(time) {
      var data = { songIdx: 0, timeInSong: 0, iterator: 0 };
      var side = getSide().current;
      var playlist = side.getPlaylist();
      var cntTime = 0;

      for (var i = 0, len = side.getPlaylistCount(); i < len; ++i) {
        var song = playlist[i];
        var duration = song.getDuration();
        cntTime += duration;

        if (cntTime > time) {
          data.songIdx = i;
          data.timeInSong = time - (cntTime - duration);
          data.iterator = cntTime - duration;
          return data;
        }
      }

      return data;
    }

    function getWheelValues(x) {
      var T = getSide().current.getDuration();
      if (!T) return { left: 0, right: 0 };
      return {
        left: state.currentSide === 1 ? (-70 / T) * x + 70 : (70 / T) * x,
        right: state.currentSide === 1 ? (70 / T) * x : (-70 / T) * x + 70,
      };
    }

    function getPosTime() {
      var wleft = state.wheelLeftVal !== undefined ? state.wheelLeftVal : 70;
      var wright = state.wheelRightVal !== undefined ? state.wheelRightVal : 0;
      var T = getSide().current.getDuration();
      return state.currentSide === 2 ? (T * wleft) / 70 : (T * wright) / 70;
    }

    function updateWheelValue(wheelVal) {
      state.wheelLeftVal = wheelVal.left;
      state.wheelRightVal = wheelVal.right;
      els.wheelLeft.style.boxShadow = "0 0 0 " + wheelVal.left + "px black";
      els.wheelRight.style.boxShadow = "0 0 0 " + wheelVal.right + "px black";
    }

    function setWheelAnimation(speed, mode) {
      var anim = "";
      if (state.currentSide === 1) {
        if (mode === "play" || mode === "forward") anim = "rotateLeft";
        else if (mode === "rewind") anim = "rotateRight";
      } else {
        if (mode === "play" || mode === "forward") anim = "rotateRight";
        else if (mode === "rewind") anim = "rotateLeft";
      }

      var value = anim + " " + speed + " linear infinite forwards";
      setTimeout(function () {
        els.wheelLeft.style.animation = value;
        els.wheelRight.style.animation = value;
      }, 0);
    }

    function stopWheels() {
      if (!els.wheelLeft) return;
      els.wheelLeft.style.animation = "none";
      els.wheelRight.style.animation = "none";
    }

    // credits (kept from the original): http://www.sitepoint.com/creating-accurate-timers-in-javascript/
    function timer() {
      var start = new Date().getTime();
      resetElapsed();
      state.isSeeking = true;
      setSidesPosStatus("middle");

      if (state.isSeeking) {
        clearTimeout(state.timertimeout);
        state.timertimeout = setTimeout(function () {
          timerInstance(start, 0);
        }, 100);
      }
    }

    function timerInstance(start, time) {
      time += 100;
      state.elapsed = Math.floor(time / 20) / 10;
      if (Math.round(state.elapsed) === state.elapsed) state.elapsed += 0.0;

      var posTime = state.cntTime;
      if (state.lastaction === "forward") posTime += state.elapsed;
      else if (state.lastaction === "rewind") posTime -= state.elapsed;

      updateWheelValue(getWheelValues(posTime));

      if (posTime >= getSide().current.getDuration() || posTime <= 0) {
        stop();
        state.cntTime = posTime <= 0 ? 0 : posTime;
        resetElapsed();
        setSidesPosStatus(posTime <= 0 ? "start" : "end");
        return;
      }

      var diff = new Date().getTime() - start - time;

      if (state.isSeeking) {
        clearTimeout(state.timertimeout);
        state.timertimeout = setTimeout(function () {
          timerInstance(start, time);
        }, 100 - diff);
      }
    }

    function stopTimer() {
      clearTimeout(state.timertimeout);
      state.isSeeking = false;
    }

    function resetElapsed() {
      state.elapsed = 0.0;
    }

    return {
      destroy: function () {
        stop(true);
      },
    };
  }

  global.Music = global.Music || {};
  global.Music.createCassettePlayer = createCassettePlayer;
})(window);
