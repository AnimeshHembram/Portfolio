// ---------------------------------------------------------------------
// Infinite Gallery — vanilla Three.js scene
// ---------------------------------------------------------------------
// This is a hand-written vanilla-JS/Three.js port of the *behavior* of
// edoardolunardi/infinite-canvas's src/infinite-canvas/scene.tsx (MIT
// licensed, Codrops): the camera drift/velocity controller, chunk-based
// procedural plane placement, and distance/depth fade culling. None of
// that logic actually depended on React or React-Three-Fiber — it was
// plain Three.js incidentally wrapped in React hooks (useFrame/useThree)
// and a reconciled component tree (<Chunk>/<MediaPlane>). Here the same
// math and event handling drives a manual requestAnimationFrame loop and
// manual THREE.Object3D lifecycle instead, so no React/Fiber/Drei/Vite
// is needed at all.
//
// Concept credit: infinite-canvas by Edoardo Lunardi for Codrops (MIT).
// https://github.com/edoardolunardi/infinite-canvas
//
// Plain classic script (no import/export) — see constants.js for why.
// Reads Three.js, Constants, Utils and TextureManager off window, and
// publishes itself as window.InfiniteGallery.createInfiniteGalleryScene.
(function (global) {
"use strict";

const THREE = global.THREE;
const IG = global.InfiniteGallery;
const {
  CHUNK_SIZE,
  MAX_VELOCITY,
  DEPTH_FADE_START,
  DEPTH_FADE_END,
  INVIS_THRESHOLD,
  KEYBOARD_SPEED,
  VELOCITY_LERP,
  VELOCITY_DECAY,
  INITIAL_CAMERA_Z,
  CAMERA_FOV,
  CAMERA_NEAR,
  CAMERA_FAR,
  FOG_NEAR,
  FOG_FAR,
  BACKGROUND_COLOR,
  FOG_COLOR,
  getChunkRadiusFor,
  buildChunkOffsets,
} = IG.Constants;
const { clamp, lerp, generateChunkPlanesCached, getChunkUpdateThrottleMs, shouldThrottleUpdate } = IG.Utils;
const { getTexture } = IG.TextureManager;

const PLANE_GEOMETRY = new THREE.PlaneGeometry(1, 1);

const KEY_MAP = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "backward",
  ArrowDown: "backward",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  KeyE: "up",
  KeyQ: "down",
};

function getTouchDistance(touches) {
  if (touches.length < 2) return 0;
  const [t1, t2] = touches;
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * One media plane inside a chunk: a textured quad that fades in once its
 * texture is ready, then fades with grid-distance and depth every frame.
 */
function createMediaPlane(planeData, media, chunkCoord, cameraGridRef, renderDistance, chunkFadeMargin) {
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(PLANE_GEOMETRY, material);
  mesh.position.copy(planeData.position);
  mesh.visible = false;
  // STEP 2: lets a click/tap raycast (see maybeActivateItem below) recover
  // the full manifest entry — url, title, openPath/link, etc. — for
  // whichever plane it hits, without changing anything about how the
  // plane itself renders or fades.
  mesh.userData.media = media;

  const local = { opacity: 0, frame: 0, ready: false, disposed: false };

  const displayScale =
    media.width && media.height
      ? new THREE.Vector3((planeData.scale.y * media.width) / media.height, planeData.scale.y, 1)
      : planeData.scale.clone();

  getTexture(media, (tex) => {
    if (local.disposed) return;
    local.ready = true;
    material.map = tex;
    material.needsUpdate = true;
    mesh.scale.copy(displayScale);
  });

  function update() {
    local.frame = (local.frame + 1) & 1;

    if (local.opacity < INVIS_THRESHOLD && !mesh.visible && local.frame === 0) return;
    if (!local.ready) return;

    const cam = cameraGridRef.current;
    const dist = Math.max(
      Math.abs(chunkCoord.cx - cam.cx),
      Math.abs(chunkCoord.cy - cam.cy),
      Math.abs(chunkCoord.cz - cam.cz)
    );
    const absDepth = Math.abs(mesh.position.z - cam.camZ);

    if (absDepth > DEPTH_FADE_END + 50) {
      local.opacity = 0;
      material.opacity = 0;
      material.depthWrite = false;
      mesh.visible = false;
      return;
    }

    const gridFade =
      dist <= renderDistance ? 1 : Math.max(0, 1 - (dist - renderDistance) / Math.max(chunkFadeMargin, 0.0001));
    const depthFade =
      absDepth <= DEPTH_FADE_START
        ? 1
        : Math.max(0, 1 - (absDepth - DEPTH_FADE_START) / Math.max(DEPTH_FADE_END - DEPTH_FADE_START, 0.0001));
    const target = Math.min(gridFade, depthFade * depthFade);

    local.opacity = target < INVIS_THRESHOLD && local.opacity < INVIS_THRESHOLD ? 0 : lerp(local.opacity, target, 0.18);

    const isFullyOpaque = local.opacity > 0.99;
    material.opacity = isFullyOpaque ? 1 : local.opacity;
    material.depthWrite = isFullyOpaque;
    mesh.visible = local.opacity > INVIS_THRESHOLD;
  }

  function dispose() {
    local.disposed = true;
    material.dispose();
  }

  return { mesh, update, dispose };
}

/** One chunk: a deterministic set of media planes for a given (cx,cy,cz). */
function createChunk(cx, cy, cz, media, cameraGridRef, group, renderDistance, chunkFadeMargin) {
  const planeDatas = generateChunkPlanesCached(cx, cy, cz);
  const chunkCoord = { cx, cy, cz };

  const planes = planeDatas
    .map((planeData) => {
      const mediaItem = media[planeData.mediaIndex % media.length];
      if (!mediaItem) return null;
      const plane = createMediaPlane(planeData, mediaItem, chunkCoord, cameraGridRef, renderDistance, chunkFadeMargin);
      group.add(plane.mesh);
      return plane;
    })
    .filter(Boolean);

  return {
    update() {
      planes.forEach((p) => p.update());
    },
    dispose() {
      planes.forEach((p) => {
        group.remove(p.mesh);
        p.dispose();
      });
    },
  };
}

/**
 * Mounts the Infinite Gallery scene onto a <canvas>.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   media: Array<{url: string, width?: number, height?: number}>,
 *   isTouchDevice: boolean,
 *   reduceMotion: boolean,
 *   onProgress?: (percent: number) => void,
 *   onLoaded?: () => void,
 *   onItemActivate?: (media: object) => void,
 * }} options
 * @returns {{ dispose: () => void }}
 */
function createInfiniteGalleryScene(canvas, options) {
  const { media, isTouchDevice, reduceMotion, onProgress, onLoaded, onItemActivate } = options;

  // Touch devices get a smaller chunk radius (fewer planes in flight at
  // once) — the "infinite" feel is unchanged, only the pre-loaded radius
  // around the camera shrinks, which is what actually costs draw calls.
  const { renderDistance, chunkFadeMargin } = getChunkRadiusFor(isTouchDevice);
  const chunkOffsets = buildChunkOffsets(renderDistance, chunkFadeMargin);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  const dpr = Math.min(window.devicePixelRatio || 1, isTouchDevice ? 1.25 : 1.5);
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND_COLOR);
  scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
  camera.position.set(0, 0, INITIAL_CAMERA_Z);

  const chunkGroup = new THREE.Group();
  scene.add(chunkGroup);

  // STEP 2: click/tap-to-open. A short, (near-)stationary press on a
  // visible media plane opens that resource (main.js decides how, via
  // onItemActivate) — a real drag or a long press never triggers it, so
  // panning/zooming is completely unaffected. Nothing about rendering,
  // chunking, or camera physics changes below this point.
  const raycaster = new THREE.Raycaster();
  const CLICK_MAX_MOVE_PX = 6;
  const CLICK_MAX_MS = 500;
  function maybeActivateItem(clientX, clientY, pressStart) {
    if (!pressStart || typeof onItemActivate !== "function") return;
    const dx = clientX - pressStart.x;
    const dy = clientY - pressStart.y;
    if (Math.sqrt(dx * dx + dy * dy) > CLICK_MAX_MOVE_PX) return;
    if (performance.now() - pressStart.time > CLICK_MAX_MS) return;

    const ndc = {
      x: (clientX / window.innerWidth) * 2 - 1,
      y: -(clientY / window.innerHeight) * 2 + 1,
    };
    raycaster.setFromCamera(ndc, camera);
    const intersections = raycaster.intersectObjects(chunkGroup.children, false);
    for (let i = 0; i < intersections.length; i++) {
      const obj = intersections[i].object;
      if (obj && obj.visible && obj.userData && obj.userData.media) {
        onItemActivate(obj.userData.media);
        return;
      }
    }
  }

  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  // ---- input state ------------------------------------------------------
  const state = {
    velocity: { x: 0, y: 0, z: 0 },
    targetVel: { x: 0, y: 0, z: 0 },
    basePos: { x: 0, y: 0, z: INITIAL_CAMERA_Z },
    drift: { x: 0, y: 0 },
    mouse: { x: 0, y: 0 },
    lastMouse: { x: 0, y: 0 },
    scrollAccum: 0,
    isDragging: false,
    lastTouches: [],
    lastTouchDist: 0,
    lastChunkKey: "",
    lastChunkUpdate: 0,
    pendingChunk: null,
    pressStart: null,
  };

  const keys = { forward: false, backward: false, left: false, right: false, up: false, down: false };

  function onKeyDown(e) {
    const k = KEY_MAP[e.code];
    if (!k) return;
    keys[k] = true;
  }
  function onKeyUp(e) {
    const k = KEY_MAP[e.code];
    if (!k) return;
    keys[k] = false;
  }
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  canvas.style.cursor = "grab";
  const setCursor = (c) => {
    canvas.style.cursor = c;
  };

  function onMouseDown(e) {
    state.isDragging = true;
    state.lastMouse = { x: e.clientX, y: e.clientY };
    state.pressStart = { x: e.clientX, y: e.clientY, time: performance.now() };
    setCursor("grabbing");
  }
  function onMouseUp(e) {
    maybeActivateItem(e.clientX, e.clientY, state.pressStart);
    state.pressStart = null;
    state.isDragging = false;
    setCursor("grab");
  }
  function onMouseLeaveHandler() {
    state.mouse = { x: 0, y: 0 };
    state.isDragging = false;
    state.pressStart = null;
    setCursor("grab");
  }
  function onMouseMove(e) {
    state.mouse = {
      x: (e.clientX / window.innerWidth) * 2 - 1,
      y: -(e.clientY / window.innerHeight) * 2 + 1,
    };
    if (state.isDragging) {
      state.targetVel.x -= (e.clientX - state.lastMouse.x) * 0.025;
      state.targetVel.y += (e.clientY - state.lastMouse.y) * 0.025;
      state.lastMouse = { x: e.clientX, y: e.clientY };
      // A real drag — even one that ends back near its start point —
      // should never be mistaken for a click; invalidate pressStart as
      // soon as the cumulative movement exceeds the click threshold.
      if (state.pressStart) {
        const dx = e.clientX - state.pressStart.x;
        const dy = e.clientY - state.pressStart.y;
        if (Math.sqrt(dx * dx + dy * dy) > CLICK_MAX_MOVE_PX) state.pressStart = null;
      }
    }
  }
  function onWheel(e) {
    e.preventDefault();
    state.scrollAccum += e.deltaY * 0.006;
  }
  function onTouchStart(e) {
    e.preventDefault();
    state.lastTouches = Array.from(e.touches);
    state.lastTouchDist = getTouchDistance(state.lastTouches);
    // Only a single, stationary touch can ever be a "tap" — a pinch
    // (2 touches) should never open an item mid-gesture.
    state.pressStart =
      state.lastTouches.length === 1
        ? { x: state.lastTouches[0].clientX, y: state.lastTouches[0].clientY, time: performance.now() }
        : null;
    setCursor("grabbing");
  }
  function onTouchMove(e) {
    e.preventDefault();
    const touches = Array.from(e.touches);
    if (touches.length === 1 && state.lastTouches.length >= 1) {
      const [touch] = touches;
      const [last] = state.lastTouches;
      if (touch && last) {
        state.targetVel.x -= (touch.clientX - last.clientX) * 0.02;
        state.targetVel.y += (touch.clientY - last.clientY) * 0.02;
      }
      if (touch && state.pressStart) {
        const dx = touch.clientX - state.pressStart.x;
        const dy = touch.clientY - state.pressStart.y;
        if (Math.sqrt(dx * dx + dy * dy) > CLICK_MAX_MOVE_PX) state.pressStart = null;
      }
    } else if (touches.length === 2 && state.lastTouchDist > 0) {
      const dist = getTouchDistance(touches);
      state.scrollAccum += (state.lastTouchDist - dist) * 0.006;
      state.lastTouchDist = dist;
      state.pressStart = null; // a pinch is never a tap
    }
    state.lastTouches = touches;
  }
  function onTouchEnd(e) {
    if (e.touches.length === 0 && e.changedTouches && e.changedTouches.length === 1) {
      const t = e.changedTouches[0];
      maybeActivateItem(t.clientX, t.clientY, state.pressStart);
    }
    state.pressStart = null;
    state.lastTouches = Array.from(e.touches);
    state.lastTouchDist = getTouchDistance(state.lastTouches);
    setCursor("grab");
  }

  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseleave", onMouseLeaveHandler);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  canvas.addEventListener("touchmove", onTouchMove, { passive: false });
  canvas.addEventListener("touchend", onTouchEnd, { passive: false });

  // ---- chunk bookkeeping --------------------------------------------------
  const cameraGridRef = { current: { cx: 0, cy: 0, cz: 0, camZ: camera.position.z } };
  const activeChunks = new Map(); // "cx,cy,cz" -> chunk instance

  function setVisibleChunks(cx, cy, cz) {
    const wantedKeys = new Set();
    chunkOffsets.forEach((o) => {
      const ucx = cx + o.dx;
      const ucy = cy + o.dy;
      const ucz = cz + o.dz;
      const key = `${ucx},${ucy},${ucz}`;
      wantedKeys.add(key);
      if (!activeChunks.has(key)) {
        activeChunks.set(
          key,
          createChunk(ucx, ucy, ucz, media, cameraGridRef, chunkGroup, renderDistance, chunkFadeMargin)
        );
      }
    });
    for (const [key, chunk] of activeChunks) {
      if (!wantedKeys.has(key)) {
        chunk.dispose();
        activeChunks.delete(key);
      }
    }
  }

  {
    const cx = Math.floor(state.basePos.x / CHUNK_SIZE);
    const cy = Math.floor(state.basePos.y / CHUNK_SIZE);
    const cz = Math.floor(state.basePos.z / CHUNK_SIZE);
    setVisibleChunks(cx, cy, cz);
    state.lastChunkKey = `${cx},${cy},${cz}`;
  }

  // ---- progressive loading ------------------------------------------------
  // texture-manager.js's TextureLoader uses THREE.DefaultLoadingManager,
  // and our texture cache guarantees a given URL only ever triggers one
  // real load — so the manager's item counts map 1:1 onto distinct media
  // URLs actually in play, giving an accurate load percentage with no
  // extra bookkeeping here.
  let disposed = false;
  const manager = THREE.DefaultLoadingManager;
  const prevOnProgress = manager.onProgress;
  const prevOnLoad = manager.onLoad;
  manager.onProgress = (url, loaded, total) => {
    prevOnProgress?.(url, loaded, total);
    if (disposed) return;
    onProgress?.(total > 0 ? Math.round((loaded / total) * 100) : 100);
  };
  manager.onLoad = () => {
    prevOnLoad?.();
    if (disposed) return;
    onProgress?.(100);
    onLoaded?.();
  };
  if (media.length === 0) {
    // Nothing to load — resolve immediately so the loading UI never
    // waits on a manager event that will never fire.
    onProgress?.(100);
    onLoaded?.();
  }

  // ---- animation loop -------------------------------------------------------
  let rafId = null;
  function frame() {
    const s = state;

    if (keys.forward) s.targetVel.z -= KEYBOARD_SPEED;
    if (keys.backward) s.targetVel.z += KEYBOARD_SPEED;
    if (keys.left) s.targetVel.x -= KEYBOARD_SPEED;
    if (keys.right) s.targetVel.x += KEYBOARD_SPEED;
    if (keys.down) s.targetVel.y -= KEYBOARD_SPEED;
    if (keys.up) s.targetVel.y += KEYBOARD_SPEED;

    const isZooming = Math.abs(s.velocity.z) > 0.05;
    const zoomFactor = clamp(s.basePos.z / 50, 0.3, 2.0);
    const driftAmount = reduceMotion ? 0 : 8.0 * zoomFactor;
    const driftLerp = isZooming ? 0.2 : 0.12;

    if (s.isDragging || reduceMotion) {
      // Frozen: an active drag keeps drift at its current value; reduced
      // motion disables the autonomous cursor-parallax entirely. Direct
      // navigation (drag, scroll/pinch, WASD) is unaffected either way.
    } else if (isTouchDevice) {
      s.drift.x = lerp(s.drift.x, 0, driftLerp);
      s.drift.y = lerp(s.drift.y, 0, driftLerp);
    } else {
      s.drift.x = lerp(s.drift.x, s.mouse.x * driftAmount, driftLerp);
      s.drift.y = lerp(s.drift.y, s.mouse.y * driftAmount, driftLerp);
    }

    s.targetVel.z += s.scrollAccum;
    s.scrollAccum *= 0.8;

    s.targetVel.x = clamp(s.targetVel.x, -MAX_VELOCITY, MAX_VELOCITY);
    s.targetVel.y = clamp(s.targetVel.y, -MAX_VELOCITY, MAX_VELOCITY);
    s.targetVel.z = clamp(s.targetVel.z, -MAX_VELOCITY, MAX_VELOCITY);

    s.velocity.x = lerp(s.velocity.x, s.targetVel.x, VELOCITY_LERP);
    s.velocity.y = lerp(s.velocity.y, s.targetVel.y, VELOCITY_LERP);
    s.velocity.z = lerp(s.velocity.z, s.targetVel.z, VELOCITY_LERP);

    s.basePos.x += s.velocity.x;
    s.basePos.y += s.velocity.y;
    s.basePos.z += s.velocity.z;

    camera.position.set(s.basePos.x + s.drift.x, s.basePos.y + s.drift.y, s.basePos.z);

    s.targetVel.x *= VELOCITY_DECAY;
    s.targetVel.y *= VELOCITY_DECAY;
    s.targetVel.z *= VELOCITY_DECAY;

    const cx = Math.floor(s.basePos.x / CHUNK_SIZE);
    const cy = Math.floor(s.basePos.y / CHUNK_SIZE);
    const cz = Math.floor(s.basePos.z / CHUNK_SIZE);
    cameraGridRef.current = { cx, cy, cz, camZ: s.basePos.z };

    const key = `${cx},${cy},${cz}`;
    if (key !== s.lastChunkKey) {
      s.pendingChunk = { cx, cy, cz };
      s.lastChunkKey = key;
    }

    const now = performance.now();
    const throttleMs = getChunkUpdateThrottleMs(isZooming, Math.abs(s.velocity.z));
    if (s.pendingChunk && shouldThrottleUpdate(s.lastChunkUpdate, throttleMs, now)) {
      const { cx: ucx, cy: ucy, cz: ucz } = s.pendingChunk;
      s.pendingChunk = null;
      s.lastChunkUpdate = now;
      setVisibleChunks(ucx, ucy, ucz);
    }

    activeChunks.forEach((chunk) => chunk.update());

    renderer.render(scene, camera);
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  function onVisibilityChange() {
    if (document.hidden) {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    } else if (!rafId && !disposed) {
      rafId = requestAnimationFrame(frame);
    }
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener("resize", resize);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    canvas.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mouseup", onMouseUp);
    window.removeEventListener("mousemove", onMouseMove);
    canvas.removeEventListener("mouseleave", onMouseLeaveHandler);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("touchstart", onTouchStart);
    canvas.removeEventListener("touchmove", onTouchMove);
    canvas.removeEventListener("touchend", onTouchEnd);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    manager.onProgress = prevOnProgress;
    manager.onLoad = prevOnLoad;
    activeChunks.forEach((chunk) => chunk.dispose());
    activeChunks.clear();
    renderer.dispose();
  }

  return { dispose };
}

global.InfiniteGallery.createInfiniteGalleryScene = createInfiniteGalleryScene;
})(window);
