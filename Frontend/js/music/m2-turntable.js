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
  }

  ensureAudio() {
    if (this.context) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error('Web Audio is unavailable in this browser.');
    this.context = new AudioContext();
    this.output = this.context.createGain();
    this.output.gain.value = this.level * this.level * 0.48;
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
      this.output.gain.setTargetAtTime(this.level * this.level * 0.48, this.context.currentTime, 0.025);
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
    this.updateTrack();
    this.updateSpeed();
    this.updateView();
  }

  disconnectedCallback() {
    window.cancelAnimationFrame(this.animationFrame);
    if (this.audio.playing) this.audio.pause();
  }

  get currentTrack() { return TRACKS[this.trackIndex]; }
  get currentTime() { return this.audio.position; }

  async togglePlayback() {
    if (this.playing) this.pause();
    else await this.play();
  }

  async play() {
    try {
      if (this.currentTime >= this.currentTrack.length) this.audio.offset = 0;
      await this.audio.play(this.currentTrack, this.audio.offset);
      this.playing = true;
      this.setAttribute('playing', '');
      this.dispatchEvent(new CustomEvent('playstatechange', { detail: { playing: true }, bubbles: true, composed: true }));
      this.animateProgress();
      this.updateView();
    } catch (error) {
      this.nodes['status-text'].textContent = 'AUDIO UNAVAILABLE';
      this.dispatchEvent(new CustomEvent('playererror', { detail: { error }, bubbles: true, composed: true }));
      console.error(error);
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
      if (position >= this.currentTrack.length) {
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
    const fraction = Math.max(0, Math.min(1, position / track.length));
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
    this.rpm = this.rpm === 33.333 ? 45 : 33.333;
    this.audio.setSpeed(this.rpm / 33.333);
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

  async next() { await this.selectTrack(this.trackIndex + 1); }

  async previous() {
    if (this.currentTime > 4) {
      await this.audio.seek(0);
      this.paintProgress(0);
      this.dispatchEvent(new CustomEvent('seek', { detail: { seconds: 0 }, bubbles: true, composed: true }));
      return;
    }
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
