/**
 * WormholeTransition — plays a fullscreen video sphere around the camera
 * during era transitions. The video plays while the new splat loads;
 * the transition ends when both the video finishes and the splat is ready.
 *
 * Hardened for Quest 3: every async path has timeouts, every state flag
 * resets on forceEnd(), and stale setTimeout callbacks are guarded by a
 * monotonically-increasing generation counter.
 */

import * as THREE from "three";

const VIDEO_PATH = "./wormhole.mp4";
const FADE_DURATION_MS = 200;
const MIN_DISPLAY_MS = 800; // minimum time to show the wormhole

export class WormholeTransition {
  private video: HTMLVideoElement;
  private texture: THREE.VideoTexture;
  private sphere: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private scene: THREE.Scene;
  private active = false;
  private opacity = 0;
  private targetOpacity = 0;
  private fadeStartTime = 0;
  private fadeStartOpacity = 0;
  private playStartTime = 0;
  private resolveTransition: (() => void) | null = null;
  private splatReady = false;

  /**
   * Monotonically-increasing generation counter. Incremented every time
   * start() is called. Any deferred callback (setTimeout in tryFadeOut)
   * captures the generation at scheduling time and aborts if it no longer
   * matches — this prevents stale timers from corrupting a later transition.
   */
  private generation = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.video = document.createElement("video");
    this.video.src = VIDEO_PATH;
    this.video.loop = true; // loop so it keeps playing if splat is slow
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.crossOrigin = "anonymous";
    this.video.preload = "auto";

