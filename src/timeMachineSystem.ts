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
      // 1. Start wormhole (non-blocking — just begins fade-in)
      this.wormhole!.start();

      // 2. Wait a beat for wormhole to cover the scene
      await this.waitForOpaque();

      // 3. Unload old splat (hidden behind wormhole)
      await splatSystem.unload(this.splatEntity, { animate: false });

      // 4. Set new URLs and load
      this.splatEntity.setValue(GaussianSplatLoader, "splatUrl", world.splatUrl);
      this.splatEntity.setValue(GaussianSplatLoader, "meshUrl", world.meshUrl);
      await splatSystem.load(this.splatEntity, { animate: false });

      // 5. Splat loaded — tell wormhole to fade out
      this.wormhole!.signalSplatReady();
      await this.wormhole!.waitForComplete();

      this.currentEra = era;
      console.log(`[TimeMachine] Switched to ${era}`);
    } catch (err) {
      console.error(`[TimeMachine] Failed to switch to ${era}:`, err);
      this.onEraChange?.(this.currentEra);
      // Force end transition
      this.wormhole!.signalSplatReady();
    } finally {
      this.switching = false;
    }
  }

  private waitForOpaque(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.wormhole!.isFullyOpaque()) {
          resolve();
          return;
        }
        requestAnimationFrame(check);
      };
      // Start checking after a short delay to let the fade begin
      setTimeout(check, 50);
    });
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
