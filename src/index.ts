
import * as THREE from "three";
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
    world.camera.position.set(0, 1.5, 0);

    world.scene.background = new THREE.Color(0x000000);
    world.scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    world
      .registerSystem(PanelSystem)
      .registerSystem(GaussianSplatLoaderSystem)
      .registerSystem(TimeMachineSystem);


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

    // Play splat animation when entering XR
    world.visibilityState.subscribe((state) => {
      if (state !== VisibilityState.NonImmersive) {
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
        const doc = PanelDocument.data.document[panelEntity.index];
        if (doc && doc.parent !== panelEntity.object3D) {
          panelEntity.object3D!.add(doc);
        }
      }
    });
  })
  .catch((err) => {
    console.error("[World] Failed to create the IWSDK world:", err);
  });
