/**
 * TemporalConsole — Loads a .glb cockpit control panel model and
 * attaches it to the camera as a dashboard. Era switching is handled
 * by controller buttons (A/B), not by clicking on the model.
 * Purely decorative — no raycasting needed.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export class TemporalConsole {
  private root: THREE.Group;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene, _onEra: (era: string) => void, camera?: THREE.Camera) {
    this.scene = scene;

    this.root = new THREE.Group();
    // Cockpit dashboard: below eye level, close
    this.root.position.set(0, -0.1, -0.5);
    this.root.rotation.x = -0.3; // tilt toward user
    this.root.visible = false; // hidden until show()

    // Parent to camera so it follows the user
    if (camera) {
      camera.add(this.root);
    } else {
      scene.add(this.root);
    }

    // Debug placeholder so we can see position immediately
    const placeholder = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.02, 0.15),
      new THREE.MeshBasicMaterial({ color: 0x4444aa, depthTest: false }),
    );
    placeholder.renderOrder = 9000;
    this.root.add(placeholder);

    // Load the .glb model
    const loader = new GLTFLoader();
    loader.load(
      "./models/claw_controller.glb",
      (gltf) => {
        const model = gltf.scene;
        model.scale.setScalar(0.22);

        // Convert all materials to MeshBasicMaterial for Quest safety
        // and set renderOrder so it renders on top of splats
        model.traverse((node: THREE.Object3D) => {
          if (node instanceof THREE.Mesh) {
            const oldMat = node.material as THREE.MeshStandardMaterial;
            if (oldMat.map) {
              node.material = new THREE.MeshBasicMaterial({ map: oldMat.map, depthTest: false });
            } else {
              node.material = new THREE.MeshBasicMaterial({ color: oldMat.color || 0x333333, depthTest: false });
            }
            node.renderOrder = 9000;
          }
        });

        // Remove placeholder and add model
        this.root.remove(placeholder);
        this.root.add(model);
        console.log("[TemporalConsole] Model loaded, children:", model.children.length);
      },
      undefined,
      (err) => {
        console.error("[TemporalConsole] Failed to load model:", err);
      },
    );
  }

  show(): void {
    this.root.visible = true;
  }

  hide(): void {
    this.root.visible = false;
  }

  // Keep interface compatible — these are no-ops now
  setupDesktopPointer(_canvas: HTMLCanvasElement, _camera: THREE.Camera): void {}
  tick(_delta: number, _renderer: THREE.WebGLRenderer): void {}

  dispose(): void {
    this.hide();
    this.scene.remove(this.root);
  }
}
