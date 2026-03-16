"""Generate 1920s versions of tiles using Gemini image editing.

Usage:
  python scripts/generate_past.py
"""

import base64
import os
import sys
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
API_KEY = os.environ.get("GEMINI_API_KEY")
INPUT_DIR = ROOT / "tiles_present"
OUTPUT_DIR = ROOT / "tiles_past"
PROMPT_FILE = ROOT / "prompts" / "prompt_past.txt"

# Gemini model with image generation support
MODEL = "gemini-3-pro-image-preview"
GENERATE_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"


def load_prompt() -> str:
    text = PROMPT_FILE.read_text().strip()
    # Skip the "PROMPT NANO3" header line
    lines = text.split("\n")
    if lines[0].startswith("PROMPT"):
        lines = lines[1:]
    return "\n".join(lines).strip()


def image_to_base64(path: Path) -> tuple[str, str]:
    """Read image, return (base64_data, mime_type)."""
    suffix = path.suffix.lower()
    mime = "image/png" if suffix == ".png" else "image/jpeg"
    data = path.read_bytes()
    return base64.b64encode(data).decode(), mime


def edit_image(image_path: Path, prompt: str) -> bytes | None:
    """Send image + prompt to Gemini, return edited image bytes."""
    b64, mime = image_to_base64(image_path)

    payload = {
        "contents": [
            {
                "parts": [
                    {"inlineData": {"mimeType": mime, "data": b64}},
                    {"text": prompt},
                ]
            }
        ],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
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
        print(f"  ERROR {resp.status_code}: {resp.text[:300]}")
        return None

    data = resp.json()
    candidates = data.get("candidates", [])
    if not candidates:
        print(f"  ERROR: no candidates in response")
        return None

    # Find the image part in the response
    for part in candidates[0].get("content", {}).get("parts", []):
        if "inlineData" in part:
            img_b64 = part["inlineData"]["data"]
            return base64.b64decode(img_b64)

    print(f"  ERROR: no image in response")
    return None


def main():
    if not API_KEY:
        sys.exit("Set GEMINI_API_KEY in .env")

    if not INPUT_DIR.exists():
        sys.exit(f"{INPUT_DIR} not found")

    prompt = load_prompt()
    print(f"Prompt:\n{prompt[:120]}...\n")

    images = sorted(f for f in INPUT_DIR.glob("tile*.png") if f.stat().st_size > 0)
    images += sorted(f for f in INPUT_DIR.glob("tile*.jpg") if f.stat().st_size > 0)
    if not images:
        sys.exit(f"No images in {INPUT_DIR}")

    OUTPUT_DIR.mkdir(exist_ok=True)
    print(f"Processing {len(images)} images...\n")

    for i, img_path in enumerate(images):
        print(f"[{i+1}/{len(images)}] {img_path.name}")
        out_path = OUTPUT_DIR / f"past_{img_path.stem}.png"

        result = edit_image(img_path, prompt)
        if result:
            out_path.write_bytes(result)
            print(f"  -> {out_path} ({len(result)//1024}KB)")
        else:
            print(f"  SKIPPED")

        # Rate limit: be gentle
        if i < len(images) - 1:
            time.sleep(2)

    print(f"\nDone! Check {OUTPUT_DIR}/")


if __name__ == "__main__":
    main()
