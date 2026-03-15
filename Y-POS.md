# Camera Y-Position Calibration

## How it works

The Gaussian splats were captured from a specific viewpoint. The capture camera's
effective height in our scene is defined by `SPLAT_EYE_HEIGHT` in `src/index.ts`
(currently **0.2**).

### Desktop mode
The camera is placed directly at `SPLAT_EYE_HEIGHT` (Y = 0.2).

### VR mode (local-floor)
WebXR `local-floor` reference space reports the user's real eye height above the
physical floor (typically ~1.5–1.8 m). The code reads this tracked height and
offsets the camera rig downward so the effective viewpoint matches the splat's
capture height:

```
rig Y = SPLAT_EYE_HEIGHT - trackedEyeHeight
```

For example: if the headset reports Y = 1.60, the rig is set to 0.2 - 1.60 = -1.40.

## How to adjust

If the viewpoint feels too high or too low in VR or on desktop:

1. Open `src/index.ts`
2. Find the line: `const SPLAT_EYE_HEIGHT = 0.2;`
3. Increase the value to move the viewpoint **up**, decrease to move it **down**
4. Increments of 0.1 (10 cm) are a good step size for testing

## Debugging with the IWER emulator

The IWER panel (Meta Quest 3 widget in the browser) shows the simulated headset
position. The default Y = 1.60 is normal — it simulates average standing eye height.
You can manually adjust Y in the emulator to test different user heights.

## Per-splat calibration

If different era splats (past/present/future) were captured from different heights,
`SPLAT_EYE_HEIGHT` may need to be per-era. Currently all eras share the same value.
