"""Create a world using the WorldLabs API."""

import base64
import os
import sys
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.environ.get("WORLDLABS_API_KEY") or os.environ.get("WLT_API_KEY")
BASE_URL = "https://api.worldlabs.ai"
API_PREFIX = "/marble/v1"
HEADERS = {"WLT-Api-Key": API_KEY, "Content-Type": "application/json"}


def _poll(client: httpx.Client, operation_id: str) -> dict | None:
    """Poll an operation until done."""
    while True:
        time.sleep(5)
        resp = client.get(f"{API_PREFIX}/operations/{operation_id}")
        resp.raise_for_status()
        op = resp.json()
        if op.get("done"):
            if op.get("error"):
                print(f"error: {op['error']}")
                return None
            world = op["response"]
            print(f"world created: {world['world_id']}")
            print(f"url: {world.get('world_marble_url', 'n/a')}")
            if world.get("assets", {}).get("thumbnail_url"):
                print(f"thumbnail: {world['assets']['thumbnail_url']}")
            return world
        print("  generating...")


def generate_world(
    prompt: str,
    name: str | None = None,
    model: str = "Marble 0.1-mini",
    seed: int | None = None,
    auto_enhance: bool = True,
):
    """Generate a world from a text prompt."""
    body = {
        "world_prompt": {
            "type": "text",
            "text_prompt": prompt,
            "disable_recaption": not auto_enhance,
        },
        "model": model,
        "seed": seed,
    }
    if name:
        body["display_name"] = name

    with httpx.Client(base_url=BASE_URL, headers=HEADERS, timeout=60) as client:
        resp = client.post(f"{API_PREFIX}/worlds:generate", json=body)
        resp.raise_for_status()
        op_id = resp.json()["operation_id"]
        print(f"started operation {op_id}")
        return _poll(client, op_id)


def generate_world_from_image(
    image_path: str,
    text_prompt: str | None = None,
    model: str = "Marble 0.1-mini",
    seed: int | None = None,
    auto_enhance: bool = True,
):
    """Generate a world from an image file."""
    p = Path(image_path)
    image_data = base64.b64encode(p.read_bytes()).decode()
    ext = p.suffix.lstrip(".").lower()
    body = {
        "world_prompt": {
            "type": "image",
            "text_prompt": text_prompt,
            "disable_recaption": not auto_enhance,
            "image_prompt": {
                "source": "data_base64",
                "data_base64": image_data,
                "extension": ext,
            },
        },
        "model": model,
        "seed": seed,
    }

    with httpx.Client(base_url=BASE_URL, headers=HEADERS, timeout=60) as client:
        resp = client.post(f"{API_PREFIX}/worlds:generate", json=body)
        resp.raise_for_status()
        op_id = resp.json()["operation_id"]
        print(f"started operation {op_id}")
        return _poll(client, op_id)


def generate_world_from_images(
    image_paths: list[str],
    text_prompt: str | None = None,
    azimuths: list[int] | None = None,
    model: str = "Marble 0.1-mini",
    seed: int | None = None,
    auto_enhance: bool = True,
    reconstruct: bool = True,
):
    """Generate a world from multiple images (up to 4)."""
    images = []
    for i, p in enumerate(image_paths[:4]):
        path = Path(p)
        data = base64.b64encode(path.read_bytes()).decode()
        ext = path.suffix.lstrip(".").lower()
        entry = {
            "content": {"source": "data_base64", "data_base64": data, "extension": ext},
        }
        if azimuths and i < len(azimuths):
            entry["azimuth"] = azimuths[i]
        images.append(entry)

    body = {
        "world_prompt": {
            "type": "multi-image",
            "text_prompt": text_prompt,
            "disable_recaption": not auto_enhance,
            "reconstruct_images": reconstruct,
            "multi_image_prompt": images,
        },
        "model": model,
        "seed": seed,
    }

    with httpx.Client(base_url=BASE_URL, headers=HEADERS, timeout=60) as client:
        resp = client.post(f"{API_PREFIX}/worlds:generate", json=body)
        resp.raise_for_status()
        op_id = resp.json()["operation_id"]
        print(f"started operation {op_id} ({len(images)} images)")
        return _poll(client, op_id)


def list_worlds():
    """List all your worlds."""
    with httpx.Client(base_url=BASE_URL, headers=HEADERS, timeout=30) as client:
        resp = client.post(f"{API_PREFIX}/worlds:list", json={})
        resp.raise_for_status()
        worlds = resp.json().get("worlds", [])
        for w in worlds:
            print(f"  {w['world_id']}  {w.get('display_name') or '(untitled)'}")
        if not worlds:
            print("  no worlds yet")
        return worlds


def get_world(world_id: str):
    """Get details for a specific world."""
    with httpx.Client(base_url=BASE_URL, headers=HEADERS, timeout=30) as client:
        resp = client.get(f"{API_PREFIX}/worlds/{world_id}")
        resp.raise_for_status()
        return resp.json()


USAGE = """\
usage: create_world.py <command> [args]

commands:
  text <prompt>         generate world from text (default if no command given)
  image <path> [prompt] generate world from an image file
  list                  list all your worlds
  get <world_id>        get details for a world
"""

if __name__ == "__main__":
    if not API_KEY:
        sys.exit("set WORLDLABS_API_KEY or WLT_API_KEY in .env")

    args = sys.argv[1:]
    if not args:
        print(USAGE)
        sys.exit(0)

    cmd = args[0]

    if cmd == "list":
        list_worlds()
    elif cmd == "get" and len(args) > 1:
        import json
        print(json.dumps(get_world(args[1]), indent=2))
    elif cmd == "image" and len(args) > 1:
        text = " ".join(args[2:]) if len(args) > 2 else None
        generate_world_from_image(args[1], text_prompt=text)
    elif cmd == "text":
        prompt = " ".join(args[1:]) if len(args) > 1 else "a cozy cabin in the woods at sunset"
        generate_world(prompt)
    else:
        # treat everything as a text prompt
        prompt = " ".join(args)
        generate_world(prompt)
