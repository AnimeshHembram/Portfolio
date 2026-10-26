/*
  M2 — Groove turntable (standalone prototype).

  Source of truth: Backend/resources/music/groove/src/turntable.js
  (the working Manus prototype). The player logic below — VinylAudio
  (Web Audio synth), the <groove-turntable> custom element, seeking,
  speed, volume, keyboard handling — is that file, unchanged.

  The ONLY differences from the source, all needed for file://:
    1. Classic script wrapped in an IIFE instead of type="module"
       (file:// blocks module scripts; the source had no imports or
       exports, so nothing else changes).
    2. The shadow-DOM stylesheet and the default record artwork were
       root-absolute ("/turntable.css", "/turntable-cover.jpg"), which
       resolve to the drive root on file://. They now resolve relative
       to this script's own location, so the component works from any
       page in Frontend/.
    3. The template's initial artwork src pointed at a
       "/turntable-cover.png" that never existed in the source; it now
       starts on the real default artwork (no broken request).

  2026-10-04 — frontend updated to the newer Manus "Groove M2" design
  (Backend/resources/music/groove m2), merged into this file rather
  than replacing it: per-track record artwork + colour/tint (ALBUMS),
  zero-padded time (00:00 / 03:16), blank status while paused. Audio,
  transport, seeking, speed, volume and the file:// path handling are
  unchanged.

  2026-10-04 (restyle) — one markup change for the restyled deck: the
  speed readout is a two-line legend (33⅓ / 45) with the active speed
  lit, instead of "33⅓ RPM". Everything else in the restyle is CSS.

  2026-10-04 (reference match) — the time reads as in the reference
  (1:28 / 3:04, no leading zero) and the default record artwork is the
  reference's own (assets/music/m2/record-artwork.png). Nothing else in
  this file changed; geometry and styling live in css/m2-turntable.css.

  Independent of music.html, css/music.css and js/music/songs-player.js.

  2026-10-25 (YouTube mode) — when the element has a youtube-playlist
  attribute, the vinyl graphic is replaced by an official YouTube IFrame
  API player (class YouTubeAudio below) and the existing controls drive
  it: play/pause + power, previous/next, volume, seek ring, speed dial
  (45 = 1.25x), mute (M shortcut). Without the attribute nothing changes:
  the Web Audio synth (VinylAudio) and the record are used as before.
  The player is shown upright, unclipped, at least 200x200 px and above
  every other deck layer, as YouTube's embedding rules require.
*/
(() => {
'use strict';

/* Frontend/ root, derived from this file's URL (js/music/ -> ../../). */
const SCRIPT_URL = document.currentScript && document.currentScript.src;
const fromFrontend = (path) => (SCRIPT_URL ? new URL(`../../${path}`, SCRIPT_URL).href : path);
const STYLESHEET_URL = fromFrontend('css/m2-turntable.css');
const DEFAULT_ARTWORK = fromFrontend('assets/music/m2/record-artwork.png');

const TRACKS = [
  { title: 'Tidal Memory', artist: 'Aster Vale', length: 196, bpm: 94, root: 110 },
  { title: 'Soft Geometry', artist: 'Aster Vale', length: 218, bpm: 88, root: 98 },
  { title: 'Blue Hour Signal', artist: 'Aster Vale', length: 184, bpm: 102, root: 123.47 },
];

const SCALE = [0, 3, 5, 7, 10, 7, 5, 2, 0, 5, 7, 12, 10, 7, 3, 2];

/*
  Per-track record artwork and colour treatment (Groove M2 design).
  `artwork: null` = use the element's `artwork` attribute / default cover.

  Groove M2 pointed Soft Geometry and Blue Hour Signal at two images on
  Manus storage (image-1.webp, image-2.webp) that were not included in
  the export, so they are null here instead of dead links. To enable
  them, save the images into assets/music/m2/ and set, for example:
    artwork: fromFrontend('assets/music/m2/soft-geometry.webp')
*/
const ALBUMS = {
  'Tidal Memory': { artwork: null, color: '#203537', tint: 'rgba(25,45,48,.18)' },
  'Soft Geometry': { artwork: null, color: '#39291f', tint: 'rgba(135,80,43,.24)' },
  'Blue Hour Signal': { artwork: null, color: '#1d2f4f', tint: 'rgba(48,80,145,.24)' },
};

const clock = (seconds) => {
  const safe = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
};

class VinylAudio {
  constructor() {
    this.context = null;
    this.output = null;
    this.track = TRACKS[0];
    this.offset = 0;
    this.startedAt = 0;
    this.nextNoteAt = 0;
    this.beatIndex = 0;
    this.playing = false;
    this.timer = 0;
    this.level = 0.72;
    this.speed = 1;
    this.muted = false; // set by setMuted() (M shortcut, js/shortcuts.js)
  }

  // Output gain for the current volume, or silence while muted. Muting
  // never touches `level`, so the volume slider's value survives a mute.
  targetGain() {
    return this.muted ? 0 : this.level * this.level * 0.48;
  }

  ensureAudio() {
    if (this.context) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error('Web Audio is unavailable in this browser.');
    this.context = new AudioContext();
    this.output = this.context.createGain();
    this.output.gain.value = this.targetGain();
    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 16;
    compressor.ratio.value = 3.2;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.18;
    this.output.connect(compressor);
    compressor.connect(this.context.destination);
  }

  get position() {
    if (!this.playing || !this.context) return this.offset;
    return Math.min(this.track.length, this.offset + (this.context.currentTime - this.startedAt) * this.speed);
  }

  async play(track = this.track, startAt = this.offset) {
    this.ensureAudio();
    await this.context.resume();
    window.clearInterval(this.timer);
    this.track = track;
    this.offset = Math.max(0, Math.min(track.length, startAt));
    this.startedAt = this.context.currentTime;
    this.nextNoteAt = this.context.currentTime + 0.055;
    this.beatIndex = Math.floor(this.offset / (60 / (track.bpm * this.speed)));
    this.playing = true;
    this.timer = window.setInterval(() => this.fillSchedule(), 35);
    this.fillSchedule();
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.position;
    this.playing = false;
    window.clearInterval(this.timer);
    this.timer = 0;
    this.context?.suspend().catch(() => {});
  }

  async seek(seconds) {
    const resume = this.playing;
    const track = this.track;
    this.offset = Math.max(0, Math.min(track.length, seconds));
    if (resume) await this.play(track, this.offset);
  }

  setVolume(value) {
    this.level = Math.max(0, Math.min(1, value));
    if (this.output && this.context) {
      this.output.gain.setTargetAtTime(this.targetGain(), this.context.currentTime, 0.025);
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.output && this.context) {
      this.output.gain.setTargetAtTime(this.targetGain(), this.context.currentTime, 0.025);
    }
  }

  setSpeed(multiplier) {
    const wasPlaying = this.playing;
    const position = this.position;
    const track = this.track;
    this.speed = Math.max(0.5, Math.min(2, multiplier));
    if (wasPlaying) this.play(track, position).catch(() => {});
  }

  stop() {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.playing = false;
    this.offset = 0;
    this.context?.suspend().catch(() => {});
  }

  fillSchedule() {
    if (!this.playing || !this.context) return;
    const beat = 60 / (this.track.bpm * this.speed);
    const horizon = this.context.currentTime + 0.18;
    while (this.nextNoteAt < horizon && this.offset + (this.nextNoteAt - this.startedAt) < this.track.length) {
      this.makeBeat(this.beatIndex, this.nextNoteAt, beat);
      this.beatIndex += 1;
      this.nextNoteAt += beat;
    }
  }

  makeBeat(step, at, beat) {
    const ctx = this.context;
    const root = this.track.root * this.speed;
    const degree = SCALE[step % SCALE.length];
    const note = root * 2 * Math.pow(2, degree / 12);

    this.pluck(note, at, Math.min(0.72, beat * 1.1), step % 4 === 2 ? 0.027 : 0.019);
    if (step % 4 === 0) {
      this.pluck(root * Math.pow(2, -1), at, beat * 1.7, 0.035, 'sine');
      this.kick(at, beat, this.speed);
    }
    if (step % 8 === 0) {
      const chord = [root * 2, root * 2 * Math.pow(2, 7 / 12), root * 4];
      chord.forEach((frequency, index) => this.pad(frequency, at, beat * 7.4, 0.009 - index * 0.001));
    }
    if (step % 2 === 1) this.pluck(note * 2, at, beat * 0.55, 0.006, 'sine');
    if (step % 8 === 6) this.pluck(root * 3, at, beat * 1.2, 0.011, 'triangle');
  }

  pluck(frequency, at, duration, volume, type = 'triangle') {
    const osc = this.context.createOscillator();
    const envelope = this.context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, frequency), at);
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), at + 0.018);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.06, duration));
    osc.connect(envelope);
    envelope.connect(this.output);
    osc.start(at);
    osc.stop(at + Math.max(0.07, duration) + 0.025);
  }

  pad(frequency, at, duration, volume) {
    const osc = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const envelope = this.context.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, at);
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(volume, at + 0.4);
    envelope.gain.setValueAtTime(volume, Math.max(at + 0.45, at + duration - 0.48));
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.output);
    osc.start(at);
    osc.stop(at + duration + 0.04);
  }

  kick(at, beat, rate = 1) {
    const osc = this.context.createOscillator();
    const envelope = this.context.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(118 * rate, at);
    osc.frequency.exponentialRampToValueAtTime(45 * rate, at + Math.min(0.18, beat * 0.5));
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(0.09, at + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + Math.min(0.24, beat * 0.75));
    osc.connect(envelope);
    envelope.connect(this.output);
    osc.start(at);
    osc.stop(at + Math.min(0.25, beat * 0.8));
  }
}

