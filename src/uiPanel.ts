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

        // --- Era labels ---
        const eraLabel = document.getElementById("era-label") as UIKit.Text;
        const yearLabel = document.getElementById("year-label") as UIKit.Text;

        // --- Travel buttons ---
        const btnPast = document.getElementById("btn-past") as UIKit.Text;
        const btnPresent = document.getElementById("btn-present") as UIKit.Text;
        const btnFuture = document.getElementById("btn-future") as UIKit.Text;

        const updateUI = (era: Era) => {
          const w = WORLDS[era];
          eraLabel.setProperties({ text: w.label });
          yearLabel.setProperties({ text: w.year });
        };

        timeMachine.setEraChangeCallback(updateUI);

        btnPast.addEventListener("click", () => {
          timeMachine.switchTo("past");
        });

        btnPresent.addEventListener("click", () => {
          timeMachine.switchTo("present");
        });

        btnFuture.addEventListener("click", () => {
          timeMachine.switchTo("future");
        });
      },
      true,
    );
  }
}
