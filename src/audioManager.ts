/**
 * AudioManager — handles ambient era loops and transition sound effects.
 *
 * - Each era has a looping ambient track that crossfades on era switch
 * - A one-shot wormhole sound plays during transitions
 * - Ambient volume is kept low (~0.15) so it doesn't compete with the
 *   Convai voice agent
 * - All audio is non-positional (global background)
 */

import * as THREE from "three";
import { Era } from "./worlds.js";

const AMBIENT_VOLUME = 0.15; // low — voice agent needs headroom
const CROSSFADE_MS = 800;
const TRANSITION_VOLUME = 0.4;

const AMBIENT_URLS: Record<Era, string> = {
  past: "./audio/past_ambient_sound.mp3",
  present: "./audio/present_ambient_sound.mp3",
  future: "./audio/future_ambient_sound.mp3",
};

const TRANSITION_URL = "./audio/wormhole_transition.mp3";

export class AudioManager {
  private listener: THREE.AudioListener;
  private ambientTracks: Map<Era, THREE.Audio> = new Map();
  private transitionSound: THREE.Audio;
  private loader: THREE.AudioLoader;
  private currentEra: Era = "present";
  private initialized = false;

  constructor(camera: THREE.Camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);

    this.loader = new THREE.AudioLoader();
    this.transitionSound = new THREE.Audio(this.listener);

    // Load transition sound (trimmed to ~6s, plays once per transition)
    this.loader.load(TRANSITION_URL, (buffer) => {
      this.transitionSound.setBuffer(buffer);
      this.transitionSound.setVolume(TRANSITION_VOLUME);
      this.transitionSound.setLoop(false);
    });

    // Load ambient tracks
    for (const era of ["past", "present", "future"] as Era[]) {
      const audio = new THREE.Audio(this.listener);
      this.ambientTracks.set(era, audio);

      this.loader.load(AMBIENT_URLS[era], (buffer) => {
        audio.setBuffer(buffer);
        audio.setVolume(0);
        audio.setLoop(true);
      });
    }
  }

  /**
   * Start playing the ambient track for the initial era.
   * Must be called after a user gesture (browser autoplay policy).
   */
  start(era: Era = "present"): void {
    if (this.initialized) return;
    this.initialized = true;
    this.currentEra = era;

    const track = this.ambientTracks.get(era);
    if (track?.buffer && !track.isPlaying) {
      track.setVolume(AMBIENT_VOLUME);
      track.play();
    }
  }

  /**
   * Crossfade from the current ambient track to the new era's track.
   */
  switchEra(newEra: Era): void {
    if (newEra === this.currentEra && this.initialized) return;

    if (!this.initialized) {
      this.start(newEra);
      return;
    }

    // Fade out current
    const oldTrack = this.ambientTracks.get(this.currentEra);
    if (oldTrack?.isPlaying) {
      this.fadeOut(oldTrack, CROSSFADE_MS);
    }

    // Fade in new
    const newTrack = this.ambientTracks.get(newEra);
    if (newTrack?.buffer) {
      if (!newTrack.isPlaying) {
        newTrack.setVolume(0);
        newTrack.play();
      }
      this.fadeIn(newTrack, AMBIENT_VOLUME, CROSSFADE_MS);
    }

    this.currentEra = newEra;
  }

  /**
   * Play the wormhole transition sound.
   */
  playTransition(): void {
    if (this.transitionSound.buffer) {
      if (this.transitionSound.isPlaying) {
        this.transitionSound.stop();
      }
      this.transitionSound.play();
    }
  }

  /**
   * Fade out and stop the transition sound.
   */
  stopTransition(): void {
    if (this.transitionSound.isPlaying) {
      this.fadeOut(this.transitionSound, 500);
    }
  }

  /**
   * Mute/unmute ambient audio (useful during voice agent interaction).
   */
  setAmbientMuted(muted: boolean): void {
    const track = this.ambientTracks.get(this.currentEra);
    if (!track) return;

    if (muted) {
      this.fadeOut(track, 300, true); // fade to 0 but don't stop
    } else {
      this.fadeIn(track, AMBIENT_VOLUME, 300);
    }
  }

  private fadeOut(
    audio: THREE.Audio,
    durationMs: number,
    keepPlaying = false,
  ): void {
    const startVol = audio.getVolume();
    const startTime = performance.now();

    const tick = () => {
      const t = Math.min((performance.now() - startTime) / durationMs, 1);
      audio.setVolume(startVol * (1 - t));
      if (t < 1) {
        requestAnimationFrame(tick);
      } else if (!keepPlaying) {
        audio.stop();
        audio.setVolume(0);
      }
    };
    tick();
  }

  private fadeIn(
    audio: THREE.Audio,
    targetVol: number,
    durationMs: number,
  ): void {
    const startVol = audio.getVolume();
    const startTime = performance.now();

    const tick = () => {
      const t = Math.min((performance.now() - startTime) / durationMs, 1);
      audio.setVolume(startVol + (targetVol - startVol) * t);
      if (t < 1) {
        requestAnimationFrame(tick);
      }
    };
    tick();
  }

  dispose(): void {
    for (const [, track] of this.ambientTracks) {
      if (track.isPlaying) track.stop();
      track.disconnect();
    }
    if (this.transitionSound.isPlaying) this.transitionSound.stop();
    this.transitionSound.disconnect();
    this.listener.parent?.remove(this.listener);
  }
}