/*
  YouTube IFrame Player API adapter. Exposes the same members the element
  already uses on VinylAudio (play, pause, seek, setVolume, setSpeed,
  setMuted, position, playing, offset, muted), so the element's controls
  work unchanged. Playback never starts on its own: the playlist is only
  cued until the visitor presses Play.
*/
const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
const YT_SKIP_LIMIT = 5; // stop after this many unplayable videos in a row
let youTubeApi = null;

function loadYouTubeApi(timeoutMs = 15000) {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (youTubeApi) return youTubeApi;
  youTubeApi = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === 'function') { try { previous(); } catch (error) { /* not ours */ } }
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => reject(new Error('YouTube IFrame API failed to load'));
    document.head.appendChild(script);
    window.setTimeout(() => reject(new Error('YouTube IFrame API timed out')), timeoutMs);
  });
  return youTubeApi;
}

const playbackError = (statusText) => Object.assign(new Error(statusText), { statusText });

class YouTubeAudio {
  constructor(mount, playlistId, hooks) {
    this.list = playlistId;
    this.hooks = hooks;
    this.player = null;
    this.ready = false;
    this.failed = false;
    this.blocked = false;
    this.state = YT_STATE.UNSTARTED;
    this.playing = false;
    this.wantsPlay = false; // true only after the visitor pressed Play (until Pause)
    this.level = 0.72;
    this.muted = false;
    this.speed = 1;
    this.offset = 0;
    this.pendingSeek = null;
    this.errorsInARow = 0;
    this.videoId = '';
    this.track = { title: 'YouTube playlist', artist: 'YouTube', length: 0 };
    this.failMessage = 'YOUTUBE UNAVAILABLE';
    // YouTube identifies the embedding site from the HTTP Referer; pages
    // opened from disk (file://) send none, so the player would only show
    // Error 153. Only load it on real http(s) addresses.
    if (!/^https?:$/.test(window.location.protocol)) {
      this.failed = true;
      this.failMessage = 'OPEN THE LIVE SITE TO PLAY';
      this.whenReady = Promise.reject(playbackError(this.failMessage));
      this.whenReady.catch(() => {});
      return;
    }
    this.whenReady = loadYouTubeApi()
      .then((YT) => new Promise((resolve) => {
        this.player = new YT.Player(mount, {
          width: '100%',
          height: '100%',
          host: 'https://www.youtube-nocookie.com',
          playerVars: { playsinline: 1, controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3, origin: window.location.origin },
          events: {
            onReady: () => {
              this.ready = true;
              this.player.setVolume(Math.round(this.level * 100));
              if (this.muted) this.player.mute(); else this.player.unMute();
              this.player.setLoop(true); // persists across loads, per the API reference
              this.player.cuePlaylist({ listType: 'playlist', list: this.list, index: 0 });
              resolve();
            },
            onStateChange: (event) => this.onState(event.data),
            onError: (event) => this.onError(event.data),
            onAutoplayBlocked: () => { this.blocked = true; this.hooks.status('PRESS PLAY'); },
          },
        });
      }))
      .catch((error) => {
        this.failed = true;
        this.hooks.unavailable(this.failMessage);
        throw error;
      });
    this.whenReady.catch(() => {});
  }

