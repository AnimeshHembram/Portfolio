(function () {
  var canvas = document.getElementById("auroraFx");
  if (!canvas) return; // day desktop markup not present — stay safe
  var ctx = canvas.getContext("2d");
  var reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Subtle morning aurora overlay for the DAY desktop, active 06:00–07:59
  // local time only. The canvas background is left transparent (see
  // draw(), which clears rather than fills) so the existing terracotta →
  // mauve → periwinkle gradient, and every icon/widget/dock element
  // layered on top of this canvas, are completely unaffected — this only
  // adds translucent light bands, it never covers anything.
  //
  // For manual testing: ?fx=on forces the effect on regardless of the
  // clock, ?fx=off forces it off — same override pattern as index.html's
  // existing ?mode=day/night. No override → the 06:00–07:59 window below
  // decides.
  var fxOverride = new URLSearchParams(window.location.search).get("fx");

  var palette = "aurora",
    bands = 4,
    speed = 0.45,
    intensity = 0.4; // toned down from the original 0.85 — reads as a light
    // morning-glow accent rather than a repaint of the desktop background
  var w, h, t0 = performance.now();
  var isOn = false; // logical state: within the morning window (or override)
  var rafId = null;

  function fit() {
    var d = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * d;
    canvas.height = h * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h); // transparent — the day gradient shows through
    ctx.globalCompositeOperation = "lighter"; // stacked light adds, never covers
    var base = { aurora: 140, dusk: 262, mint: 165 }[palette];
    for (var b = 0; b < bands; b++) {
      var hue = base + b * 34,
        yc = h * (0.32 + 0.13 * b),
        amp = h * 0.1 * intensity,
        phase = t * speed + b * 1.7;
      ctx.beginPath();
      for (var x = 0; x <= w; x += 6) {
        var y =
          yc +
          Math.sin(x * 0.006 + phase) * amp +
          Math.sin(x * 0.013 - phase * 0.7) * amp * 0.5;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      var g = ctx.createLinearGradient(0, yc - amp, 0, h);
      g.addColorStop(0, "hsla(" + hue + ",90%,62%,0)");
      g.addColorStop(0.16, "hsla(" + hue + ",90%,62%," + 0.45 * intensity + ")");
      g.addColorStop(1, "hsla(" + (hue + 30) + ",90%,55%,0)");
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function renderFrame() {
    draw((performance.now() - t0) / 1000);
    if (isOn && !reduceMotion && !document.hidden) {
      rafId = requestAnimationFrame(renderFrame);
    } else {
      rafId = null;
    }
  }

  function turnOn() {
    if (isOn) return;
    isOn = true;
    canvas.style.display = "block";
    fit();
    t0 = performance.now();
    if (reduceMotion) {
      draw(0); // one static frame, no animation loop
    } else if (!document.hidden) {
      rafId = requestAnimationFrame(renderFrame);
    }
  }

  function turnOff() {
    if (!isOn) return;
    isOn = false;
    canvas.style.display = "none";
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function computeShouldRun() {
    if (fxOverride === "on") return true;
    if (fxOverride === "off") return false;
    var hour = new Date().getHours();
    return hour >= 6 && hour < 8; // 06:00–07:59 local time
  }

  function applyState() {
    if (computeShouldRun()) turnOn();
    else turnOff();
  }

  applyState();

  window.addEventListener("resize", function () {
    if (isOn) fit();
  });

  // Live update, mirroring index.html's day/night boundary approach:
  // only needed when no ?fx= override is pinning the state.
  if (!fxOverride) {
    (function scheduleNextCheck() {
      function msUntilNextBoundary() {
        var now = new Date();
        var next = new Date(now);
        var h = now.getHours();
        if (h < 6) {
          next.setHours(6, 0, 0, 0);
        } else if (h < 8) {
          next.setHours(8, 0, 0, 0);
        } else {
          next.setDate(next.getDate() + 1);
          next.setHours(6, 0, 0, 0);
        }
        return next.getTime() - now.getTime();
      }
      window.setTimeout(function () {
        applyState();
        scheduleNextCheck();
      }, msUntilNextBoundary() + 1000);
    })();
  }

  // Pause the animation loop while the tab is hidden (saves CPU/battery);
  // resume — and re-check the time window, in case it changed while
  // backgrounded — when it becomes visible again.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    } else {
      applyState();
      if (isOn && !reduceMotion && !rafId) {
        t0 = performance.now();
        rafId = requestAnimationFrame(renderFrame);
      }
    }
  });
})();
