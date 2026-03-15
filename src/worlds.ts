/**
 * Time Machine world definitions.
 *
 * Each era has a Gaussian splat URL (from World Labs Marble CDN) and optional
 * collision mesh. The 500k variant balances quality vs. performance on Pico.
 */

export type Era = "past" | "present" | "future";

export interface WorldDef {
  era: Era;
  label: string;
  year: string;
  splatUrl: string;
  meshUrl: string;
  color: number;
}

export const WORLDS: Record<Era, WorldDef> = {
  past: {
    era: "past",
    label: "1920s",
    year: "1920",
    splatUrl: "./splats/past.spz",
    meshUrl: "",
    color: 0xd4a574,
  },
  present: {
    era: "present",
    label: "Present",
    year: "2025",
    // Local file — copy your downloaded .spz into public/splats/
    splatUrl: "./splats/present.spz",
    meshUrl: "./splats/present-collider.glb",
    color: 0x4a90d9,
  },
  future: {
    era: "future",
    label: "Future",
    year: "2150",
    splatUrl: "./splats/future.spz",
    meshUrl: "",
    color: 0x7b2ff2,
  },
};

export const ERA_ORDER: Era[] = ["past", "present", "future"];