  onState(state) {
    this.state = state;
    if (state === YT_STATE.PLAYING) {
      this.errorsInARow = 0;
      this.blocked = false;
      this.refreshTrack();
      this.applySpeed();
      if (this.pendingSeek !== null) {
        this.player.seekTo(this.pendingSeek, true);
        this.pendingSeek = null;
      }
      this.setPlaying(true);
    } else if (state === YT_STATE.PAUSED || state === YT_STATE.ENDED) {
      this.setPlaying(false);
    } else if (state === YT_STATE.CUED) {
      this.refreshTrack();
      this.setPlaying(false);
    }
  }

  onError(code) {
    this.errorsInARow += 1;
    if (this.errorsInARow >= YT_SKIP_LIMIT) {
      this.setPlaying(false);
      this.hooks.status('PLAYLIST UNAVAILABLE');
      return;
    }
    // 100 = not found / private, 101 and 150 = embedding not allowed, 2/5 = bad or unplayable request.
    this.hooks.status([100, 101, 150].includes(code) ? 'VIDEO UNAVAILABLE · SKIPPING' : 'PLAYBACK ERROR · SKIPPING');
    // Only keep playing if the visitor asked for playback; otherwise just
    // cue the next video, so an error can never start audio on its own.
    window.setTimeout(() => {
      if (!this.player) return;
      if (this.wantsPlay) this.player.nextVideo(); else this.cueNeighbour(1);
    }, 1200);
  }

