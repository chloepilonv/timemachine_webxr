import { ConvaiClient } from "convai-web-sdk";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export class ConvaiAgent {
  client: ConvaiClient | null = null;
  mesh: THREE.Object3D | null = null;
  isTalking: boolean = false;
  lastTranscript: string = "";
  _cooldown: boolean = false;

  // Idle animation state
  private clock = new THREE.Clock(false);
  private baseQuats: Map<string, THREE.Quaternion> = new Map();
  private bones: {
    hips: THREE.Bone | null;
    spine1: THREE.Bone | null;
    head: THREE.Bone | null;
    leftArm: THREE.Bone | null;
    rightArm: THREE.Bone | null;
    leftForeArm: THREE.Bone | null;
    rightForeArm: THREE.Bone | null;
    leftShoulder: THREE.Bone | null;
    rightShoulder: THREE.Bone | null;
    neck: THREE.Bone | null;
    spine: THREE.Bone | null;
  } = { hips: null, spine1: null, head: null, leftArm: null, rightArm: null, leftForeArm: null, rightForeArm: null, leftShoulder: null, rightShoulder: null, neck: null, spine: null };

  init() {
    if (this.client) return;

    const apiKey = (import.meta as any).env.VITE_CONVAI_API_KEY;
    const characterId = (import.meta as any).env.VITE_CONVAI_CHARACTER_ID;

    console.log("[ConvaiAgent] Initializing with characterId:", characterId);
    console.log("[ConvaiAgent] API key present:", !!apiKey);

    this.client = new ConvaiClient({
      apiKey,
      characterId,
      enableAudio: true,
      enableFacialData: false,
    });

    // CRITICAL: This callback receives the AI's response (text + audio)
    this.client.setResponseCallback((response: any) => {
      // The audio is handled automatically by the SDK's internal audio player.
      // Here we just log the text transcript for debugging.
      if (response?.hasAudioResponse?.()) {
        const audioResponse = response.getAudioResponse();
        if (audioResponse) {
          const textData = audioResponse.getTextData();
          if (textData) {
            this.lastTranscript = textData;
            console.log("[ConvaiAgent] AI says:", textData);
          }
          const userData = audioResponse.getUserQuery?.();
          if (userData) {
            const userTranscript = userData.getTextData();
            if (userTranscript) {
              console.log("[ConvaiAgent] User said:", userTranscript);
            }
          }
        }
      }
    });

    this.client.setErrorCallback((type: string, statusMessage: string) => {
      console.error("[ConvaiAgent] Error:", type, statusMessage);
    });

    this.client.onAudioPlay(() => {
      console.log("[ConvaiAgent] 🔊 Agent audio playing...");
    });

    this.client.onAudioStop(() => {
      console.log("[ConvaiAgent] 🔇 Agent audio stopped.");
    });

    console.log("[ConvaiAgent] ✅ Initialized successfully.");
  }

  async loadModel(scene: THREE.Scene, position: THREE.Vector3) {
    return new Promise<void>((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(
        "./models/model_tourguide_v1.glb",
        (gltf) => {
          this.mesh = gltf.scene;
          this.mesh.position.copy(position);

          // Basic shadow and material setup
          this.mesh.traverse((node: THREE.Object3D) => {
            if (node instanceof THREE.Mesh) {
              node.castShadow = true;
              node.receiveShadow = true;
              if (node.material && node.material instanceof THREE.MeshStandardMaterial) {
                node.material.envMapIntensity = 1.0;
              }
            }
          });

          // Find key bones for procedural animation
          this.mesh.traverse((node: THREE.Object3D) => {
            if (node instanceof THREE.Bone) {
              switch (node.name) {
                case "Hips": this.bones.hips = node; break;
                case "Spine1": this.bones.spine1 = node; break;
                case "Head": this.bones.head = node; break;
                case "LeftArm": this.bones.leftArm = node; break;
                case "RightArm": this.bones.rightArm = node; break;
                case "LeftForeArm": this.bones.leftForeArm = node; break;
                case "RightForeArm": this.bones.rightForeArm = node; break;
                case "LeftShoulder": this.bones.leftShoulder = node; break;
                case "RightShoulder": this.bones.rightShoulder = node; break;
                case "Neck": this.bones.neck = node; break;
                case "Spine": this.bones.spine = node; break;
              }
            }
          });

          // Take avatar out of T-pose into a natural standing pose
          // Apply a downward rotation in world-space via quaternion multiply
          const downRotL = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(60)
          );
          const downRotR = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(-60)
          );
          if (this.bones.leftShoulder) {
            this.bones.leftShoulder.quaternion.multiply(downRotL);
          }
          if (this.bones.rightShoulder) {
            this.bones.rightShoulder.quaternion.multiply(downRotR);
          }
          // Slight bend in elbows so arms don't look rigid
          if (this.bones.leftForeArm) {
            this.bones.leftForeArm.rotation.y = THREE.MathUtils.degToRad(15);
          }
          if (this.bones.rightForeArm) {
            this.bones.rightForeArm.rotation.y = THREE.MathUtils.degToRad(-15);
          }

          // Store base quaternions after posing — idle animation applies on top
          for (const [name, bone] of Object.entries(this.bones)) {
            if (bone) this.baseQuats.set(name, bone.quaternion.clone());
          }

          const foundBones = Object.entries(this.bones)
            .filter(([, b]) => b !== null)
            .map(([name]) => name);
          console.log("[ConvaiAgent] Found bones:", foundBones.join(", "));

          // Hook idle animation into the render loop via onBeforeRender
          // (fires every frame in both desktop and XR modes)
          let firstMesh: THREE.Mesh | null = null;
          this.mesh.traverse((node: THREE.Object3D) => {
            if (!firstMesh && node instanceof THREE.Mesh) firstMesh = node;
          });
          if (firstMesh) {
            (firstMesh as THREE.Mesh).onBeforeRender = () => {
              this.update(0);
            };
          }

          this.clock.start();
          scene.add(this.mesh);
          console.log("[ConvaiAgent] ✅ Avaturn model loaded at", position.toArray());
          resolve();
        },
        undefined,
        (err) => {
          console.error("[ConvaiAgent] ❌ Failed to load Avaturn model:", err);
          reject(err);
        }
      );
    });
  }

  /** Apply a small rotation delta on top of the stored base pose. */
  private applyDelta(name: string, bone: THREE.Bone, x: number, y: number, z: number) {
    const base = this.baseQuats.get(name);
    if (!base) return;
    const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
    bone.quaternion.copy(base).multiply(delta);
  }

  /** Call every frame for procedural idle animation. */
  update(_delta: number) {
    if (!this.mesh || this.baseQuats.size === 0) return;

    const t = this.clock.getElapsedTime();

    // Breathing: chest expansion on Spine1
    if (this.bones.spine1) {
      const breath = Math.sin(t * 2.5) * 0.5 + 0.5;
      this.bones.spine1.scale.y = 1.0 + breath * 0.025;
      this.applyDelta("spine1", this.bones.spine1, breath * 0.015, 0, 0);
    }

    // Weight shift: slow sway on Hips
    if (this.bones.hips) {
      this.applyDelta("hips", this.bones.hips,
        0,
        Math.sin(t * 0.5) * 0.01,
        Math.sin(t * 0.8) * 0.025 + Math.sin(t * 0.3) * 0.01
      );
    }

    // Spine follows hips subtly
    if (this.bones.spine) {
      this.applyDelta("spine", this.bones.spine, 0, 0, Math.sin(t * 0.8 + 0.5) * -0.01);
    }

    // Neck + Head: layered look-around
    if (this.bones.neck) {
      this.applyDelta("neck", this.bones.neck,
        Math.sin(t * 0.6) * 0.02,
        Math.sin(t * 0.35) * 0.015,
        0
      );
    }
    if (this.bones.head) {
      this.applyDelta("head", this.bones.head,
        Math.sin(t * 1.1 + 1.0) * 0.025 + Math.sin(t * 0.3) * 0.01,
        Math.sin(t * 0.45 + 2.0) * 0.03,
        Math.sin(t * 0.7) * 0.008
      );
    }

    // Shoulders: subtle rise/fall with breathing
    const shoulderBreath = Math.sin(t * 2.5) * 0.01;
    if (this.bones.leftShoulder) {
      this.applyDelta("leftShoulder", this.bones.leftShoulder, 0, 0, shoulderBreath);
    }
    if (this.bones.rightShoulder) {
      this.applyDelta("rightShoulder", this.bones.rightShoulder, 0, 0, -shoulderBreath);
    }

    // Arms: gentle swing
    const armSwing = Math.sin(t * 0.8 + 1.0) * 0.015;
    if (this.bones.leftArm) {
      this.applyDelta("leftArm", this.bones.leftArm, armSwing, 0, 0);
    }
    if (this.bones.rightArm) {
      this.applyDelta("rightArm", this.bones.rightArm, -armSwing, 0, 0);
    }
  }

  startInteraction() {
    if (!this.client) {
      console.error("[ConvaiAgent] Cannot start — client not initialized!");
      return;
    }
    if (this._cooldown) {
      console.warn("[ConvaiAgent] ⏳ Cooldown active — please wait a moment...");
      return;
    }
    console.log("[ConvaiAgent] 🎤 Start listening...");
    this.isTalking = true;
    this.client.startAudioChunk();
  }

  stopInteraction() {
    if (!this.client) {
      console.error("[ConvaiAgent] Cannot stop — client not initialized!");
      return;
    }
    console.log("[ConvaiAgent] ⏹️ Stop listening — sending audio to Convai...");
    this.isTalking = false;
    this.client.endAudioChunk();

    // Cooldown: prevent immediate re-start so AudioRecorder can fully reset
    this._cooldown = true;
    setTimeout(() => {
      this._cooldown = false;
      console.log("[ConvaiAgent] ✅ Ready for next interaction.");
    }, 1500);
  }

  // Text-based input for testing multi-turn without mic
  sendText(text: string) {
    if (!this.client) {
      console.error("[ConvaiAgent] Cannot send text — client not initialized!");
      return;
    }
    // Must stop any playing audio and close old gRPC connection first
    this.client.stopCharacterAudio();
    console.log("[ConvaiAgent] 📝 Sending text:", text);
    this.client.sendTextChunk(text);
  }
}

export const convaiAgent = new ConvaiAgent();
