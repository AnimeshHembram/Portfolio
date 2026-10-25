// ---------------------------------------------------------------------
// Global keyboard shortcuts — F (fullscreen), M (mute), Backspace (back)
// ---------------------------------------------------------------------
// Loaded as a plain classic <script defer> on every linked page
// (index/day/night, ab2, infinite-gallery, m2, music, Radio/radio).
// One window-level keydown listener, guarded so a second copy of this
// file can never add a second listener.
//
//   F          Toggle fullscreen (Fullscreen API, incl. Safari's webkit
//              prefix). Fails gracefully where it isn't allowed.
//   M          Mute / unmute this page's existing audio. Pages that have
//              audio say so with data-audio on this script tag; on any
//              other page M does nothing. The choice persists for the
//              rest of the tab session (sessionStorage), so muting on
//              Music keeps Radio muted too.
//   Backspace  history.back() — only when the browser reports a previous
//              page in this tab, and never while focus is on a text
//              field, form control, button or other widget.
//
// Shortcuts are ignored while typing (input/textarea/select/editable),
// with Ctrl/Cmd/Alt/Shift held (browser shortcuts stay untouched), during
// IME composition, on auto-repeat, and when another handler has already
// called preventDefault().
//
// Audio integration (no new audio is ever created here):
//   - <audio>/<video> elements: their own `muted` property.
//   - Media created in code and never added to the page (the Radio app's
//     `new Audio(url)`): HTMLMediaElement.prototype.play is wrapped once
//     so any element that starts playing is remembered and given the
//     current mute state. play() itself behaves exactly as before.
//   - <groove-turntable> (Web Audio, m2.html): its setMuted() method.
(function () {
  if (window.__portfolioShortcuts) return;
  window.__portfolioShortcuts = true;

  var script = document.currentScript;
  var PAGE_HAS_AUDIO = !!(script && script.hasAttribute("data-audio"));
  var STORAGE_KEY = "portfolio:muted";
  var media = new Set(); // media elements seen on this page

  // Toast stylesheet lives next to this file (css/shortcuts.css), resolved
  // from this script's own URL so it also works from Radio/radio.html.
  if (script && script.src) {
    try {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = new URL("../css/shortcuts.css", script.src).href;
      document.head.appendChild(link);
    } catch (err) {
      /* toast just renders unstyled-but-hidden; shortcuts still work */
    }
  }

  // --- Mute state -----------------------------------------------------
  function readMuted() {
    try {
      return window.sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch (err) {
      return muted; // storage blocked — keep the in-memory value
    }
  }
  var muted = false;
  muted = readMuted();

  function saveMuted() {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
    } catch (err) {
      /* storage unavailable — mute still applies to this page */
    }
  }

  function remember(el) {
    if (!el || media.has(el)) return;
    media.add(el);
    if (muted) el.muted = true;
  }

  var proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  if (proto && typeof proto.play === "function" && !proto.play.__portfolioShortcuts) {
    var originalPlay = proto.play;
    var wrappedPlay = function () {
      remember(this);
      return originalPlay.apply(this, arguments);
    };
    wrappedPlay.__portfolioShortcuts = true;
    proto.play = wrappedPlay;
  }
  // Catches autoplaying elements that start without a play() call.
  document.addEventListener(
    "play",
    function (e) {
      if (e.target && e.target instanceof window.HTMLMediaElement) remember(e.target);
    },
    true
  );

  function applyMute() {
    Array.prototype.forEach.call(document.querySelectorAll("audio, video"), remember);
    media.forEach(function (el) {
      el.muted = muted;
    });
    Array.prototype.forEach.call(document.querySelectorAll("groove-turntable"), function (t) {
      if (typeof t.setMuted === "function") t.setMuted(muted);
    });
  }

  function pageHasAudio() {
    return PAGE_HAS_AUDIO || media.size > 0 || !!document.querySelector("audio, video");
  }

  // Re-apply a muted state carried over from another page once the page's
  // players exist. Deferred scripts (this one included) run while
  // readyState is already "interactive" but before DOMContentLoaded, so
  // wait for that event — and for <groove-turntable> to be defined, since
  // its script runs after this one. Applying is idempotent.
  function applyStoredState() {
    if (muted && pageHasAudio()) applyMute();
  }
  applyStoredState();
  document.addEventListener("DOMContentLoaded", applyStoredState);
  window.addEventListener("load", applyStoredState);
  if (window.customElements && document.querySelector("groove-turntable")) {
    window.customElements.whenDefined("groove-turntable").then(applyStoredState);
  }

  function toggleMute() {
    if (!pageHasAudio()) return; // no audio here — do nothing at all
    muted = !readMuted();
    saveMuted();
    applyMute();
    toast(muted ? "Sound muted" : "Sound on", muted ? "muted" : "sound");
  }

  // --- Fullscreen -----------------------------------------------------
  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function fullscreenFailed() {
    toast("Full screen isn't available here", "fullscreen-off");
  }

  function settle(result, onDone) {
    if (result && typeof result.then === "function") {
      result.then(onDone, fullscreenFailed);
    } else {
      onDone();
    }
  }

  function toggleFullscreen() {
    var root = document.documentElement;
    try {
      if (fullscreenElement()) {
        var exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (!exit) return;
        settle(exit.call(document), function () {
          toast("Exited full screen", "fullscreen-off");
        });
      } else {
        var request = root.requestFullscreen || root.webkitRequestFullscreen;
        var enabled = document.fullscreenEnabled || document.webkitFullscreenEnabled;
        if (!request || enabled === false) {
          fullscreenFailed();
          return;
        }
        settle(request.call(root), function () {
          toast("Full screen", "fullscreen");
        });
      }
    } catch (err) {
      fullscreenFailed();
    }
  }

  // --- Back -----------------------------------------------------------
  function canGoBack() {
    if (window.navigation && typeof window.navigation.canGoBack === "boolean") {
      return window.navigation.canGoBack;
    }
    return window.history.length > 1;
  }

  // --- Toast ----------------------------------------------------------
  var toastEl = null;
  var toastTimer = 0;

  function toast(message, icon) {
    if (!document.body) return;
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "shortcut-toast";
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      document.body.appendChild(toastEl);
    }
    toastEl.setAttribute("data-icon", icon || "");
    toastEl.textContent = message;
    // restart the fade if a toast is already showing
    toastEl.classList.remove("is-visible");
    void toastEl.offsetWidth;
    toastEl.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toastEl.classList.remove("is-visible");
    }, 1400);
  }

  // --- Focus / typing guards -----------------------------------------
  var NON_TEXT_INPUTS = /^(button|submit|reset|checkbox|radio|file|image|color|range)$/;

  // The element that really has focus, even inside a shadow root
  // (e.g. the turntable's volume slider).
  function focusTarget(e) {
    var path = e.composedPath ? e.composedPath() : null;
    return (path && path[0]) || e.target;
  }

  function isTyping(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    var tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag === "INPUT") return !NON_TEXT_INPUTS.test((el.type || "text").toLowerCase());
    var role = el.getAttribute("role");
    return role === "textbox" || role === "searchbox" || role === "combobox";
  }

  // Backspace is stricter: any control or widget with focus wins.
  var CONTROL_SELECTOR =
    'input, textarea, select, button, [contenteditable]:not([contenteditable="false"]), ' +
    '[role="button"], [role="textbox"], [role="searchbox"], [role="combobox"], [role="slider"], ' +
    '[role="spinbutton"], [role="listbox"], [role="menu"], [role="menuitem"], [role="tab"], ' +
    '[role="grid"], [role="tree"]';

  function isOnControl(el) {
    if (!el || el.nodeType !== 1) return false;
    if (isTyping(el)) return true;
    return !!(el.closest && el.closest(CONTROL_SELECTOR));
  }

  function keyIs(e, letter, code) {
    var k = e.key || "";
    if (k.length === 1) return k.toLowerCase() === letter;
    return e.code === code; // non-Latin layouts
  }

  window.addEventListener("keydown", function (e) {
    if (e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.isComposing || e.keyCode === 229) return;

    var target = focusTarget(e);

    if (e.key === "Backspace") {
      if (isOnControl(target) || isOnControl(document.activeElement)) return;
      if (!canGoBack()) return;
      e.preventDefault();
      window.history.back();
      return;
    }

    if (e.repeat || isTyping(target)) return;

    if (keyIs(e, "f", "KeyF")) {
      e.preventDefault();
      toggleFullscreen();
    } else if (keyIs(e, "m", "KeyM")) {
      if (!pageHasAudio()) return;
      e.preventDefault();
      toggleMute();
    }
  });
})();