  setPlaying(playing) {
    if (this.playing === playing) return;
    this.playing = playing;
    this.hooks.playing(playing);
  }

  refreshTrack() {
    if (!this.player || !this.player.getVideoData) return;
    const data = this.player.getVideoData() || {};
    const length = this.player.getDuration() || 0;
    const changed = data.video_id !== this.videoId;
    this.videoId = data.video_id || this.videoId;
    if (data.title) this.track.title = data.title;
    if (data.author) this.track.artist = data.author.replace(/\s+-\s+Topic$/i, '');
    if (length) this.track.length = length;
    if (changed) this.hooks.track();
  }

  get position() {
    if (this.pendingSeek !== null) return this.pendingSeek;
    if (!this.ready) return 0;
    if (!this.track.length) {
      const length = this.player.getDuration() || 0;
      if (length) this.track.length = length;
    }
    return this.player.getCurrentTime() || 0;
  }

  play() {
    if (this.failed) return Promise.reject(playbackError(this.failMessage));
    if (!this.ready) return this.whenReady.then(() => this.play(), () => Promise.reject(playbackError(this.failMessage)));
    this.blocked = false;
    this.wantsPlay = true;
    this.player.playVideo(); // only ever called from the visitor's Play action
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (this.state === YT_STATE.PLAYING) return resolve();
        if (this.blocked || Date.now() - started > 12000) {
          this.wantsPlay = false;
          return reject(playbackError('PRESS PLAY'));
        }
        window.setTimeout(check, 100);
      };
      check();
    });
  }

  pause() {
    this.wantsPlay = false;
    if (this.ready) this.player.pauseVideo();
    this.setPlaying(false);
  }

  seek(seconds) {
    this.offset = Math.max(0, seconds);
    // seekTo() on a cued or stopped video would start playback, so a seek
    // made before Play is kept and applied when playback starts.
    if (this.ready && [YT_STATE.PLAYING, YT_STATE.PAUSED, YT_STATE.BUFFERING].includes(this.state)) {
      this.pendingSeek = null;
      this.player.seekTo(this.offset, true);
    } else {
      this.pendingSeek = this.offset;
    }
    return Promise.resolve();
  }

  setVolume(value) {
    this.level = Math.max(0, Math.min(1, value));
    if (this.ready) this.player.setVolume(Math.round(this.level * 100));
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (!this.ready) return;
    if (this.muted) this.player.mute(); else this.player.unMute();
  }

  // 33⅓ -> 1x, 45 -> 1.25x. Returns false when the video can't play at 1.25x.
  setSpeed(multiplier) {
    const wanted = multiplier > 1 ? 1.25 : 1;
    if (!this.ready) { this.speed = wanted; return true; }
    const rates = this.player.getAvailablePlaybackRates() || [];
    if (!rates.includes(wanted)) return false;
    this.speed = wanted;
    this.player.setPlaybackRate(wanted);
    return true;
  }

  applySpeed() {
    if (this.speed === 1 || !this.ready) return;
    const rates = this.player.getAvailablePlaybackRates() || [];
    if (rates.includes(this.speed)) {
      if (this.player.getPlaybackRate() !== this.speed) this.player.setPlaybackRate(this.speed);
    } else {
      this.speed = 1;
      this.hooks.speedUnavailable();
    }
  }

  next() { this.step(1); }

  previous() { this.step(-1); }

  step(direction) {
    if (!this.ready) return;
    if (this.playing) {
      if (direction > 0) this.player.nextVideo(); else this.player.previousVideo();
      return;
    }
    this.cueNeighbour(direction);
  }

  // Move to the neighbouring video without playing it.
  cueNeighbour(direction) {
    const count = (this.player.getPlaylist() || []).length;
    const index = this.player.getPlaylistIndex();
    if (!count || index < 0) return;
    this.pendingSeek = null;
    this.player.cuePlaylist({ listType: 'playlist', list: this.list, index: (index + direction + count) % count });
  }
}

