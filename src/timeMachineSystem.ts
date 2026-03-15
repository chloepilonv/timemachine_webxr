/**
 * TimeMachineSystem — manages switching between past / present / future
 * Gaussian splat worlds with wormhole video transitions.
 *
 * XR controls:
 *   A (right) / X (left) = next era (future direction)
 *   B (right) / Y (left) = previous era (past direction)
 *
 * Hardened for Quest 3: the full switchTo() flow is wrapped in an overall
 * timeout, waitForOpaque uses the system tick instead of rAF, and every
 * error path force-resets state so future transitions are never blocked.
 */

import { createSystem, Entity, VisibilityState } from "@iwsdk/core";
import {
  GaussianSplatLoader,
  GaussianSplatLoaderSystem,
} from "./gaussianSplatLoader.js";
import { Era, ERA_ORDER, WORLDS } from "./worlds.js";
import { WormholeTransition } from "./wormholeTransition.js";
import { AudioManager } from "./audioManager.js";

/** Max time for the entire switchTo flow before we force-abort. */
const SWITCH_TIMEOUT_MS = 40_000;

/** Max time to wait for the wormhole to become fully opaque. */
const OPAQUE_TIMEOUT_MS = 3_000;

/** Max time to wait for the splat to load behind the wormhole. */
const SPLAT_LOAD_TIMEOUT_MS = 30_000;

/** Max time to wait for the wormhole fade-out after signalSplatReady. */
const FADE_OUT_TIMEOUT_MS = 5_000;

export class TimeMachineSystem extends createSystem({
  splats: { required: [GaussianSplatLoader] },
}) {
  private currentEra: Era = "present";
  private splatEntity: Entity | null = null;
  private switching = false;
  private onEraChange: ((era: Era) => void) | null = null;
  private wormhole: WormholeTransition | null = null;
  private audioManager: AudioManager | null = null;

  /**
   * Resolved from the system's update() tick when the wormhole reaches
   * full opacity. This avoids using requestAnimationFrame (which doesn't
   * fire on the window in XR — the XR session has its own rAF loop).
   */
  private opaqueResolver: (() => void) | null = null;

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

      // Check if we're waiting for opaque and it has been reached
      if (this.opaqueResolver && this.wormhole.isFullyOpaque()) {
        const resolve = this.opaqueResolver;
        this.opaqueResolver = null;
        resolve();
      }
    }

    // In XR: controller buttons to switch eras
    if (this.world.visibilityState.value !== VisibilityState.NonImmersive) {
      const right = this.input?.gamepads?.right;
      const left = this.input?.gamepads?.left;

      if (right?.getButtonDown("a-button") || left?.getButtonDown("x-button")) {
        this.next().catch(() => {});
      }
      if (right?.getButtonDown("b-button") || left?.getButtonDown("y-button")) {
        this.prev().catch(() => {});
      }
    }
  }

  getEra(): Era {
    return this.currentEra;
  }

  setEraChangeCallback(cb: (era: Era) => void) {
    this.onEraChange = cb;
  }

  setAudioManager(audio: AudioManager) {
    this.audioManager = audio;
  }

  async switchTo(era: Era): Promise<void> {
    if (this.switching || era === this.currentEra) return;
    if (!this.splatEntity) return;

    this.switching = true;
    const world = WORLDS[era];
    const splatSystem = this.world.getSystem(GaussianSplatLoaderSystem)!;

    console.log(`[TimeMachine] Switching ${this.currentEra} -> ${era}`);

    // Update UI label immediately
    this.onEraChange?.(era);

    // Play transition whoosh
    this.audioManager?.playTransition();

    // Wrap the entire flow in an overall timeout so `switching` can never
    // stay true forever, no matter what goes wrong internally.
    const overallTimeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("[TimeMachine] Overall switch timeout")),
        SWITCH_TIMEOUT_MS,
      ),
    );

    try {
      await Promise.race([this.doSwitch(era, world, splatSystem), overallTimeout]);
      console.log(`[TimeMachine] Now in ${era}`);
    } catch (err) {
      console.error(`[TimeMachine] Error switching to ${era}:`, err);
      // Force-end the wormhole so it doesn't block future transitions
      this.currentEra = era;
      this.wormhole!.forceEnd();
      this.opaqueResolver = null;
    } finally {
      this.switching = false;
    }
  }

  /**
   * The actual transition logic, extracted so switchTo() can wrap it
   * in an overall timeout.
   */
  private async doSwitch(
    era: Era,
    world: { splatUrl: string; meshUrl: string },
    splatSystem: GaussianSplatLoaderSystem,
  ): Promise<void> {
    // 1. Start wormhole fade-in
    this.wormhole!.start();
    await this.waitForOpaque();

    // 2. Swap the splat behind the wormhole
    await splatSystem.unload(this.splatEntity!, { animate: false });

    this.splatEntity!.setValue(GaussianSplatLoader, "splatUrl", world.splatUrl);
    this.splatEntity!.setValue(GaussianSplatLoader, "meshUrl", world.meshUrl);

    await Promise.race([
      splatSystem.load(this.splatEntity!, { animate: false }),
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error("[TimeMachine] Splat load timed out")),
          SPLAT_LOAD_TIMEOUT_MS,
        ),
      ),
    ]);

    // 3. Splat loaded — crossfade ambient audio to new era
    this.currentEra = era;
    this.audioManager?.switchEra(era);

    // 4. Fade out wormhole + transition audio
    this.wormhole!.signalSplatReady();
    await Promise.race([
      this.wormhole!.waitForComplete(),
      new Promise<void>((r) => setTimeout(r, FADE_OUT_TIMEOUT_MS)),
    ]);

    // Stop transition audio
    this.audioManager?.stopTransition();

    // If the wormhole is somehow still active after the timeout, force it off.
    if (this.wormhole!.isActive()) {
      console.warn("[TimeMachine] Wormhole still active after fade-out timeout — forcing end");
      this.wormhole!.forceEnd();
    }
  }

  /**
   * Wait for the wormhole to reach full opacity.
   *
   * Uses a promise that is resolved from the system's update() tick
   * rather than requestAnimationFrame. This is critical on Quest 3:
   * in an XR session, window.requestAnimationFrame does not fire —
   * only the XR session's rAF runs, which drives the system update loop.
   */
  private waitForOpaque(): Promise<void> {
    return new Promise((resolve) => {
      // If already opaque (shouldn't happen, but be safe), resolve now
      if (this.wormhole!.isFullyOpaque()) {
        resolve();
        return;
      }

      // Set the resolver so update() can trigger it
      this.opaqueResolver = resolve;

      // Timeout: don't hang forever if tick never reaches opacity
      setTimeout(() => {
        if (this.opaqueResolver === resolve) {
          console.warn("[TimeMachine] waitForOpaque timed out");
          this.opaqueResolver = null;
          resolve();
        }
      }, OPAQUE_TIMEOUT_MS);
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
