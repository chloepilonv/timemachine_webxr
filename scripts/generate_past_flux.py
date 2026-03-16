"""Generate 1920s versions of tiles using FLUX.2 canny-pro via Replicate.

Preserves input resolution (no shrinkage like Gemini) by using canny edge
conditioning to lock architectural geometry while restyling surfaces.

Usage:
  python scripts/generate_past_flux.py
"""

import os
import sys
import time
from pathlib import Path

import httpx
import replicate
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
INPUT_DIR = ROOT / "tiles_present"
OUTPUT_DIR = ROOT / "tiles_past"
PROMPT_FILE = ROOT / "prompts" / "prompt_past.txt"


def load_prompt() -> str:
    text = PROMPT_FILE.read_text().strip()
    lines = text.split("\n")
    if lines[0].startswith("PROMPT"):
        lines = lines[1:]
    return "\n".join(lines).strip()


def edit_image(image_path: Path, prompt: str) -> bytes | None:
    """Send image to FLUX canny-pro via Replicate, return edited image bytes."""
    print(f"  Uploading to Replicate...")

    output = replicate.run(
        "black-forest-labs/flux-1.1-pro",
        input={
            "prompt": prompt,
            "image": open(image_path, "rb"),
            "prompt_upsampling": True,
            "safety_tolerance": 5,
            "output_format": "png",
        },
    )

    # output is a FileOutput URL
    url = str(output)
    print(f"  Downloading result...")
    resp = httpx.get(url, timeout=60, follow_redirects=True)
    if resp.status_code != 200:
        print(f"  ERROR downloading: {resp.status_code}")
        return None

    return resp.content


def main():
    if not os.environ.get("REPLICATE_API_TOKEN"):
        sys.exit("Set REPLICATE_API_TOKEN in .env")

    if not INPUT_DIR.exists():
        sys.exit(f"{INPUT_DIR} not found")

    prompt = load_prompt()
    print(f"Prompt:\n{prompt[:120]}...\n")

    images = sorted(f for f in INPUT_DIR.glob("tile*.png") if f.stat().st_size > 0)
    images += sorted(f for f in INPUT_DIR.glob("tile*.jpg") if f.stat().st_size > 0)
    if not images:
        sys.exit(f"No images in {INPUT_DIR}")

    OUTPUT_DIR.mkdir(exist_ok=True)
    print(f"Processing {len(images)} images with FLUX.2...\n")

    for i, img_path in enumerate(images):
        print(f"[{i+1}/{len(images)}] {img_path.name}")
        out_path = OUTPUT_DIR / f"past_{img_path.stem}.png"

        result = edit_image(img_path, prompt)
        if result:
            out_path.write_bytes(result)
            print(f"  -> {out_path} ({len(result)//1024}KB)")
        else:
            print(f"  SKIPPED")

        if i < len(images) - 1:
            time.sleep(1)

    print(f"\nDone! Check {OUTPUT_DIR}/")


if __name__ == "__main__":
    main()
