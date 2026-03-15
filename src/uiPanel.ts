import {
  createSystem,
  Entity,
  PanelUI,
  PanelDocument,
  eq,
  VisibilityState,
  UIKitDocument,
  UIKit,
} from "@iwsdk/core";
import * as THREE from "three";
import { Era, WORLDS } from "./worlds.js";
import { TimeMachineSystem } from "./timeMachineSystem.js";
import { convaiAgent } from "./convaiAgent.js";

// Render UI on top of splats using AlwaysDepth + high renderOrder.
const UI_RENDER_ORDER = 10_000;
const APPLIED_FLAG = "__uiDepthConfigApplied";

function configureUIMaterial(material: THREE.Material | null | undefined) {
  if (!material) return;
  material.depthTest = true;
  material.depthWrite = true;
  material.depthFunc = THREE.AlwaysDepth;

  if (material instanceof THREE.MeshBasicMaterial && material.map) {
    material.transparent = true;
    material.alphaTest = 0.01;
  }
}

function applyRenderOrderToObject(object3D: THREE.Object3D) {
  object3D.traverse((obj) => {
    obj.renderOrder = UI_RENDER_ORDER;

    if (obj instanceof THREE.Mesh) {
      if (obj.userData[APPLIED_FLAG]) return;
      obj.userData[APPLIED_FLAG] = true;

      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => configureUIMaterial(m));
      } else {
        configureUIMaterial(obj.material);
      }

      const originalOnBeforeRender = obj.onBeforeRender;
      obj.onBeforeRender = function (
        renderer,
        scene,
        camera,
        geometry,
        material,
        group,
      ) {
        configureUIMaterial(material as THREE.Material);
        if (typeof originalOnBeforeRender === "function") {
          originalOnBeforeRender.call(
            this,
            renderer,
            scene,
            camera,
            geometry,
            material,
            group,
          );
        }
      };
    }
  });
}

export function makeEntityRenderOnTop(entity: Entity): void {
  let attempts = 0;

  const tryApply = () => {
    if (entity.object3D) {
      applyRenderOrderToObject(entity.object3D);
      return;
    }
    if (++attempts < 10) {
      requestAnimationFrame(tryApply);
    }
  };

  tryApply();
}

export class PanelSystem extends createSystem({
  tmPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, "config", "./ui/timemachine.json")],
  },
}) {
  init() {
    this.queries.tmPanel.subscribe(
      "qualify",
      (entity) => {
        makeEntityRenderOnTop(entity);

        const document = PanelDocument.data.document[
          entity.index
        ] as UIKitDocument;
        if (!document) return;

        const timeMachine = this.world.getSystem(TimeMachineSystem)!;

        // --- XR button ---
        const xrButton = document.getElementById("xr-button") as UIKit.Text;
        xrButton.addEventListener("click", () => {
          if (
            this.world.visibilityState.value === VisibilityState.NonImmersive
          ) {
            this.world.launchXR();
          } else {
            this.world.exitXR();
          }
        });

        this.world.visibilityState.subscribe((state) => {
          xrButton.setProperties({
            text:
              state === VisibilityState.NonImmersive
                ? "Enter XR"
                : "Exit to Browser",
          });
        });

        // --- Convai Talk Button ---
        const talkButton = document.getElementById("talk-button") as UIKit.Text;
        talkButton.addEventListener("click", () => {
          if (!convaiAgent.isTalking) {
            convaiAgent.startInteraction();
            talkButton.setProperties({
              text: "Stop Talking",
              style: { backgroundColor: "#d9381e" }
            });
          } else {
            convaiAgent.stopInteraction();
            talkButton.setProperties({
              text: "Start Talking to Agent",
              style: { backgroundColor: "#228b22" }
            });
          }
        });

        // --- Convai Text Test Button (for debugging multi-turn) ---
        const testTextButton = document.getElementById("test-text-button") as UIKit.Text;
        let testMessageIndex = 0;
        const testMessages = [
          "Hello, who are you?",
          "Tell me about this building's history.",
          "What year was it built?",
        ];
        testTextButton.addEventListener("click", () => {
          const msg = testMessages[testMessageIndex % testMessages.length];
          testMessageIndex++;
          convaiAgent.sendText(msg);
          testTextButton.setProperties({
            text: `Sent: "${msg.substring(0, 20)}..."`,
          });
          setTimeout(() => {
            testTextButton.setProperties({ text: "Send Test Text" });
          }, 3000);
        });

        // --- Era labels ---
        const eraLabel = document.getElementById("era-label") as UIKit.Text;
        const yearLabel = document.getElementById("year-label") as UIKit.Text;
        const eraPast = document.getElementById("era-past") as UIKit.Text;
        const eraPresent = document.getElementById(
          "era-present",
        ) as UIKit.Text;
        const eraFuture = document.getElementById("era-future") as UIKit.Text;

        const eraButtons: Record<Era, UIKit.Text> = {
          past: eraPast,
          present: eraPresent,
          future: eraFuture,
        };

        const updateUI = (era: Era) => {
          const w = WORLDS[era];
          eraLabel.setProperties({ text: w.label });
          yearLabel.setProperties({ text: w.year });

          // Update active state styling
          for (const [key, btn] of Object.entries(eraButtons)) {
            btn.setProperties({
              style: {
                backgroundColor:
                  key === era ? "#7b2ff2" : "#1a1a2e",
                borderColor:
                  key === era ? "#9b5ff8" : "#444466",
                color: key === era ? "#ffffff" : "#a0a0b0",
                fontWeight: key === era ? "bold" : "normal",
              },
            });
          }
        };

        timeMachine.setEraChangeCallback(updateUI);

        // --- Navigation buttons ---
        const prevButton = document.getElementById(
          "prev-button",
        ) as UIKit.Text;
        const nextButton = document.getElementById(
          "next-button",
        ) as UIKit.Text;

        prevButton.addEventListener("click", () => {
          timeMachine.prev();
        });

        nextButton.addEventListener("click", () => {
          timeMachine.next();
        });

        // --- Direct era buttons ---
        eraPast.addEventListener("click", () => {
          timeMachine.switchTo("past");
        });

        eraPresent.addEventListener("click", () => {
          timeMachine.switchTo("present");
        });

        eraFuture.addEventListener("click", () => {
          timeMachine.switchTo("future");
        });
      },
      true,
    );
  }
}
