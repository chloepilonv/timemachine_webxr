/**
 * TimeMachineSystem — manages switching between past / present / future
 * Gaussian splat worlds with animated transitions.
 */

import { createSystem, Entity } from "@iwsdk/core";
import {
  GaussianSplatLoader,
  GaussianSplatLoaderSystem,
} from "./gaussianSplatLoader.js";
import { Era, ERA_ORDER, WORLDS } from "./worlds.js";

export class TimeMachineSystem extends createSystem({
  splats: { required: [GaussianSplatLoader] },
}) {
  private currentEra: Era = "present";
  private splatEntity: Entity | null = null;
  private switching = false;
  private onEraChange: ((era: Era) => void) | null = null;

  init() {
    this.queries.splats.subscribe("qualify", (entity) => {
      if (!this.splatEntity) {
        this.splatEntity = entity;
      }
    });
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

    try {
      // Animate out current splat
      await splatSystem.unload(this.splatEntity, { animate: true });

      // Update component URLs
      this.splatEntity.setValue(GaussianSplatLoader, "splatUrl", world.splatUrl);
      this.splatEntity.setValue(
        GaussianSplatLoader,
        "meshUrl",
        world.meshUrl,
      );

      // Load new splat with animation
      await splatSystem.load(this.splatEntity, { animate: true });

      this.currentEra = era;
      this.onEraChange?.(era);
    } catch (err) {
      console.error(`[TimeMachine] Failed to switch to ${era}:`, err);
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
