
import { Types, createComponent, createSystem, Entity } from "@iwsdk/core";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GaussianSplatAnimator } from "./gaussianSplatAnimator.js";


// ------------------------------------------------------------
// Constants & Types
// ------------------------------------------------------------
const LOAD_TIMEOUT_MS = 120_000;

interface SplatInstance {
  splat: SplatMesh;
  collider: THREE.Group | null;
  animator: GaussianSplatAnimator | null;
}


// ------------------------------------------------------------
// Component – marks an entity as a Gaussian Splat host
// ------------------------------------------------------------
/**
 * Marks an entity as a Gaussian Splat host. Attach to any entity with an
 * `object3D`; the system will load the splat (and optional collider) as
 * children so they inherit the entity's transform.
 */
export const GaussianSplatLoader = createComponent("GaussianSplatLoader", {
  splatUrl: { type: Types.String, default: "./splats/sensai.spz" },
  meshUrl: { type: Types.String, default: "" },
  autoLoad: { type: Types.Boolean, default: true },
  animate: { type: Types.Boolean, default: false },
  enableLod: { type: Types.Boolean, default: true },
  lodSplatScale: { type: Types.Float32, default: 1.0 },
});


// ------------------------------------------------------------
// System – loads, unloads, and animates Gaussian Splats
// ------------------------------------------------------------
/**
 * Manages loading, unloading, and animation of Gaussian Splats for entities
 * that carry {@link GaussianSplatLoader}. Auto-loads when `autoLoad` is true;
 * call `load()` / `unload()` / `replayAnimation()` for manual control.
 */
