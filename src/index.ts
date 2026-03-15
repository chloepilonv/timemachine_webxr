
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
import { TemporalConsole } from "./temporalConsole.js";
import { WelcomePanel } from "./welcomePanel.js";

// Toggle: true = old UIKit panel, false = 3D Temporal Console
const ENABLE_UIKIT_PANEL = false;

// ------------------------------------------------------------
// Menu wiring — listeners before World.create so they respond
// immediately even if the world is still loading.
// ------------------------------------------------------------
const menu = document.getElementById("main-menu")!;
const enterBtn = document.getElementById("enter-btn") as HTMLButtonElement;
const talkBtn = document.getElementById("menu-talk-btn")!;
const loadingBar = document.getElementById("loading-bar")!;
const loadingBarContainer = document.getElementById("loading-bar-container")!;
const loadingStatus = document.getElementById("loading-status")!;
const talkBtnPersistent = document.getElementById("talk-btn-persistent")!;

let worldReadyResolve: () => void;
const worldReady = new Promise<void>((r) => { worldReadyResolve = r; });
let audioStarted = false;

let dismissWelcome: (() => void) | null = null;

enterBtn.addEventListener("click", async () => {
  enterBtn.textContent = "LOADING...";
  enterBtn.style.pointerEvents = "none";
  await worldReady;
  menu.classList.add("hidden");
  if (dismissWelcome) dismissWelcome();
  if (!audioStarted) {
    audioStarted = true;
    (window as any).__audioManager?.start("present");
  }
});

const handleTalkToggle = (btn: HTMLElement) => {
  import("./convaiAgent.js")
    .then(({ convaiAgent }) => {
      if (convaiAgent.isTalking) {
        convaiAgent.stopInteraction();
        btn.textContent = "Talk to Agent";
        talkBtn.textContent = "Start Talking to Agent";
        talkBtnPersistent.textContent = "Talk to Agent";
      } else {
        convaiAgent.startInteraction();
        btn.textContent = "Stop Talking";
        talkBtn.textContent = "Stop Talking";
        talkBtnPersistent.textContent = "Stop Talking";
      }
    })
    .catch((err) => {
      console.warn("[Menu] Convai agent unavailable:", err);
    });
};

talkBtn.addEventListener("click", () => handleTalkToggle(talkBtn));
talkBtnPersistent.addEventListener("click", () => handleTalkToggle(talkBtnPersistent));

