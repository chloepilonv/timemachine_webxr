/**
 * TimeMachineSystem — manages switching between past / present / future
 * Gaussian splat worlds with wormhole video transitions.
 */

import { createSystem, Entity } from "@iwsdk/core";
import {
  GaussianSplatLoader,
  GaussianSplatLoaderSystem,
} from "./gaussianSplatLoader.js";
import { Era, ERA_ORDER, WORLDS } from "./worlds.js";
import { WormholeTransition } from "./wormholeTransition.js";

export class TimeMachineSystem extends createSystem({
  splats: { required: [GaussianSplatLoader] },
}) {
  private currentEra: Era = "present";
  private splatEntity: Entity | null = null;
  private switching = false;
  private onEraChange: ((era: Era) => void) | null = null;
  private wormhole: WormholeTransition | null = null;

  init() {
    this.wormhole = new WormholeTransition(this.world.scene);

    this.queries.splats.subscribe("qualify", (entity) => {
      if (!this.splatEntity) {
        this.splatEntity = entity;
      }
    });
  }

  update() {
    // Drive the wormhole animation every frame
    if (this.wormhole?.isActive()) {
      this.wormhole.tick(this.world.camera);
    }
  }

  getEra(): Era {
    return this.currentEra;
  }

  setEraChangeCallback(cb: (era: Era) => void) {
    this.onEraChange = cb;
  }

  async switchTo(era: Era): Promise<void> {
    if (this.switching || era === this.currentEra) return;
    if (!this.splatEntity) return;

    this.switching = true;
    const world = WORLDS[era];
    const splatSystem = this.world.getSystem(GaussianSplatLoaderSystem)!;

    // Update UI immediately
    this.onEraChange?.(era);

    try {
      // 1. Start wormhole video (fades in over the current scene)
      await this.wormhole!.play();

      // 2. Now fully covered — unload old splat (no animation needed)
      await splatSystem.unload(this.splatEntity, { animate: false });

      // 3. Update component URLs
      this.splatEntity.setValue(GaussianSplatLoader, "splatUrl", world.splatUrl);
      this.splatEntity.setValue(GaussianSplatLoader, "meshUrl", world.meshUrl);

      // 4. Load new splat while wormhole video plays
      await splatSystem.load(this.splatEntity, { animate: false });

      // 5. Splat is ready — tell wormhole it can fade out
      //    (waits for video to finish if still playing)
      this.wormhole!.signalSplatReady();
      await this.wormhole!.waitForComplete();

      this.currentEra = era;
      console.log(`[TimeMachine] Switched to ${era}`);
    } catch (err) {
      console.error(`[TimeMachine] Failed to switch to ${era}:`, err);
      // Revert UI on failure
      this.onEraChange?.(this.currentEra);
      // Force-end transition so user isn't stuck
      this.wormhole!.signalSplatReady();
    } finally {
      this.switching = false;
    }
  }

  async next(): Promise<void> {
    const idx = ERA_ORDER.indexOf(this.currentEra);
    const nextEra = ERA_ORDER[(idx + 1) % ERA_ORDER.length];
    await this.switchTo(nextEra);
  }

  async prev(): Promise<void> {
    const idx = ERA_ORDER.indexOf(this.currentEra);
    const prevEra =
      ERA_ORDER[(idx - 1 + ERA_ORDER.length) % ERA_ORDER.length];
    await this.switchTo(prevEra);
  }
}
