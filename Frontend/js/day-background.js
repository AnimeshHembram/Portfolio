(function () {
  var canvas = document.getElementById("webgl-canvas");
  if (!canvas) return; // day desktop markup not present — stay safe

  // Same visual/shader as the approved reference, exactly as written:
  // a full-viewport WebGL glow line following a sine wave, with a
  // chromatic (R/G/B) offset driven by `distortion`. This is a fresh
  // implementation in plain WebGL (no Three.js, no new dependency) —
  // the GLSL below is unchanged from the reference; only the JS that
  // sets up the WebGL context is written from scratch.
  var gl = canvas.getContext("webgl");
  if (!gl) {
    // No WebGL support — hide the canvas so the .desktop--day gradient
    // (still declared in CSS) shows through as the fallback.
    canvas.style.display = "none";
    return;
  }

  var reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) {
    // Same fallback as the no-WebGL case: hide the canvas, let the
    // static CSS gradient be the background.
    canvas.style.display = "none";
    return;
  }

  var vertexShaderSrc = [
    "attribute vec3 position;",
    "void main() {",
    "  gl_Position = vec4(position, 1.0);",
    "}"
  ].join("\n");

  var fragmentShaderSrc = [
    "precision highp float;",
    "uniform vec2 resolution;",
    "uniform float time;",
    "uniform float xScale;",
    "uniform float yScale;",
    "uniform float distortion;",
    "void main() {",
    "  vec2 p = (gl_FragCoord.xy * 2.0 - resolution) / min(resolution.x, resolution.y);",
    "  float d = length(p) * distortion;",
    "  float rx = p.x * (1.0 + d);",
    "  float gx = p.x;",
    "  float bx = p.x * (1.0 - d);",
    "  float r = 0.05 / abs(p.y + sin((rx + time) * xScale) * yScale);",
    "  float g = 0.05 / abs(p.y + sin((gx + time) * xScale) * yScale);",
    "  float b = 0.05 / abs(p.y + sin((bx + time) * xScale) * yScale);",
    "  gl_FragColor = vec4(r, g, b, 1.0);",
    "}"
  ].join("\n");

  function fit() {
    var d = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.clientWidth * d;
    canvas.height = canvas.clientHeight * d;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  fit();

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }

  var vertexShader = compile(gl.VERTEX_SHADER, vertexShaderSrc);
  var fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentShaderSrc);
  var program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.useProgram(program);

  // Same fullscreen-quad vertex data as the reference's _setMesh().
  var position = new Float32Array([
    -1.0, -1.0, 0.0,
     1.0, -1.0, 0.0,
    -1.0,  1.0, 0.0,
     1.0, -1.0, 0.0,
    -1.0,  1.0, 0.0,
     1.0,  1.0, 0.0
  ]);
  var buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, position, gl.STATIC_DRAW);
  var positionLoc = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(positionLoc);
  gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0);

  // Same four uniforms and same starting values as the reference's Mesh
  // constructor (xScale 1.0, yScale 0.5, distortion 0.050).
  var uResolution = gl.getUniformLocation(program, "resolution");
  var uTime = gl.getUniformLocation(program, "time");
  var uXScale = gl.getUniformLocation(program, "xScale");
  var uYScale = gl.getUniformLocation(program, "yScale");
  var uDistortion = gl.getUniformLocation(program, "distortion");

  gl.uniform1f(uXScale, 1.0);
  gl.uniform1f(uYScale, 0.5);
  gl.uniform1f(uDistortion, 0.05);

  // Same clearColor as the reference's renderParam (0x666666).
  gl.clearColor(0x66 / 255, 0x66 / 255, 0x66 / 255, 1.0);

  var time = 0.0;
  var rafId = null;

  function renderFrame() {
    gl.uniform2f(uResolution, canvas.width, canvas.height);
    gl.uniform1f(uTime, time);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // Same per-frame increment as the reference's Mesh._render().
    time += 0.01;
  }

  function loop() {
    renderFrame();
    rafId = requestAnimationFrame(loop);
  }

  window.addEventListener("resize", fit);

  // Pause the render loop while the tab is hidden (saves CPU/GPU/battery —
  // this full-viewport shader runs for the entire day-mode window, not
  // just a couple of hours like the aurora effect did, so this matters
  // more here, not less); resume when it becomes visible again.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    } else if (!rafId) {
      rafId = requestAnimationFrame(loop);
    }
  });

  loop();
})();