// Simulated loading progress while world initializes
let loadProgress = 0;
const loadInterval = setInterval(() => {
  loadProgress = Math.min(loadProgress + Math.random() * 15, 90);
  loadingBar.style.width = `${loadProgress}%`;
}, 300);

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

    const SPLAT_EYE_HEIGHT = 0.6;

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
        await convaiAgent.loadModel(world.scene, new THREE.Vector3(0.5, 0.6, -1.95));
        agentMesh = convaiAgent.mesh;
        if (agentMesh) {
          agentMesh.scale.setScalar(0.2);
          agentMesh.rotation.y = -0.54;
        }
      })
      .catch((err) => {
        console.warn("[World] Convai agent unavailable:", err);
      });

    // Initialize audio
    const audioManager = new AudioManager(world.camera);
    (window as any).__audioManager = audioManager;
    const timeMachine = world.getSystem(TimeMachineSystem)!;
    timeMachine.setAudioManager(audioManager);

    // Switch Convai character when era changes
    timeMachine.setEraChangeCallback((era) => {
      import("./convaiAgent.js")
        .then(({ convaiAgent }) => convaiAgent.switchEra(era))
        .catch(() => {});
    });

    // ------------------------------------------------------------
    // Gaussian Splat — load immediately, track when done
    // ------------------------------------------------------------
    const presentWorld = WORLDS.present;
    const splatEntity = world.createTransformEntity();
    splatEntity.addComponent(GaussianSplatLoader, {
      splatUrl: presentWorld.splatUrl,
      meshUrl: presentWorld.meshUrl,
      autoLoad: true,
      animate: false,
      enableLod: true,
      lodSplatScale: 2.0,
    });

    const splatSystem = world.getSystem(GaussianSplatLoaderSystem)!;

    // Track splat loading for the menu (autoLoad handles actual loading)
    const splatLoaded = new Promise<void>((resolve) => {
      // Poll for splat mesh appearing in the entity
      const check = setInterval(() => {
        const obj = splatEntity.object3D;
        if (obj && obj.children.length > 0) {
          clearInterval(check);
          resolve();
        }
      }, 500);
      // Timeout after 30s
      setTimeout(() => { clearInterval(check); resolve(); }, 30000);
    });

    // In VR, local-floor puts eyes at ~1.6m but splat viewpoint is at
    // SPLAT_EYE_HEIGHT. Lift the splat so its viewpoint matches user eyes.
    const VR_SCENE_LIFT = 1.6 - SPLAT_EYE_HEIGHT; // ~1.4m
    world.visibilityState.subscribe((state) => {
      const inVR = state !== VisibilityState.NonImmersive;
      splatEntity.object3D!.position.y = inVR ? VR_SCENE_LIFT : 0;
      if (agentMesh) {
        const y = inVR ? VR_SCENE_LIFT + 0.6 : 0.6;
        agentMesh.position.y = y;
        import("./convaiAgent.js").then(({ convaiAgent }) => { (convaiAgent as any).baseY = y; });
      }

      if (inVR) {
        splatSystem.replayAnimation(splatEntity).catch((err) => {
          console.error("[World] Failed to replay splat animation:", err);
        });
      }
    });

    // ------------------------------------------------------------
    // Invisible floor for locomotion — must lift with splat in VR
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
    if (ENABLE_UIKIT_PANEL) {
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
          const doc = PanelDocument.data.document[panelEntity.index] as THREE.Object3D | undefined;
          if (doc && doc.parent !== panelEntity.object3D) {
            panelEntity.object3D!.add(doc);
          }
        }
      });
    }

    // ------------------------------------------------------------
    // 3D Welcome Panel + Temporal Console
    // ------------------------------------------------------------
    const renderer = (world as any).renderer as THREE.WebGLRenderer;

    // Console starts hidden — welcome panel reveals it
    let temporalConsole: TemporalConsole | null = null;
    if (!ENABLE_UIKIT_PANEL) {
      temporalConsole = new TemporalConsole(world.scene, (era) => {
        timeMachine.switchTo(era);
      }, world.camera);
      temporalConsole.hide(); // hidden until welcome panel is dismissed
    }

    // 3D Welcome panel — works in both desktop and VR
    const welcomePanel = new WelcomePanel(world.scene, () => {
      // User clicked "Enter" — start the experience
      if (!audioStarted) {
        audioStarted = true;
        audioManager.start("present");
      }
      if (temporalConsole) temporalConsole.show();
      menu.classList.add("hidden");
      talkBtnPersistent.classList.add("visible");
    });

    // Let HTML menu button also dismiss the 3D welcome panel
    dismissWelcome = () => {
      welcomePanel.hide();
      if (temporalConsole) temporalConsole.show();
      talkBtnPersistent.classList.add("visible");
    };

    if (renderer) {
      const canvas = renderer.domElement;
      welcomePanel.setupDesktopPointer(canvas, world.camera);
      if (temporalConsole) {
        temporalConsole.setupDesktopPointer(canvas, world.camera);
      }

      // Tick loop for both panels
      const clock = new THREE.Clock();
      let welcomeDismissed = false;
      const tickLoop = () => {
        requestAnimationFrame(tickLoop);
        const delta = clock.getDelta();
        welcomePanel.tick(delta, renderer);
        if (temporalConsole) temporalConsole.tick(delta, renderer);

        // A-button to enter (works on Quest + Pico) — check raw XR gamepads
        if (!welcomeDismissed && renderer.xr.isPresenting) {
          const session = renderer.xr.getSession();
          if (session) {
            for (const source of session.inputSources) {
              if (source.gamepad) {
                // Button 4 = A/X on Quest/Pico controllers
                const btn = source.gamepad.buttons[4];
                if (btn && btn.pressed) {
                  welcomeDismissed = true;
                  welcomePanel.hide();
                  if (temporalConsole) temporalConsole.show();
                  talkBtnPersistent.classList.add("visible");
                  if (!audioStarted) {
                    audioStarted = true;
                    audioManager.start("present");
                  }
                  break;
                }
              }
            }
          }
        }
      };
      tickLoop();

      // Push-to-talk: grip/squeeze on either controller (Quest + Pico)
      for (let i = 0; i < 2; i++) {
        const controller = renderer.xr.getController(i);
        controller.addEventListener("squeezestart", () => {
          import("./convaiAgent.js")
            .then(({ convaiAgent }) => {
              if (!convaiAgent.isTalking) {
                convaiAgent.startInteraction();
                console.log("[XR] Grip squeeze — start talking");
              }
            })
            .catch(() => {});
        });
        controller.addEventListener("squeezeend", () => {
          import("./convaiAgent.js")
            .then(({ convaiAgent }) => {
              if (convaiAgent.isTalking) {
                convaiAgent.stopInteraction();
                console.log("[XR] Grip release — stop talking");
              }
            })
            .catch(() => {});
        });
      }
    }

    // ------------------------------------------------------------
    // World ready — wait for splat to load, then enable menu button
    // ------------------------------------------------------------
    splatLoaded.finally(() => {
      clearInterval(loadInterval);
      loadingBar.style.width = "100%";
      loadingStatus.textContent = "Ready!";
      setTimeout(() => {
        loadingBarContainer.classList.add("hidden");
        loadingStatus.classList.add("hidden");
      }, 600);
      enterBtn.disabled = false;
      enterBtn.textContent = "Enter the Time Machine";

      worldReadyResolve!();
    });

    // Auto-hide HTML menu when entering VR (3D welcome panel stays — user must click it)
    world.visibilityState.subscribe((state) => {
      if (state !== VisibilityState.NonImmersive) {
        menu.classList.add("hidden");
      }
    });
  })
  .catch((err) => {
    console.error("[World] Failed to create the IWSDK world:", err);
  });
