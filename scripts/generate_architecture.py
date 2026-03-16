"""Generate a pipeline architecture diagram using Gemini image generation.

Usage:
  python scripts/generate_architecture.py
"""

import base64
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
API_KEY = os.environ.get("GEMINI_API_KEY")

MODEL = "gemini-3-pro-image-preview"
GENERATE_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

PROMPT = """Create a clean, professional architecture/pipeline infographic diagram. Dark background (#0a0a0e), copper (#e8a050) and cyan (#5ce0d0) accent colors. Use the Orbitron-style geometric sans-serif font aesthetic. The diagram should flow TOP to BOTTOM.

The diagram shows the "TIME MACHINE" project pipeline — a system that turns any real-world location into an immersive VR time travel experience.

== TITLE at top ==
"TIME MACHINE" in large copper text
"Architecture & Pipeline" subtitle

== PHASE 1: WORLD GENERATION (left side label: "Python") ==

STEP 1 — USER INPUT (pin icon)
→ User provides a location: place name, coordinates, or Google Maps URL

STEP 2 — GOOGLE MAPS API (globe icon)
→ Extract 360° Street View panorama
→ Slice into 6 perspective tiles (90° FOV each)
→ Tech: Places API, Map Tiles API, Street View Static API
→ Script: extract_tiles.py

STEP 3 — PARALLEL BRANCH (split into 3 columns):
  LEFT: "PRESENT" (cyan) — Original tiles pass through directly
  CENTER: "PAST · 1920s" (gold) — Gemini Imagen transforms tiles to 1920s (cobblestone, Model Ts, gas lamps) with camera-lock prompts + historical reference images
  RIGHT: "FUTURE · 2150" (violet) — Gemini Imagen transforms to future (flying cars, holograms, vertical gardens)

STEP 4 — RESOLUTION ENHANCEMENT (magnifying glass icon)
→ FLUX.2 Pro regenerates at higher resolution
→ Real-ESRGAN upscales as fallback (2x super-resolution)
→ Gemini outputs ~1070px, need 1250px+ for sharp splats

STEP 5 — WORLD LABS MARBLE API (sparkle icon)
→ Feed tiles to World Labs to generate 3 Gaussian splat worlds
→ Output: .SPZ files (compressed Gaussian splats, ~20-30MB each)
→ 3 photorealistic navigable 3D environments

== PHASE 2: WEBXR EXPERIENCE (left side label: "TypeScript") ==

STEP 6 — IMMERSIVE WEBXR APP (VR headset icon)
→ Loads Gaussian splats into WebXR scene
→ IWSDK: ECS framework (locomotion, spatial UI)
→ SparkJS 2.0: GPU splat renderer
→ Three.js + Vite
→ Runs on Meta Quest 3, Pico, any WebXR browser

STEP 7 — WORMHOLE TRANSITION (spiral/vortex icon)
→ Fullscreen video sphere wraps the viewer
→ Cosmic wormhole plays at 2.5x speed
→ White flash overlay as worlds swap
→ Ambient audio crossfades between eras
→ Old world unloads, new world streams in behind the effect

STEP 8 — AI AGENTS (robot icon)
→ Space maintenance robot (.glb 3D model) floats in each era
→ 3 individual Convai AI characters with unique IDs
→ Past: historian personality | Present: tour guide | Future: futurist
→ Voice interaction: push-to-talk or toggle
→ gRPC streaming for real-time conversation
→ Procedural idle animation (floating bob, gentle drift)

== BOTTOM: THREE ERA CARDS side by side ==
Past 1920s (gold) | Present 2025 (cyan) | Future 2150 (violet)
Each with: Gaussian splat world, ambient audio, AI personality

== FOOTER ==
Full tech stack pills: Google Maps · Gemini Imagen · FLUX.2 · Real-ESRGAN · World Labs · Gaussian Splatting · WebXR · IWSDK · SparkJS · Three.js · Convai AI · Vite

Style: dark space theme, clean geometric layout, thin lines connecting steps, subtle glow effects on icons, professional infographic quality. NOT a flowchart with boxes — more like a modern tech company architecture poster. Vertical flow with clear visual hierarchy."""


def main():
    if not API_KEY:
        sys.exit("Set GEMINI_API_KEY in .env")

    print("Generating architecture diagram with Gemini...\n")

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": PROMPT},
                ]
            }
        ],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
        },
    }

    resp = httpx.post(
        GENERATE_URL,
        params={"key": API_KEY},
        headers={"Content-Type": "application/json"},
        json=payload,
        timeout=120,
    )

    if resp.status_code != 200:
        sys.exit(f"ERROR {resp.status_code}: {resp.text[:500]}")

    data = resp.json()
    candidates = data.get("candidates", [])
    if not candidates:
        sys.exit("ERROR: no candidates in response")

    # Find the image part
    for part in candidates[0].get("content", {}).get("parts", []):
        if "inlineData" in part:
            img_b64 = part["inlineData"]["data"]
            img_bytes = base64.b64decode(img_b64)
            mime = part["inlineData"].get("mimeType", "image/png")
            ext = "png" if "png" in mime else "jpg"

            out_path = ROOT / f"architecture.{ext}"
            out_path.write_bytes(img_bytes)
            print(f"Saved: {out_path} ({len(img_bytes) // 1024} KB)")
            return

    # If no image, check for text response
    for part in candidates[0].get("content", {}).get("parts", []):
        if "text" in part:
            print(f"Got text instead of image: {part['text'][:300]}")

    sys.exit("ERROR: no image in response")


if __name__ == "__main__":
    main()
