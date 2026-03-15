import { ConvaiClient } from "convai-web-sdk";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export class ConvaiAgent {
  client: ConvaiClient | null = null;
  mesh: THREE.Object3D | null = null;
  isTalking: boolean = false;

  init() {
    if (this.client) return;
    this.client = new ConvaiClient({
      apiKey: (import.meta as any).env.VITE_CONVAI_API_KEY,
      characterId: (import.meta as any).env.VITE_CONVAI_CHARACTER_ID,
      enableAudio: true,
      // @ts-ignore
      enableFaceModel: true,
    });

    this.client.setErrorCallback((type: string, statusMessage: string) => {
      console.error("[ConvaiAgent] Error:", type, statusMessage);
    });

    this.client.onAudioPlay(() => {
      console.log("[ConvaiAgent] Speaking...");
    });

    this.client.onAudioStop(() => {
      console.log("[ConvaiAgent] Stopped speaking.");
    });
  }

  async loadModel(scene: THREE.Scene, position: THREE.Vector3) {
    return new Promise<void>((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(
        "./models/model.glb",
        (gltf) => {
          this.mesh = gltf.scene;
          this.mesh.position.copy(position);
          
          // Basic shadow and material setup
          this.mesh.traverse((node: THREE.Object3D) => {
            if (node instanceof THREE.Mesh) {
              node.castShadow = true;
              node.receiveShadow = true;
              // Make sure materials are ok for environment
              if (node.material && node.material instanceof THREE.MeshStandardMaterial) {
                node.material.envMapIntensity = 1.0;
              }
            }
          });

          scene.add(this.mesh);
          resolve();
        },
        undefined,
        (err) => {
          console.error("Failed to load Avaturn model:", err);
          reject(err);
        }
      );
    });
  }

  startInteraction() {
    if (!this.client) return;
    console.log("[ConvaiAgent] Start listening...");
    this.isTalking = true;
    this.client.startAudioChunk();
  }

  stopInteraction() {
    if (!this.client) return;
    console.log("[ConvaiAgent] Stop listening.");
    this.isTalking = false;
    this.client.endAudioChunk();
  }
}

export const convaiAgent = new ConvaiAgent();
