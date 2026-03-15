
import * as THREE from "three";
import {
  EnvironmentType,
  LocomotionEnvironment,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
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
import { TemporalConsole } from "./temporalConsole.js";
import { WelcomePanel } from "./welcomePanel.js";

// ------------------------------------------------------------
// HTML Elements
// ------------------------------------------------------------
const menu = document.getElementById("main-menu")!;
const enterBtn = document.getElementById("enter-btn") as HTMLButtonElement;
const loadingBar = document.getElementById("loading-bar")!;
const loadingBarContainer = document.getElementById("loading-bar-container")!;
const loadingStatus = document.getElementById("loading-status")!;
const talkBtnPersistent = document.getElementById("talk-btn-persistent")!;

let audioStarted = false;
let entered = false; // true once user has entered the experience

// Talk toggle for desktop button
talkBtnPersistent.addEventListener("click", () => {
  import("./convaiAgent.js")
    .then(({ convaiAgent }) => {
      if (convaiAgent.isTalking) {
        convaiAgent.stopInteraction();
        talkBtnPersistent.textContent = "Talk to Agent";
      } else {
        convaiAgent.startInteraction();
        talkBtnPersistent.textContent = "Stop Talking";
      }
    })
    .catch(() => {});
});

// Loading bar animation while world initializes
let loadProgress = 0;
const loadInterval = setInterval(() => {
  loadProgress = Math.min(loadProgress + Math.random() * 15, 90);
  loadingBar.style.width = `${loadProgress}%`;
}, 300);

// Called when the user enters (from HTML button or VR)
function enterExperience(
  welcomePanel: WelcomePanel,
  temporalConsole: TemporalConsole | null,
  audioManager: AudioManager,
  timeMachine: TimeMachineSystem,
) {
  if (entered) return;
  entered = true;

  welcomePanel.hide();
  if (temporalConsole) temporalConsole.show();
  talkBtnPersistent.classList.add("visible");

  // Fade out HTML menu
  menu.classList.add("fade-out");
  setTimeout(() => menu.classList.add("hidden"), 1500);

  if (!audioStarted) {
    audioStarted = true;
    audioManager.start("present");
  }

  // Briefly disable A/B so the trigger pull that entered doesn't
  // also trigger next era
  timeMachine.disableInput();
  setTimeout(() => timeMachine.enableInput(), 800);
}

// ------------------------------------------------------------
// World
// ------------------------------------------------------------
World.create(document.getElementById("scene-container") as HTMLDivElement, {
  assets: {},
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    offer: "always",
    features: { handTracking: true, layers: true },
  },
  render: { defaultLighting: false },
  features: {
    locomotion: true,
    grabbing: true,
    physics: false,
    sceneUnderstanding: false,
  },
})
  .then(async (world) => {
    world.camera.position.set(0, 0.2, 0);
    const SPLAT_EYE_HEIGHT = 0.6;

    world.scene.background = new THREE.Color(0x000000);
    world.scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    world
      .registerSystem(PanelSystem)
      .registerSystem(GaussianSplatLoaderSystem)
      .registerSystem(TimeMachineSystem);

    // ── Convai agent ──
    let agentMesh: THREE.Object3D | null = null;
    import("./convaiAgent.js")
      .then(async ({ convaiAgent }) => {
        convaiAgent.init();
        await convaiAgent.loadModel(world.scene, new THREE.Vector3(0.5, 0.6, -1.95));
        agentMesh = convaiAgent.mesh;
        if (agentMesh) {
          agentMesh.scale.setScalar(0.2);
          agentMesh.rotation.y = -0.54;
        }
      })
      .catch((err) => console.warn("[World] Convai agent unavailable:", err));

    // ── Audio + TimeMachine ──
    const audioManager = new AudioManager(world.camera);
    const timeMachine = world.getSystem(TimeMachineSystem)!;
    timeMachine.setAudioManager(audioManager);

    timeMachine.setEraChangeCallback((era) => {
      import("./convaiAgent.js")
        .then(({ convaiAgent }) => convaiAgent.switchEra(era))
        .catch(() => {});
    });

    // ── Gaussian Splat ──
    const presentWorld = WORLDS.present;
    const splatEntity = world.createTransformEntity();
    splatEntity.addComponent(GaussianSplatLoader, {
      splatUrl: presentWorld.splatUrl,
      meshUrl: presentWorld.meshUrl,
      autoLoad: false,
      animate: false,
      enableLod: true,
      lodSplatScale: 2.0,
    });

    const splatSystem = world.getSystem(GaussianSplatLoaderSystem)!;

    // VR height adjustment
    const VR_SCENE_LIFT = 1.6 - SPLAT_EYE_HEIGHT;
    world.visibilityState.subscribe((state) => {
      const inVR = state !== VisibilityState.NonImmersive;
      splatEntity.object3D!.position.y = inVR ? VR_SCENE_LIFT : 0;
      if (agentMesh) {
        const y = inVR ? VR_SCENE_LIFT + 0.6 : 0.6;
        agentMesh.position.y = y;
        import("./convaiAgent.js").then(({ convaiAgent }) => { (convaiAgent as any).baseY = y; });
      }
      if (inVR) {
        splatSystem.replayAnimation(splatEntity).catch(() => {});
      }
    });

    // ── Floor + Grid ──
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

    // ── 3D Console (decorative, scene-parented) ──
    const temporalConsole = new TemporalConsole(world.scene, () => {}, world.camera);
    temporalConsole.hide();

    // ── 3D Welcome Panel ──
    const welcomePanel = new WelcomePanel(world.scene, () => {
      enterExperience(welcomePanel, temporalConsole, audioManager, timeMachine);
    });

    // HTML enter button
    enterBtn.addEventListener("click", async () => {
      enterBtn.style.pointerEvents = "none";
      enterExperience(welcomePanel, temporalConsole, audioManager, timeMachine);
    });

    // ── Renderer + tick loop ──
    const renderer = (world as any).renderer as THREE.WebGLRenderer;
    if (renderer) {
      renderer.localClippingEnabled = true;
      const canvas = renderer.domElement;
      welcomePanel.setupDesktopPointer(canvas, world.camera);

      const clock = new THREE.Clock();
      const tickLoop = () => {
        requestAnimationFrame(tickLoop);
        const delta = clock.getDelta();
        welcomePanel.tick(delta, renderer);
        temporalConsole.tick(delta, renderer);

        // VR: any trigger pull dismisses welcome panel
        if (!entered && renderer.xr.isPresenting) {
          const session = renderer.xr.getSession();
          if (session) {
            for (const source of session.inputSources) {
              if (source.gamepad) {
                // Button 0 = trigger (most reliable across all headsets)
                const trigger = source.gamepad.buttons[0];
                if (trigger && trigger.pressed) {
                  enterExperience(welcomePanel, temporalConsole, audioManager, timeMachine);
                  break;
                }
              }
            }
          }
        }

        // VR: X button (left controller, button 4) toggle talk
        if (entered && renderer.xr.isPresenting) {
          const session = renderer.xr.getSession();
          if (session) {
            for (const source of session.inputSources) {
              if (source.handedness === "left" && source.gamepad) {
                const xBtn = source.gamepad.buttons[4];
                if (xBtn && xBtn.pressed && !(window as any).__xPressed) {
                  (window as any).__xPressed = true;
                  import("./convaiAgent.js")
                    .then(({ convaiAgent }) => {
                      if (convaiAgent.isTalking) {
                        convaiAgent.stopInteraction();
                      } else {
                        convaiAgent.startInteraction();
                      }
                    })
                    .catch(() => {});
                }
                if (xBtn && !xBtn.pressed) {
                  (window as any).__xPressed = false;
                }
              }
            }
          }
        }
      };
      tickLoop();

      // Grip/squeeze push-to-talk
      for (let i = 0; i < 2; i++) {
        const controller = renderer.xr.getController(i);
        controller.addEventListener("squeezestart", () => {
          import("./convaiAgent.js")
            .then(({ convaiAgent }) => { if (!convaiAgent.isTalking) convaiAgent.startInteraction(); })
            .catch(() => {});
        });
        controller.addEventListener("squeezeend", () => {
          import("./convaiAgent.js")
            .then(({ convaiAgent }) => { if (convaiAgent.isTalking) convaiAgent.stopInteraction(); })
            .catch(() => {});
        });
      }
    }

    // ── Load the initial splat, then mark ready ──
    await splatSystem.load(splatEntity, { animate: false });

    // ── World ready — show loading complete ──
    clearInterval(loadInterval);
    loadingBar.style.width = "100%";
    loadingStatus.textContent = "Ready!";
    setTimeout(() => {
      loadingBarContainer.classList.add("hidden");
      loadingStatus.classList.add("hidden");
    }, 600);
    enterBtn.disabled = false;
    enterBtn.textContent = "Enter the Time Machine";
    welcomePanel.setReady();

    // Auto-hide HTML menu in VR
    world.visibilityState.subscribe((state) => {
      if (state !== VisibilityState.NonImmersive) {
        menu.classList.add("hidden");
      }
    });
  })
  .catch((err) => {
    console.error("[World] Failed to create the IWSDK world:", err);
  });
