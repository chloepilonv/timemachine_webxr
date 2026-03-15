
import * as THREE from "three";
import GUI from "lil-gui";
import {
  EnvironmentType,
  Interactable,
  LocomotionEnvironment,
  Mesh,
  MeshBasicMaterial,
  PanelDocument,
  PanelUI,
  PlaneGeometry,
  ScreenSpace,
  SessionMode,
  VisibilityState,
  World,
} from "@iwsdk/core";
import { PanelSystem } from "./uiPanel.js";
import {
  GaussianSplatLoader,
  GaussianSplatLoaderSystem,
} from "./gaussianSplatLoader.js";
import { TimeMachineSystem } from "./timeMachineSystem.js";
import { WORLDS } from "./worlds.js";
import { AudioManager } from "./audioManager.js";


// ------------------------------------------------------------
// World (IWSDK settings)
// ------------------------------------------------------------
World.create(document.getElementById("scene-container") as HTMLDivElement, {
  assets: {},
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    offer: "always",
    features: { handTracking: true, layers: true },
  },
  render: {
    defaultLighting: false,
  },
  features: {
    locomotion: true,
    grabbing: true,
    physics: false,
    sceneUnderstanding: false,
  },
})
  .then((world) => {
    world.camera.position.set(0, 0.2, 0);

    // Splat capture viewpoint height. See Y-POS.md.
    const SPLAT_EYE_HEIGHT = 0.2;

    world.scene.background = new THREE.Color(0x000000);
    world.scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    world
      .registerSystem(PanelSystem)
      .registerSystem(GaussianSplatLoaderSystem)
      .registerSystem(TimeMachineSystem);

    // Initialize Convai voice agent (lazy load — won't crash app if SDK fails)
    let agentMesh: THREE.Object3D | null = null;
    import("./convaiAgent.js")
      .then(async ({ convaiAgent }) => {
        convaiAgent.init();
        await convaiAgent.loadModel(world.scene, new THREE.Vector3(0.5, 0.05, -1.95));
        agentMesh = convaiAgent.mesh;
        if (agentMesh) {
          agentMesh.scale.setScalar(0.45);
          agentMesh.rotation.y = -0.54;
        }

        // Debug GUI for avatar placement — set to true to enable, false for prod
        const AVATAR_TUNER = true;
        if (agentMesh && AVATAR_TUNER) {
          const gui = new GUI({ title: "Avatar Tuner" });
          const pos = gui.addFolder("Position");
          pos.add(agentMesh.position, "x", -5, 5, 0.05).listen();
          pos.add(agentMesh.position, "y", -2, 3, 0.05).listen();
          pos.add(agentMesh.position, "z", -10, 2, 0.05).listen();
          const scl = gui.addFolder("Scale");
          const uniformScale = { value: agentMesh.scale.x };
          scl.add(uniformScale, "value", 0.1, 3, 0.05).name("uniform").onChange((v: number) => {
            agentMesh!.scale.setScalar(v);
          });
          const rot = gui.addFolder("Rotation");
          rot.add(agentMesh.rotation, "y", -Math.PI, Math.PI, 0.05).name("y (turn)").listen();
          gui.add({
            log() {
              const m = agentMesh!;
              console.log(`Position: (${m.position.x.toFixed(2)}, ${m.position.y.toFixed(2)}, ${m.position.z.toFixed(2)})`);
              console.log(`Scale: ${m.scale.x.toFixed(2)}`);
              console.log(`Rotation Y: ${m.rotation.y.toFixed(2)}`);
            },
          }, "log").name("Log values to console");
        }
      })
      .catch((err) => {
        console.warn("[World] Convai agent unavailable:", err);
      });

    // Initialize audio (ambient loops + transition sound)
    const audioManager = new AudioManager(world.camera);
    const timeMachine = world.getSystem(TimeMachineSystem)!;
    timeMachine.setAudioManager(audioManager);

    // Start ambient audio on first XR entry or user interaction
    world.visibilityState.subscribe((state) => {
      if (state !== VisibilityState.NonImmersive) {
        audioManager.start("present");
      }
    });


    // ------------------------------------------------------------
    // Gaussian Splat — starts with the present-day world
    // ------------------------------------------------------------
    const presentWorld = WORLDS.present;
    const splatEntity = world.createTransformEntity();
    splatEntity.addComponent(GaussianSplatLoader, {
      splatUrl: presentWorld.splatUrl,
      meshUrl: presentWorld.meshUrl,
      autoLoad: true,
      animate: false,
      enableLod: true,
      lodSplatScale: 1.0,
    });

    const splatSystem = world.getSystem(GaussianSplatLoaderSystem)!;

    // In VR, local-floor puts eyes at ~1.6m but splat viewpoint is at
    // SPLAT_EYE_HEIGHT. Lift the splat so its viewpoint matches user eyes.
    const VR_SCENE_LIFT = 1.6 - SPLAT_EYE_HEIGHT; // ~1.4m
    world.visibilityState.subscribe((state) => {
      const inVR = state !== VisibilityState.NonImmersive;
      splatEntity.object3D!.position.y = inVR ? VR_SCENE_LIFT : 0;
      if (agentMesh) agentMesh.position.y = inVR ? VR_SCENE_LIFT + 0.05 : 0.05;

      if (inVR) {
        splatSystem.replayAnimation(splatEntity).catch((err) => {
          console.error("[World] Failed to replay splat animation:", err);
        });
      }
    });


    // ------------------------------------------------------------
    // Invisible floor for locomotion
    // ------------------------------------------------------------
    const floorGeometry = new PlaneGeometry(100, 100);
    floorGeometry.rotateX(-Math.PI / 2);
    const floor = new Mesh(floorGeometry, new MeshBasicMaterial());
    floor.visible = false;
    world
      .createTransformEntity(floor)
      .addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC });

    const grid = new THREE.GridHelper(100, 100, 0x444444, 0x222222);
    grid.material.transparent = true;
    grid.material.opacity = 0.4;
    world.scene.add(grid);


    // ------------------------------------------------------------
    // Panel UI — Time Machine controls
    // ------------------------------------------------------------
    const panelEntity = world
      .createTransformEntity()
      .addComponent(PanelUI, {
        config: "./ui/timemachine.json",
        maxHeight: 0.8,
        maxWidth: 1.6,
      })
      .addComponent(Interactable)
      .addComponent(ScreenSpace, {
        top: "30%",
        bottom: "30%",
        left: "30%",
        right: "30%",
        height: "40%",
        width: "40%",
      });
    panelEntity.object3D!.position.set(0, 1.29, -1.9);

    // In XR: remove ScreenSpace and re-parent the UIKitDocument back to
    // the panel entity so the raycaster can find it. Without this, the
    // document stays under the camera (where ScreenSpaceUISystem put it)
    // and controller rays never intersect it.
    world.visibilityState.subscribe((state) => {
      if (state === VisibilityState.NonImmersive) {
        if (!panelEntity.hasComponent(ScreenSpace)) {
          panelEntity.addComponent(ScreenSpace, {
            top: "30%",
            bottom: "30%",
            left: "30%",
            right: "30%",
            height: "40%",
            width: "40%",
          });
        }
      } else {
        if (panelEntity.hasComponent(ScreenSpace)) {
          panelEntity.removeComponent(ScreenSpace);
        }
        // Re-parent UIKitDocument from camera back to panel entity
        const doc = PanelDocument.data.document[panelEntity.index] as THREE.Object3D | undefined;
        if (doc && doc.parent !== panelEntity.object3D) {
          panelEntity.object3D!.add(doc);
        }
      }
    });
  })
  .catch((err) => {
    console.error("[World] Failed to create the IWSDK world:", err);
  });