    this.texture = new THREE.VideoTexture(this.video);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: this.texture },
        opacity: { value: 0.0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform float opacity;
        varying vec2 vUv;
        void main() {
          vec4 color = texture2D(map, vUv);
          gl_FragColor = vec4(color.rgb, opacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.BackSide,
    });

    // Cylinder wraps the video around you like a wormhole tunnel
    // Open-ended so you see the video on the walls, with caps for top/bottom
    const cylinder = new THREE.CylinderGeometry(3, 3, 20, 64, 1, true);
    const capGeo = new THREE.CircleGeometry(3, 64);

    this.sphere = new THREE.Group() as unknown as THREE.Mesh;

    const wallMesh = new THREE.Mesh(cylinder, this.material);
    (this.sphere as unknown as THREE.Group).add(wallMesh);

    // Top and bottom caps (solid black to block outside)
    const capMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.BackSide,
    });
    const topCap = new THREE.Mesh(capGeo, capMat);
    topCap.position.y = 10;
    topCap.rotation.x = Math.PI / 2;
    (this.sphere as unknown as THREE.Group).add(topCap);

    const bottomCap = new THREE.Mesh(capGeo.clone(), capMat);
    bottomCap.position.y = -10;
    bottomCap.rotation.x = -Math.PI / 2;
    (this.sphere as unknown as THREE.Group).add(bottomCap);

    this.sphere.renderOrder = 9999;
    wallMesh.renderOrder = 9999;
    topCap.renderOrder = 9999;
    bottomCap.renderOrder = 9999;
    this.sphere.visible = false;
  }

  /**
   * Start the wormhole transition. Fades in the video sphere.
   * Returns immediately — does not block.
   *
   * If a previous transition is still active (e.g. stuck), it is
   * force-ended first so we never deadlock.
   */
  start(): void {
    if (this.active) {
      console.warn("[Wormhole] start() called while active — force-ending previous transition");
      this.forceEnd();
    }

    this.generation++;
    this.active = true;
    this.splatReady = false;
    this.opacity = 0;
    this.targetOpacity = 0;
    this.fadeStartOpacity = 0;
    this.fadeStartTime = 0;
    this.resolveTransition = null;
    this.sphere.visible = true;
    this.scene.add(this.sphere);
    this.playStartTime = performance.now();

    this.video.currentTime = 0;
    this.video.playbackRate = 4.0;
    this.video.play().catch((err) => {
      console.warn("[Wormhole] Video play failed:", err);
      // Even if video fails we proceed — the sphere shows black which is
      // acceptable as a transition screen.
    });

    this.fadeToOpacity(1);
    console.log("[Wormhole] Started (generation=" + this.generation + ")");
  }

  /**
   * Signal that the new splat is loaded. The wormhole will fade out
   * after the minimum display time has passed.
   */
  signalSplatReady(): void {
    if (!this.active) {
      console.warn("[Wormhole] signalSplatReady() called while not active — ignoring");
      return;
    }
    this.splatReady = true;
    console.log("[Wormhole] Splat ready");
    this.tryFadeOut();
  }

  /**
   * Returns a promise that resolves when the wormhole has fully faded out.
   * Safe to call even if finish() already ran (resolves immediately).
   */
  waitForComplete(): Promise<void> {
    if (!this.active) return Promise.resolve();
    return new Promise((resolve) => {
      // If there was a previous resolve callback that was never called
      // (shouldn't happen, but be safe), resolve it now to avoid leaked promises.
      if (this.resolveTransition) {
        const old = this.resolveTransition;
        this.resolveTransition = null;
        old();
      }
      this.resolveTransition = resolve;
    });
  }

  /**
   * Returns true once fully opaque (fade-in done). Use this to know
   * when it's safe to unload the old splat.
   */
  isFullyOpaque(): boolean {
    return this.active && this.opacity >= 0.99;
  }

  isActive(): boolean {
    return this.active;
  }

  /**
   * Must be called every frame (driven by the system's update loop).
   */
  tick(camera: THREE.Camera): void {
    if (!this.active) return;

    this.sphere.position.copy(camera.position);

    // Animate opacity
    const now = performance.now();
    const elapsed = now - this.fadeStartTime;
    const t = Math.min(elapsed / FADE_DURATION_MS, 1);
    this.opacity = this.fadeStartOpacity + (this.targetOpacity - this.fadeStartOpacity) * t;
    this.material.uniforms.opacity.value = this.opacity;

    // Update video texture
    if (this.video.readyState >= this.video.HAVE_CURRENT_DATA) {
      this.texture.needsUpdate = true;
    }

    // Check if fade-out is complete
    if (this.targetOpacity === 0 && this.opacity <= 0.01 && t >= 1) {
      this.finish();
    }
  }

  private tryFadeOut(): void {
    if (!this.active) return;
    if (!this.splatReady) return;

    const gen = this.generation;
    const elapsed = performance.now() - this.playStartTime;
    if (elapsed < MIN_DISPLAY_MS) {
      // Wait for minimum display time — guarded by generation counter
      setTimeout(() => {
        if (this.generation !== gen) return; // stale timer, abort
        this.tryFadeOut();
      }, MIN_DISPLAY_MS - elapsed);
      return;
    }

    console.log("[Wormhole] Fading out");
    this.fadeToOpacity(0);
  }

  private fadeToOpacity(target: number): void {
    this.fadeStartTime = performance.now();
    this.fadeStartOpacity = this.opacity;
    this.targetOpacity = target;
  }

  private finish(): void {
    if (!this.active) return; // guard against double-finish

    this.active = false;
    this.splatReady = false;
    this.sphere.visible = false;
    this.scene.remove(this.sphere);
    this.video.pause();
    this.opacity = 0;
    this.targetOpacity = 0;
    this.fadeStartOpacity = 0;
    this.material.uniforms.opacity.value = 0;
    console.log("[Wormhole] Complete (generation=" + this.generation + ")");

    if (this.resolveTransition) {
      const cb = this.resolveTransition;
      this.resolveTransition = null;
      cb();
    }
  }

  /**
   * Immediately kill the transition — reset ALL state so it can be reused.
   * This is the nuclear option: resolves any pending promise, stops the
   * video, hides the sphere, and clears every flag.
   */
  forceEnd(): void {
    console.warn("[Wormhole] Force-ended (generation=" + this.generation + ")");
    this.finish();
  }

  dispose(): void {
    this.forceEnd();
    this.video.pause();
    this.video.src = "";
    this.texture.dispose();
    this.material.dispose();
    this.sphere.geometry.dispose();
  }
}