export class GaussianSplatLoaderSystem extends createSystem({
  splats: { required: [GaussianSplatLoader] },
}) {

  // ----------------------------------------------------------
  // State
  // ----------------------------------------------------------
  private instances = new Map<number, SplatInstance>();
  private animating = new Set<number>();
  private gltfLoader = new GLTFLoader();
  private sparkRenderer: SparkRenderer | null = null;


  // ----------------------------------------------------------
  // Initialization
  // ----------------------------------------------------------
  init() {
    const isMobile = /Android|Pico|Quest|OculusBrowser/i.test(
      navigator.userAgent,
    );
    const spark = new SparkRenderer({
      renderer: this.world.renderer,
      enableLod: true,
      lodSplatScale: isMobile ? 0.8 : 2.0,
      behindFoveate: isMobile ? 0.1 : 1.0,
    });
    spark.outsideFoveate = isMobile ? 0.2 : 1.0;
    console.log(
      `[SparkRenderer] mode=${isMobile ? "mobile" : "desktop"} lodSplatScale=${spark.lodSplatScale}`,
    );
    spark.renderOrder = -10;
    this.world.scene.add(spark);
    this.sparkRenderer = spark;

    // SparkJS driveLod() deep-clones the camera every frame. IWSDK's
    // camera has UIKitDocument children that crash during any copy/clone
    // chain (even non-recursive), so we bypass it entirely and construct
    // a plain PerspectiveCamera with only the transform/projection data
    // SparkJS needs for LoD distance calculations.
    const cam = this.world.camera as THREE.PerspectiveCamera;
    cam.clone = function () {
      const c = new THREE.PerspectiveCamera();
      c.projectionMatrix.copy(this.projectionMatrix);
      c.projectionMatrixInverse.copy(this.projectionMatrixInverse);
      c.matrixWorld.copy(this.matrixWorld);
      c.matrixWorldInverse.copy(this.matrixWorldInverse);
      return c;
    };

    this.queries.splats.subscribe("qualify", (entity) => {
      const autoLoad = entity.getValue(
        GaussianSplatLoader,
        "autoLoad",
      ) as boolean;
      if (!autoLoad) return;

      this.load(entity).catch((err) => {
        console.error(
          `[GaussianSplatLoader] Auto-load failed for entity ${entity.index}:`,
          err,
        );
      });
    });
  }


  // ----------------------------------------------------------
  // Frame Loop
  // ----------------------------------------------------------
  update() {
    if (this.animating.size === 0) return;

    for (const entityIndex of this.animating) {
      const instance = this.instances.get(entityIndex);
      if (!instance?.animator?.isAnimating) {
        this.animating.delete(entityIndex);
        continue;
      }
      instance.animator.tick();
      if (!instance.animator.isAnimating) {
        this.animating.delete(entityIndex);
      }
    }
  }


  // ----------------------------------------------------------
  // Load – fetch the .spz splat (and optional collider mesh)
  // ----------------------------------------------------------
  async load(
    entity: Entity,
    options?: { animate?: boolean },
  ): Promise<void> {
    const splatUrl = entity.getValue(GaussianSplatLoader, "splatUrl") as string;
    const meshUrl = entity.getValue(GaussianSplatLoader, "meshUrl") as string;
    const animate =
      options?.animate ??
      (entity.getValue(GaussianSplatLoader, "animate") as boolean);

    if (!splatUrl) {
      throw new Error(
        `[GaussianSplatLoader] Entity ${entity.index} has an empty splatUrl.`,
      );
    }

    const parent = entity.object3D;
    if (!parent) {
      throw new Error(
        `[GaussianSplatLoader] Entity ${entity.index} has no object3D.`,
      );
    }

    if (this.instances.has(entity.index)) {
      await this.unload(entity, { animate: false });
    }

    const enableLod = entity.getValue(
      GaussianSplatLoader,
      "enableLod",
    ) as boolean;
    const lodSplatScale = entity.getValue(
      GaussianSplatLoader,
      "lodSplatScale",
    ) as number;

    if (this.sparkRenderer && lodSplatScale !== 1.0) {
      this.sparkRenderer.lodSplatScale = lodSplatScale;
    }

    const splat = new SplatMesh({
      url: splatUrl,
      lod: enableLod || undefined,
    });
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `[GaussianSplatLoader] Timed out loading "${splatUrl}" after ${LOAD_TIMEOUT_MS / 1000}s`,
            ),
          ),
        LOAD_TIMEOUT_MS,
      );
    });
    await Promise.race([splat.initialized, timeout]);

    let collider: THREE.Group | null = null;
    if (meshUrl) {
      const gltf = await this.gltfLoader.loadAsync(meshUrl);
      collider = gltf.scene;
      collider.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) child.visible = false;
      });
    }

    const animator = new GaussianSplatAnimator(splat);
    animator.apply();
    if (!animate) animator.setProgress(1);

    // Render splats behind UI panels (which use AlwaysDepth + high renderOrder)
    splat.renderOrder = -10;
    parent.add(splat);
    if (collider) parent.add(collider);

    this.instances.set(entity.index, { splat, collider, animator });
    console.log(
      `[GaussianSplatLoader] Loaded splat for entity ${entity.index}` +
        `${collider ? " (with collider)" : ""}`,
    );

    if (animate) {
      this.animating.add(entity.index);
      await animator.animateIn();
    }
  }


  // ----------------------------------------------------------
  // Replay – restart the fly-in animation on an existing splat
  // ----------------------------------------------------------
  async replayAnimation(
    entity: Entity,
    options?: { duration?: number },
  ): Promise<void> {
    const instance = this.instances.get(entity.index);
    if (!instance?.animator) return;

    instance.animator.stop();
    instance.animator.setProgress(0);
    this.animating.add(entity.index);
    await instance.animator.animateIn(options?.duration);
  }


  // ----------------------------------------------------------
  // Unload – remove the splat (and collider) from the scene
  // ----------------------------------------------------------
  async unload(
    entity: Entity,
    options?: { animate?: boolean },
  ): Promise<void> {
    const instance = this.instances.get(entity.index);
    if (!instance) return;

    const animate =
      options?.animate ??
      (entity.getValue(GaussianSplatLoader, "animate") as boolean);

    if (animate && instance.animator) {
      this.animating.add(entity.index);
      await instance.animator.animateOut();
    }

    this.removeInstance(entity.index);
  }


  // ----------------------------------------------------------
  // Cleanup – dispose GPU resources and detach from the scene
  // ----------------------------------------------------------
  private removeInstance(entityIndex: number): void {
    const instance = this.instances.get(entityIndex);
    if (!instance) return;

    this.animating.delete(entityIndex);
    instance.animator?.dispose();
    instance.splat.parent?.remove(instance.splat);
    instance.splat.dispose();

    if (instance.collider) {
      instance.collider.parent?.remove(instance.collider);
      instance.collider.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.geometry.dispose();
          const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          for (const mat of materials) mat.dispose();
        }
      });
    }

    this.instances.delete(entityIndex);
    console.log(
      `[GaussianSplatLoader] Unloaded splat for entity ${entityIndex}`,
    );
  }
}