class GrooveTurntable extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.audio = new VinylAudio();
    this.trackIndex = 0;
    this.playing = false;
    this.rpm = 33.333;
    this.volume = Number(this.getAttribute('volume') ?? 72);
    this.animationFrame = 0;
    this.seekPointer = false;
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="${STYLESHEET_URL}" />
      <div class="deck" part="deck" aria-label="Groove custom digital turntable">
        <div class="deck-glaze"></div>
        <div class="brand-mark" aria-label="Groove">
          <svg class="brand-symbol" viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="12.3" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="15" cy="15" r="7.7" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="15" cy="15" r="2" fill="currentColor"/></svg>
          <span>GROOVE</span>
        </div>

        <div class="platter" part="platter">
          <div class="platter-lip"></div>
          <div class="record-bed">
            <div class="record" part="record">
              <img class="cover-art" src="${DEFAULT_ARTWORK}" alt="" draggable="false" />
              <div class="cover-shade"></div>
              <div class="record-grooves"></div>
              <div class="record-sheen"></div>
              <div class="pressing-stamp" aria-hidden="true">GROOVE · SIDE A</div>
              <div class="spindle" aria-hidden="true"><i></i></div>
            </div>
          </div>
          <div class="progress-track" aria-hidden="true"></div>
          <div class="progress-light" aria-hidden="true"></div>
          <div class="seek-hit" part="seek" role="slider" tabindex="0" aria-label="Record position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="0:00 of 3:16"></div>
        </div>

        <button class="power-toggle" type="button" aria-label="Turntable power and playback status" title="Turntable power and playback status">
          <span class="switch-housing"><span class="switch-knob"></span><span class="switch-mark"></span></span>
        </button>
        <button class="speed-dial" type="button" aria-label="Switch playback speed to 45 RPM" aria-pressed="false" title="Switch between 33⅓ and 45 RPM">
          <span class="dial-face"><span class="dial-light"></span><span class="dial-pin"></span></span>
        </button>
        <div class="speed-readout" aria-live="polite"><span class="speed-option is-active">33⅓</span><span class="speed-option" aria-hidden="true">45</span></div>

        <div class="tonearm" part="tonearm" aria-hidden="true">
          <div class="tonearm-well"><span class="well-ring"></span><span class="well-dimple"></span></div>
          <div class="tonearm-pivot"><span class="pivot-screw"></span></div>
          <div class="counterweight"><span></span></div>
          <div class="arm-tube"><i></i></div>
          <div class="arm-collar"></div>
          <div class="headshell"><span class="head-screw screw-one"></span><span class="head-screw screw-two"></span><i class="stylus"></i></div>
        </div>

        <label class="volume-panel">
          <span class="volume-label">VOL</span>
          <input class="volume-slider" type="range" min="0" max="100" step="1" value="72" aria-label="Volume" />
          <span class="volume-tick" aria-hidden="true"></span>
        </label>

        <div class="track-strip" aria-live="polite">
          <span class="artist-name">ASTER VALE</span>
          <span class="strip-rule"></span>
          <span class="track-name">Tidal Memory</span>
        </div>

        <button class="play-button" type="button" aria-label="Play Tidal Memory">
          <svg class="play-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M6.3 3.8c0-.72.78-1.16 1.4-.79l9.08 5.38a1.88 1.88 0 0 1 0 3.23L7.7 17a.92.92 0 0 1-1.4-.8V3.8Z" fill="currentColor"/></svg>
          <svg class="pause-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 4.3c0-.5.4-.9.9-.9h2.1c.5 0 .9.4.9.9v11.4c0 .5-.4.9-.9.9H6.4a.9.9 0 0 1-.9-.9V4.3Zm6 0c0-.5.4-.9.9-.9h2.1c.5 0 .9.4.9.9v11.4c0 .5-.4.9-.9.9h-2.1a.9.9 0 0 1-.9-.9V4.3Z" fill="currentColor"/></svg>
        </button>
        <div class="transport-strip">
          <button class="skip-button previous-button" type="button" aria-label="Previous track" title="Previous track">
            <svg viewBox="0 0 24 18" aria-hidden="true"><path d="M3 8.1a1.05 1.05 0 0 1 0 1.8l8.4 5.1a1.04 1.04 0 0 0 1.6-.9V3.9a1.04 1.04 0 0 0-1.6-.9L3 8.1Z" fill="currentColor"/><path d="M12 8.1a1.05 1.05 0 0 1 0 1.8l8.4 5.1a1.04 1.04 0 0 0 1.6-.9V3.9a1.04 1.04 0 0 0-1.6-.9L12 8.1Z" fill="currentColor"/><path d="M2 3v12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
          <div class="time-readout"><span class="current-time">0:00</span><span class="time-divider"> / </span><span class="duration">3:16</span></div>
          <button class="skip-button next-button" type="button" aria-label="Next track" title="Next track">
            <svg viewBox="0 0 24 18" aria-hidden="true"><path d="M21 9.9a1.05 1.05 0 0 1 0-1.8l-8.4-5.1a1.04 1.04 0 0 0-1.6.9v10.2a1.04 1.04 0 0 0 1.6.9l8.4-5.1Z" fill="currentColor"/><path d="M12 9.9a1.05 1.05 0 0 1 0-1.8L3.6 3a1.04 1.04 0 0 0-1.6.9v10.2a1.04 1.04 0 0 0 1.6.9l8.4-5.1Z" fill="currentColor"/><path d="M22 3v12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="status-line" aria-live="polite"><span class="status-led"></span><span class="status-text">READY · SIDE A</span></div>
        <div class="deck-screw screw-top" aria-hidden="true"></div><div class="deck-screw screw-bottom" aria-hidden="true"></div>
      </div>
    `;
  }

  connectedCallback() {
    if (this.ready) return;
    this.ready = true;
    this.nodes = Object.fromEntries([
      'deck', 'cover-art', 'seek-hit', 'progress-light', 'play-button', 'power-toggle', 'speed-dial', 'speed-readout',
      'volume-slider', 'artist-name', 'track-name', 'current-time', 'duration', 'tonearm', 'status-text', 'status-led',
    ].map((className) => [className, this.shadowRoot.querySelector(`.${className}`)]));

    this.volume = Math.max(0, Math.min(100, this.volume));
    this.nodes['volume-slider'].value = String(this.volume);
    this.audio.setVolume(this.volume / 100);
    this.nodes['cover-art'].src = this.getAttribute('artwork') || DEFAULT_ARTWORK;
    this.nodes['cover-art'].addEventListener('error', () => {
      if (this.nodes['cover-art'].getAttribute('src') === DEFAULT_ARTWORK) return;
      this.nodes['cover-art'].src = DEFAULT_ARTWORK;
    });

    this.nodes['play-button'].addEventListener('click', () => this.togglePlayback());
    this.nodes['power-toggle'].addEventListener('click', () => this.togglePlayback());
    this.nodes['speed-dial'].addEventListener('click', () => this.toggleSpeed());
    this.shadowRoot.querySelector('.previous-button').addEventListener('click', () => this.previous());
    this.shadowRoot.querySelector('.next-button').addEventListener('click', () => this.next());
    this.nodes['volume-slider'].addEventListener('input', (event) => this.changeVolume(Number(event.target.value)));
    this.nodes['seek-hit'].addEventListener('pointerdown', (event) => this.beginSeek(event));
    this.nodes['seek-hit'].addEventListener('pointermove', (event) => { if (this.seekPointer) this.scrubAt(event); });
    this.nodes['seek-hit'].addEventListener('pointerup', (event) => this.endSeek(event));
    this.nodes['seek-hit'].addEventListener('pointercancel', () => { this.seekPointer = false; });
    this.nodes['seek-hit'].addEventListener('keydown', (event) => this.seekByKeyboard(event));
    const playlist = this.getAttribute('youtube-playlist');
    if (playlist) this.useYouTube(playlist);
    this.updateTrack();
    this.updateSpeed();
    this.updateView();
    if (this.yt && this.yt.failed) this.nodes['status-text'].textContent = this.yt.failMessage;
  }

  disconnectedCallback() {
    window.cancelAnimationFrame(this.animationFrame);
    if (this.audio.playing) this.audio.pause();
  }

  // YouTube mode: the vinyl graphic is hidden (CSS) and an IFrame player is
  // mounted in a screen above the platter; this.audio becomes the adapter.
  useYouTube(playlist) {
    if (!/^https?:$/.test(window.location.protocol)) {
      // Opened from disk: keep the vinyl and say where to play (see YouTubeAudio).
      this.yt = new YouTubeAudio(null, playlist, {});
      this.audio.pause();
      this.audio = this.yt;
      this.nodes['deck'].classList.add('yt-unavailable');
      return;
    }
    const screen = document.createElement('div');
    screen.className = 'yt-screen';
    screen.setAttribute('part', 'screen');
    const mount = document.createElement('div');
    screen.appendChild(mount);
    this.nodes['deck'].appendChild(screen);
    this.audio.pause();
    this.yt = new YouTubeAudio(mount, playlist, {
      playing: (playing) => this.syncPlaying(playing),
      track: () => {
        this.updateTrack();
        this.dispatchEvent(new CustomEvent('trackchange', { detail: { track: this.currentTrack }, bubbles: true, composed: true }));
      },
      status: (text) => { this.nodes['status-text'].textContent = text; },
      speedUnavailable: () => {
        this.rpm = 33.333;
        this.updateSpeed();
        this.nodes['status-text'].textContent = 'SPEED UNAVAILABLE';
      },
      unavailable: (message) => {
        this.nodes['deck'].classList.add('yt-unavailable');
        this.nodes['status-text'].textContent = message;
      },
    });
    this.audio = this.yt;
    this.audio.setVolume(this.volume / 100);
  }

  // Playback state reported by the YouTube player itself (end of a video,
  // buffering, a click inside the video, a skipped error).
  syncPlaying(playing) {
    if (playing === this.playing) return;
    this.playing = playing;
    this.toggleAttribute('playing', playing);
    if (playing) this.animateProgress(); else window.cancelAnimationFrame(this.animationFrame);
    this.updateView();
    this.dispatchEvent(new CustomEvent('playstatechange', { detail: { playing }, bubbles: true, composed: true }));
  }

  get currentTrack() { return this.yt ? this.yt.track : TRACKS[this.trackIndex]; }
  get currentTime() { return this.audio.position; }

  // Public mute switch used by the global M shortcut (js/shortcuts.js).
  setMuted(muted) {
    this.audio.setMuted(muted);
  }

  get muted() {
    return this.audio.muted;
  }

  async togglePlayback() {
    if (this.playing) this.pause();
    else await this.play();
  }

  async play() {
    try {
      if (this.currentTime >= this.currentTrack.length) this.audio.offset = 0;
      await this.audio.play(this.currentTrack, this.audio.offset);
      if (!this.playing) {
        this.playing = true;
        this.setAttribute('playing', '');
        this.dispatchEvent(new CustomEvent('playstatechange', { detail: { playing: true }, bubbles: true, composed: true }));
      }
      this.animateProgress();
      this.updateView();
    } catch (error) {
      this.nodes['status-text'].textContent = (error && error.statusText) || 'AUDIO UNAVAILABLE';
      this.dispatchEvent(new CustomEvent('playererror', { detail: { error }, bubbles: true, composed: true }));
      if (!(error && error.statusText)) console.error(error);
    }
  }

  pause() {
    this.audio.pause();
    this.playing = false;
    this.removeAttribute('playing');
    window.cancelAnimationFrame(this.animationFrame);
    this.updateView();
    this.dispatchEvent(new CustomEvent('playstatechange', { detail: { playing: false }, bubbles: true, composed: true }));
  }

  animateProgress() {
    window.cancelAnimationFrame(this.animationFrame);
    const paint = () => {
      if (!this.isConnected || !this.playing) return;
      let position = this.audio.position;
      if (!this.yt && position >= this.currentTrack.length) {
        this.trackIndex = (this.trackIndex + 1) % TRACKS.length;
        this.audio.pause();
        this.audio.offset = 0;
        this.updateTrack();
        this.audio.play(this.currentTrack, 0).then(() => this.animateProgress()).catch((error) => console.error(error));
        position = 0;
        this.dispatchEvent(new CustomEvent('trackchange', { detail: { track: this.currentTrack }, bubbles: true, composed: true }));
      }
      this.paintProgress(position);
      this.animationFrame = window.requestAnimationFrame(paint);
    };
    this.animationFrame = window.requestAnimationFrame(paint);
  }

  paintProgress(position = this.currentTime) {
    const track = this.currentTrack;
    const fraction = track.length > 0 ? Math.max(0, Math.min(1, position / track.length)) : 0;
    const amount = `${(fraction * 100).toFixed(2)}%`;
    this.nodes['progress-light'].style.setProperty('--progress', amount);
    this.nodes['current-time'].textContent = clock(position);
    this.nodes['duration'].textContent = clock(track.length);
    this.nodes['seek-hit'].setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
    this.nodes['seek-hit'].setAttribute('aria-valuetext', `${clock(position)} of ${clock(track.length)}`);
    if (this.playing || position > 0) this.nodes['tonearm'].dataset.engaged = 'true';
    const armAngle = this.nodes['tonearm'].dataset.engaged === 'true' ? `${31.2 + fraction * 14.7}deg` : '0deg';
    this.nodes['tonearm'].style.setProperty('--arm-angle', armAngle);
  }

  updateTrack() {
    const track = this.currentTrack;
    const album = ALBUMS[track.title] || ALBUMS['Tidal Memory'];
    const artwork = album.artwork || this.getAttribute('artwork') || DEFAULT_ARTWORK;
    if (this.nodes['cover-art'].getAttribute('src') !== artwork) this.nodes['cover-art'].src = artwork;
    this.nodes['deck'].style.setProperty('--album-color', album.color);
    this.nodes['deck'].style.setProperty('--album-tint', album.tint);
    this.nodes['artist-name'].textContent = track.artist.toUpperCase();
    this.nodes['track-name'].textContent = track.title;
    this.nodes['play-button'].setAttribute('aria-label', `${this.playing ? 'Pause' : 'Play'} ${track.title}`);
    this.nodes['duration'].textContent = clock(track.length);
    this.paintProgress(this.audio.position);
  }

  updateView() {
    this.nodes['deck'].classList.toggle('is-playing', this.playing);
    this.nodes['play-button'].classList.toggle('is-playing', this.playing);
    this.nodes['power-toggle'].setAttribute('aria-pressed', String(this.playing));
    this.nodes['play-button'].setAttribute('aria-label', `${this.playing ? 'Pause' : 'Play'} ${this.currentTrack.title}`);
    this.nodes['status-text'].textContent = this.playing ? `PLAYING · ${this.currentTrack.title.toUpperCase()}` : (this.currentTime > 0 ? '' : 'READY · SIDE A');
    this.nodes['status-led'].classList.toggle('lit', this.playing);
    this.nodes['deck'].style.setProperty('--rpm', String(this.rpm));
    this.nodes['deck'].style.setProperty('--spin-duration', `${60 / this.rpm}s`);
    this.paintProgress(this.currentTime);
  }

  toggleSpeed() {
    const rpm = this.rpm === 33.333 ? 45 : 33.333;
    if (this.audio.setSpeed(rpm / 33.333) === false) {
      this.nodes['status-text'].textContent = 'SPEED UNAVAILABLE';
      return;
    }
    this.rpm = rpm;
    this.updateSpeed();
    this.dispatchEvent(new CustomEvent('speedchange', { detail: { rpm: this.rpm }, bubbles: true, composed: true }));
  }

  updateSpeed() {
    const fast = this.rpm === 45;
    const speedOption = (label, active) => `<span class="speed-option${active ? ' is-active' : ''}"${active ? '' : ' aria-hidden="true"'}>${label}</span>`;
    this.nodes['speed-readout'].innerHTML = speedOption('33⅓', !fast) + speedOption('45', fast);
    this.nodes['speed-dial'].setAttribute('aria-pressed', String(fast));
    this.nodes['speed-dial'].setAttribute('aria-label', `Switch playback speed to ${fast ? '33⅓' : '45'} RPM`);
    this.nodes['deck'].style.setProperty('--rpm', String(this.rpm));
    this.nodes['deck'].style.setProperty('--spin-duration', `${60 / this.rpm}s`);
  }

  changeVolume(value) {
    this.volume = Math.max(0, Math.min(100, value));
    this.audio.setVolume(this.volume / 100);
    this.dispatchEvent(new CustomEvent('volumechange', { detail: { volume: this.volume }, bubbles: true, composed: true }));
  }

  async selectTrack(index) {
    const wasPlaying = this.playing;
    if (this.playing) this.pause();
    this.trackIndex = (index + TRACKS.length) % TRACKS.length;
    this.audio.offset = 0;
    this.audio.track = this.currentTrack;
    this.updateTrack();
    this.updateView();
    this.dispatchEvent(new CustomEvent('trackchange', { detail: { track: this.currentTrack }, bubbles: true, composed: true }));
    if (wasPlaying) await this.play();
  }

  async next() {
    if (this.yt) return this.yt.next();
    await this.selectTrack(this.trackIndex + 1);
  }

  async previous() {
    if (this.currentTime > 4) {
      await this.audio.seek(0);
      this.paintProgress(0);
      this.dispatchEvent(new CustomEvent('seek', { detail: { seconds: 0 }, bubbles: true, composed: true }));
      return;
    }
    if (this.yt) return this.yt.previous();
    await this.selectTrack(this.trackIndex - 1);
  }

  beginSeek(event) {
    if (event.button !== undefined && event.button !== 0) return;
    this.seekPointer = true;
    this.nodes['seek-hit'].setPointerCapture?.(event.pointerId);
    this.scrubAt(event);
  }

  endSeek(event) {
    if (!this.seekPointer) return;
    this.scrubAt(event);
    this.seekPointer = false;
    this.nodes['seek-hit'].releasePointerCapture?.(event.pointerId);
  }

  scrubAt(event) {
    const bounds = this.nodes['seek-hit'].getBoundingClientRect();
    const dx = event.clientX - (bounds.left + bounds.width / 2);
    const dy = event.clientY - (bounds.top + bounds.height / 2);
    let degrees = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
    const fraction = degrees / 360;
    const seconds = fraction * this.currentTrack.length;
    this.audio.seek(seconds);
    this.paintProgress(seconds);
    this.dispatchEvent(new CustomEvent('seek', { detail: { seconds }, bubbles: true, composed: true }));
  }

  seekByKeyboard(event) {
    let next = this.currentTime;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += 5;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= 5;
    else if (event.key === 'PageUp') next += 15;
    else if (event.key === 'PageDown') next -= 15;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = this.currentTrack.length;
    else return;
    event.preventDefault();
    this.audio.seek(next);
    this.paintProgress(next);
    this.dispatchEvent(new CustomEvent('seek', { detail: { seconds: next }, bubbles: true, composed: true }));
  }
}

if (!customElements.get('groove-turntable')) customElements.define('groove-turntable', GrooveTurntable);

})();
