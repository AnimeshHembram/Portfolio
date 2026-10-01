/* =====================================================================
   AB2 — 3D scene
   Used only by ab2.html. Original code written for AB2.

   Builds a small world from the page's own layout:
     - a plain white back wall,
     - one block per letter of "Storytelling / Design / Tech",
     - one thick slab behind the red card,
   then projects the rasterised page onto all of it from the resting camera.
   Because the projector sits exactly where the resting camera sits, the rest
   view reproduces the page pixel-for-pixel; moving the camera (intro, scroll,
   pointer) reveals that the "page" is printed across real depth.
   ===================================================================== */
(function () {
  "use strict";

  var AB2 = (window.AB2 = window.AB2 || {});

  var FOV = 45;
  var REST_Z = 15;

  // Scroll path: offsets from the rest pose. First and last are the rest pose.
  var KEYS = [
    { x: 0,   y: 0,  z: 0,  tx: 0,  ty: 0,    roll: 0 },
    { x: 15,  y: -3, z: -5, tx: -1, ty: -0.5, roll: 0.2 },
    { x: -13, y: 9,  z: -3, tx: 1,  ty: 0.5,  roll: -0.18 },
    { x: 0,   y: 0,  z: 0,  tx: 0,  ty: 0,    roll: 0 }
  ];
  // Where the camera starts during the intro.
  var INTRO_POSE = { x: 9, y: -7, z: -1, tx: 0, ty: 0.6, roll: 0.1 };
  var INTRO_DURATION = 2.8;

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smooth(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
  function easeInOut(t) { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOutBack(t) {
    t = clamp01(t);
    var c1 = 1.4, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpPose(a, b, t) {
    return {
      x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t),
      tx: lerp(a.tx, b.tx, t), ty: lerp(a.ty, b.ty, t), roll: lerp(a.roll, b.roll, t)
    };
  }
  function posePath(p) {
    var seg = KEYS.length - 1;
    var s = clamp01(p) * seg;
    var i = Math.min(Math.floor(s), seg - 1);
    return lerpPose(KEYS[i], KEYS[i + 1], smooth(s - i));
  }
  // Deterministic pseudo-random so blocks look the same on every visit.
  function rand(seed) {
    var x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function Scene(THREE, opts) {
    this.T = THREE;
    this.host = opts.host;
    this.page = opts.page;
    this.stage = opts.stage;
    this.onLost = opts.onLost || function () {};
    this.small = Math.min(window.innerWidth, window.innerHeight) < 600;

    this.width = 1;
    this.height = 1;
    this.blocks = [];
    this.running = false;
    this.dirty = true;
    this.lit = 0;
    this.pose = lerpPose(KEYS[0], KEYS[0], 0);
    this.intro = null;
    this._raf = 0;
    this._last = 0;
    this._tick = this._tick.bind(this);

    // Inputs driven by main.js
    this.progress = 0;       // smoothed scroll progress 0..1
    this.pointer = { x: 0, y: 0 };
  }

  Scene.prototype.init = function () {
    var T = this.T;
    var self = this;

    this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.small ? 1.5 : 2));
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.setClearColor(0xffffff, 1);
    this.stage.appendChild(this.renderer.domElement);

    this.renderer.domElement.addEventListener("webglcontextlost", function (e) {
      e.preventDefault();
      self.stop();
      self.onLost(new Error("WebGL context lost"));
    });

    this.scene = new T.Scene();
    this.scene.background = new T.Color(0xffffff);

    this.camera = new T.PerspectiveCamera(FOV, 1, 0.1, 400);
    this.projCam = new T.PerspectiveCamera(FOV, 1, 0.1, 400);
    this.projCam.position.set(0, 0, REST_Z);
    this.projCam.lookAt(0, 0, 0);

    // Lights
    this.scene.add(new T.HemisphereLight(0xffffff, 0xdcdcdc, 1.9));
    var key = new T.DirectionalLight(0xffffff, 2.2);
    key.position.set(7, 10, 12);
    key.castShadow = true;
    var sm = this.small ? 1024 : 2048;
    key.shadow.mapSize.set(sm, sm);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 60;
    key.shadow.camera.left = -24;
    key.shadow.camera.right = 24;
    key.shadow.camera.top = 18;
    key.shadow.camera.bottom = -18;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);

    // Snapshot of the page → texture
    this.snapshot = new AB2.HtmlSnapshot(this.page, {
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      maxSize: Math.min(this.renderer.capabilities.maxTextureSize, 4096)
    });
    this.texture = new T.CanvasTexture(this.snapshot.canvas);
    this.texture.colorSpace = T.SRGBColorSpace;
    this.texture.minFilter = T.LinearFilter;
    this.texture.magFilter = T.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.anisotropy = 1;

    this.projector = AB2.createProjector(T, this.projCam, this.texture);

    // Shared materials
    this.matWhite = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    this.matRed = new T.MeshStandardMaterial({ color: 0xfd453a, roughness: 0.85, metalness: 0 });
    this.projector.applyTo(this.matWhite);
    this.projector.applyTo(this.matRed);

    // Back wall
    var wall = new T.Mesh(new T.PlaneGeometry(400, 400), this.matWhite);
    wall.receiveShadow = true;
    this.scene.add(wall);

    this.boxGeo = new T.BoxGeometry(1, 1, 1);
    this.boxGeo.translate(0, 0, 0.5); // back face on the wall (z = 0)

    return this.relayout();
  };

  // Pixel point on the page → world point on the plane z, seen from rest.
  Scene.prototype._toWorld = function (px, py, z) {
    var halfH = (REST_Z - z) * Math.tan((FOV * Math.PI) / 360);
    var halfW = halfH * (this.width / this.height);
    return {
      x: (px / this.width * 2 - 1) * halfW,
      y: (1 - py / this.height * 2) * halfH
    };
  };

  Scene.prototype._addBlock = function (rect, depth, mat, delay) {
    var T = this.T;
    var a = this._toWorld(rect.left, rect.top, depth);
    var b = this._toWorld(rect.right, rect.bottom, depth);
    var mesh = new T.Mesh(this.boxGeo, mat);
    mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
    mesh.scale.set(Math.max(0.02, b.x - a.x), Math.max(0.02, a.y - b.y), depth);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.depth = depth;
    mesh.userData.delay = delay;
    this.scene.add(mesh);
    this.blocks.push(mesh);
    return mesh;
  };

  Scene.prototype._clearBlocks = function () {
    for (var i = 0; i < this.blocks.length; i++) this.scene.remove(this.blocks[i]);
    this.blocks = [];
  };

  // Measure the page and (re)build geometry + texture for the current size.
  Scene.prototype.relayout = function () {
    var r = this.host.getBoundingClientRect();
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    var aspect = this.width / this.height;

    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.projCam.aspect = aspect;
    this.projCam.updateProjectionMatrix();
    this.projector.update();

    this._clearBlocks();

    var origin = r;
    var self = this;
    var seed = 1;
    var words = this.page.querySelectorAll("[data-ab2-word]");
    Array.prototype.forEach.call(words, function (el, wi) {
      var node = el.firstChild;
      if (!node || node.nodeType !== 3) return;
      var text = node.nodeValue;
      var range = document.createRange();
      var base = 0.9 + rand(wi * 7 + 3) * 0.8;
      for (var i = 0; i < text.length; i++) {
        if (text[i] === " ") continue;
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        var b = range.getBoundingClientRect();
        if (!b.width || !b.height) continue;
        // Trim the line box a little so blocks hug the glyphs.
        var padY = b.height * 0.12;
        var rect = {
          left: b.left - origin.left,
          right: b.right - origin.left,
          top: b.top - origin.top + padY,
          bottom: b.bottom - origin.top - padY * 0.6
        };
        var depth = base + (rand(seed++ * 3.1) - 0.5) * 1.1;
        var cx = (rect.left + rect.right) / 2 / self.width;
        self._addBlock(rect, Math.max(0.35, depth), self.matWhite, 0.15 + cx * 0.7 + i * 0.02);
      }
    });

    var card = this.page.querySelector("#ab2-card");
    if (card) {
      var cb = card.getBoundingClientRect();
      this._addBlock({
        left: cb.left - origin.left, right: cb.right - origin.left,
        top: cb.top - origin.top, bottom: cb.bottom - origin.top
      }, 2.6, this.matRed, 0.55);
    }

    this._applyGrowth(this.intro ? 0 : 1);

    this.snapshot.setSize(this.width, this.height);
    return this.snapshot.update().then(function () {
      self.texture.dispose(); // canvas size may have changed
      self.texture.needsUpdate = true;
      self.dirty = true;
    });
  };

  // g: 0 = everything flush with the wall, 1 = full depth.
  // During the intro each block grows on its own delay.
  Scene.prototype._applyGrowth = function (g, t) {
    for (var i = 0; i < this.blocks.length; i++) {
      var b = this.blocks[i];
      var k = t == null ? g : easeOutBack((t - b.userData.delay) / 0.9);
      b.scale.z = Math.max(0.001, b.userData.depth * k);
    }
  };

  Scene.prototype.playIntro = function () {
    this.intro = { t: 0 };
    this._applyGrowth(0, 0);
    this.dirty = true;
  };

  Scene.prototype.skipIntro = function () {
    this.intro = null;
    this._applyGrowth(1);
    this.dirty = true;
  };

  Scene.prototype.isIntroPlaying = function () { return !!this.intro; };

  Scene.prototype._update = function (dt) {
    var pose, lit;
    var portrait = this.width < this.height;
    var xScale = portrait ? 0.55 : 1;

    var path = posePath(this.progress);
    var dist = Math.min(this.progress, 1 - this.progress) * 2; // 0 at rest, 1 mid-path
    var pathLit = smooth(dist * 3);

    if (this.intro) {
      this.intro.t += dt;
      var t = this.intro.t;
      this._applyGrowth(0, t);
      var camT = easeInOut((t - 0.9) / (INTRO_DURATION - 0.9));
      pose = lerpPose(INTRO_POSE, path, camT);
      lit = Math.max(1 - smooth((t - 1.7) / (INTRO_DURATION - 1.7)), pathLit);
      if (t >= INTRO_DURATION + 0.3) this.skipIntro();
    } else {
      pose = path;
      lit = pathLit;
    }

    // Pointer parallax: a small camera nudge. It adds no shading, so the
    // resting page stays plain white like the flat layout.
    var px = this.pointer.x, py = this.pointer.y;
    var cx = pose.x * xScale + px * 1.4;
    var cy = pose.y + py * 0.9;

    var changed =
      Math.abs(cx - this.pose.x) > 1e-4 || Math.abs(cy - this.pose.y) > 1e-4 ||
      Math.abs(pose.z - this.pose.z) > 1e-4 || Math.abs(pose.roll - this.pose.roll) > 1e-5 ||
      Math.abs(lit - this.lit) > 1e-4 || !!this.intro;

    this.pose = { x: cx, y: cy, z: pose.z, tx: pose.tx, ty: pose.ty, roll: pose.roll };
    this.lit = lit;

    if (changed || this.dirty) {
      this.camera.position.set(cx, cy, REST_Z + pose.z);
      this.camera.lookAt(pose.tx * xScale, pose.ty, 0);
      this.camera.rotateZ(pose.roll);
      this.projector.uniforms.uLit.value = lit;
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
  };

  Scene.prototype._tick = function (now) {
    if (!this.running) return;
    var dt = this._last ? Math.min(0.1, (now - this._last) / 1000) : 0.016;
    this._last = now;
    if (this.beforeFrame) this.beforeFrame(dt);
    this._update(dt);
    this._raf = requestAnimationFrame(this._tick);
  };

  Scene.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this._last = 0;
    this.dirty = true;
    this._raf = requestAnimationFrame(this._tick);
  };

  Scene.prototype.stop = function () {
    this.running = false;
    cancelAnimationFrame(this._raf);
  };

  AB2.Scene = Scene;
})();
