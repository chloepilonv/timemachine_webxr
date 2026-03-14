/**
 * WormholeTransition — plays a fullscreen video sphere around the camera
 * during era transitions. The video plays while the new splat loads;
 * the transition ends when both the video finishes and the splat is ready.
 */

import * as THREE from "three";

const VIDEO_PATH = "./wormhole.mp4";
const FADE_DURATION = 0.5; // seconds for fade in/out

export class WormholeTransition {
  private video: HTMLVideoElement;
  private texture: THREE.VideoTexture;
  private sphere: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private scene: THREE.Scene;
  private active = false;
  private fadingIn = false;
  private fadingOut = false;
  private fadeStart = 0;
  private onComplete: (() => void) | null = null;
  private splatReady = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Video element (hidden, not added to DOM visually)
    this.video = document.createElement("video");
    this.video.src = VIDEO_PATH;
    this.video.loop = false;
    this.video.muted = true; // must be muted for autoplay
    this.video.playsInline = true;
    this.video.crossOrigin = "anonymous";
    this.video.preload = "auto";

    this.texture = new THREE.VideoTexture(this.video);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    // Shader material with opacity for fade in/out
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

    // Sphere that follows the camera
    const geometry = new THREE.SphereGeometry(5, 32, 32);
    this.sphere = new THREE.Mesh(geometry, this.material);
    this.sphere.renderOrder = 9999; // render on top of everything
    this.sphere.visible = false;

    // Listen for video end
    this.video.addEventListener("ended", () => {
      this.onVideoEnded();
    });
  }

  /**
   * Play the wormhole transition. Returns a promise that resolves
   * when you should load the new splat (after fade-in completes).
   * Call `signalSplatReady()` when the new splat is loaded.
   */
  async play(): Promise<void> {
    if (this.active) return;

    this.active = true;
    this.splatReady = false;
    this.sphere.visible = true;
    this.scene.add(this.sphere);

    // Reset video
    this.video.currentTime = 0;
    this.material.uniforms.opacity.value = 0.0;

    // Fade in
    this.fadingIn = true;
    this.fadingOut = false;
    this.fadeStart = performance.now();

    try {
      await this.video.play();
    } catch (err) {
      console.warn("[Wormhole] Video play failed:", err);
    }

    // Wait for fade-in to complete
    return new Promise((resolve) => {
      const checkFadeIn = () => {
        if (!this.fadingIn) {
          resolve();
          return;
        }
        requestAnimationFrame(checkFadeIn);
      };
      checkFadeIn();
    });
  }

  /**
   * Call this when the new splat has finished loading.
   * The transition will fade out once the video also finishes (or immediately
   * if the video has already ended).
   */
  signalSplatReady(): void {
    this.splatReady = true;
    if (!this.video.paused && !this.video.ended) {
      // Video still playing — wait for it
      return;
    }
    this.startFadeOut();
  }

  /**
   * Returns a promise that resolves when the entire transition
   * (including fade-out) is complete.
   */
  waitForComplete(): Promise<void> {
    if (!this.active) return Promise.resolve();
    return new Promise((resolve) => {
      this.onComplete = resolve;
    });
  }

  /**
   * Must be called every frame from the system's update().
   */
  tick(camera: THREE.Camera): void {
    if (!this.active) return;

    // Keep sphere centered on camera
    this.sphere.position.copy(camera.position);

    const now = performance.now();

    if (this.fadingIn) {
      const t = Math.min((now - this.fadeStart) / (FADE_DURATION * 1000), 1);
      this.material.uniforms.opacity.value = t;
      if (t >= 1) {
        this.fadingIn = false;
      }
    }

    if (this.fadingOut) {
      const t = Math.min((now - this.fadeStart) / (FADE_DURATION * 1000), 1);
      this.material.uniforms.opacity.value = 1 - t;
      if (t >= 1) {
        this.finish();
      }
    }

    // Update video texture
    if (this.video.readyState >= this.video.HAVE_CURRENT_DATA) {
      this.texture.needsUpdate = true;
    }
  }

  private onVideoEnded(): void {
    if (this.splatReady) {
      this.startFadeOut();
    }
    // If splat isn't ready yet, we hold on the last frame until it is
  }

  private startFadeOut(): void {
    if (this.fadingOut) return;
    this.fadingOut = true;
    this.fadeStart = performance.now();
  }

  private finish(): void {
    this.active = false;
    this.sphere.visible = false;
    this.scene.remove(this.sphere);
    this.video.pause();
    this.material.uniforms.opacity.value = 0;

    if (this.onComplete) {
      const cb = this.onComplete;
      this.onComplete = null;
      cb();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    this.video.pause();
    this.video.src = "";
    this.texture.dispose();
    this.material.dispose();
    this.sphere.geometry.dispose();
  }
}
