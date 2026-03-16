"""Extract perspective tiles from Google Street View.

Accepts a place name, coordinates, or Google Maps URL.
Outputs 1-6 tile images to tiles_present/.

Usage:
  python scripts/extract_tiles.py "Ferry Building, San Francisco"
  python scripts/extract_tiles.py 37.7955,-122.3937
  python scripts/extract_tiles.py "https://www.google.com/maps/place/..." --tiles 6
  python scripts/extract_tiles.py "Ferry Building, SF" --zoom 4 --tiles 6
"""

import io
import math
import os
import re
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv
from PIL import Image

load_dotenv()

API_KEY = os.environ.get("GOOGLE_API_KEY")
PLACES_URL = "https://places.googleapis.com/v1"
TILES_URL = "https://tile.googleapis.com/v1"
OUTPUT_DIR = Path("tiles_present")


# ── Google Places ────────────────────────────────────────────────────────

def find_place(query: str) -> dict | None:
    """Search for a place by name, return location + info."""
    resp = httpx.post(
        f"{PLACES_URL}/places:searchText",
        headers={
            "X-Goog-Api-Key": API_KEY,
            "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location",
            "Content-Type": "application/json",
        },
        json={"textQuery": query},
        timeout=15,
    )
    resp.raise_for_status()
    places = resp.json().get("places", [])
    if not places:
        return None
    p = places[0]
    loc = p.get("location", {})
    print(f"  {p['displayName']['text']}")
    print(f"  {p.get('formattedAddress', '')}")
    print(f"  {loc.get('latitude')}, {loc.get('longitude')}")
    return p


# ── Tiles API ────────────────────────────────────────────────────────────

def _session() -> str:
    r = httpx.post(
        f"{TILES_URL}/createSession",
        params={"key": API_KEY},
        headers={"Content-Type": "application/json"},
        json={"mapType": "streetview", "language": "en-US", "region": "US"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["session"]


def _metadata(session: str, pano_id: str) -> dict | None:
    r = httpx.get(
        f"{TILES_URL}/streetview/metadata",
        params={"key": API_KEY, "session": session, "panoId": pano_id},
        timeout=15,
    )
    return r.json() if r.status_code == 200 else None


# ── Panorama discovery ───────────────────────────────────────────────────

def discover(lat: float, lng: float, session: str, radius: int = 30) -> list[dict]:
    """Grid-search for all panoramas near a location."""
    offsets = [
        (0, 0), (.0001, 0), (-.0001, 0), (0, .0001), (0, -.0001),
        (.0001, .0001), (-.0001, -.0001), (.0002, 0), (-.0002, 0),
        (0, .0002), (0, -.0002),
    ]
    locs = [{"lat": lat + d, "lng": lng + e} for d, e in offsets]
    r = httpx.post(
        f"{TILES_URL}/streetview/panoIds",
        params={"key": API_KEY, "session": session},
        headers={"Content-Type": "application/json"},
        json={"locations": locs, "radius": radius},
        timeout=15,
    )
    r.raise_for_status()
    ids = list(dict.fromkeys(p for p in r.json().get("panoIds", []) if p))
    panos = []
    for pid in ids:
        m = _metadata(session, pid)
        if m:
            panos.append(m)
    return panos


def pick_best(panos: list[dict], session: str) -> dict | None:
    """Pick the best panorama — prefers user-contributed 360° photospheres."""
    candidates = []
    for m in panos:
        w, h = m.get("imageWidth", 0), m.get("imageHeight", 0)
        is_equirect = w > 0 and h > 0 and abs(w / h - 2.0) < 0.1
        is_google = "Google" in m.get("copyright", "")
        cp = m.get("copyright", "").replace("From the Owner, Photo by: ", "")
        label = "360°" if is_equirect else "sv"
        if is_equirect and not is_google:
            label = "360° photosphere"
        print(f"  {m['panoId'][:20]:20s} {w:5d}x{h:<5d} {label:18s} {cp[:40]}")
        if is_equirect and not is_google:
            candidates.append(m)

    if not candidates:
        return panos[0] if panos else None

    best, best_sky = candidates[0], 1.0
    for m in candidates:
        sky = _sky_frac(m["panoId"], session)
        print(f"    sky={sky:.0%} {m['panoId'][:20]}...")
        if sky < best_sky:
            best_sky = sky
            best = m
    return best


def _sky_frac(pano_id: str, session: str) -> float:
    total = 0.0
    for yaw in [0, 180]:
        r = httpx.get(
            f"{TILES_URL}/streetview/thumbnail",
            params={
                "key": API_KEY, "session": session, "panoId": pano_id,
                "height": 250, "width": 600, "yaw": yaw, "pitch": 0, "fov": 90,
            },
            timeout=15,
        )
        if r.status_code != 200 or len(r.content) < 1000:
            total += 0.5
            continue
        img = Image.open(io.BytesIO(r.content)).convert("RGB").resize((100, 50))
        px = list(img.getdata())
        sky = sum(
            1 for r, g, b in px
            if (r + g + b) / 3 > 180 and (b > r and b > g or max(r, g, b) - min(r, g, b) < 30)
        )
        total += sky / len(px)
    return total / 2


# ── Tile stitching ───────────────────────────────────────────────────────

def stitch(pano_id: str, session: str, zoom: int = 3) -> Image.Image:
    """Download tiles and stitch into a full equirectangular panorama."""
    meta = _metadata(session, pano_id)
    img_w = meta.get("imageWidth", 13312)
    img_h = meta.get("imageHeight", 6656)
    tw = meta.get("tileWidth", 512)
    th = meta.get("tileHeight", 512)

    max_z = max(math.ceil(math.log2(img_w / tw)), math.ceil(math.log2(img_h / th)))
    zoom = min(zoom, max_z)
    scale = 2 ** (max_z - zoom)
    cw = math.ceil(img_w / scale)
    ch = math.ceil(img_h / scale)
    cols = math.ceil(cw / tw)
    rows = math.ceil(ch / th)

    print(f"  stitching {cols}x{rows} tiles at zoom {zoom} -> {cw}x{ch}px")
    canvas = Image.new("RGB", (cols * tw, rows * th))
    for y in range(rows):
        for x in range(cols):
            r = httpx.get(
                f"{TILES_URL}/streetview/tiles/{zoom}/{x}/{y}",
                params={"key": API_KEY, "session": session, "panoId": pano_id},
                timeout=30,
            )
            if r.status_code == 200 and len(r.content) > 100:
                canvas.paste(Image.open(io.BytesIO(r.content)), (x * tw, y * th))
    return canvas.crop((0, 0, cw, ch))


# ── Perspective tile extraction ──────────────────────────────────────────

def extract_perspective_tiles(pano: Image.Image, num: int = 4, fov: int = 90) -> list[tuple[int, Image.Image]]:
    """Slice equirectangular panorama into perspective view tiles."""
    w, h = pano.size
    step = 360 / num
    fov_frac = fov / 360.0
    sw = int(w * fov_frac)
    y0 = int(h * 0.15)
    y1 = int(h * 0.85)

    tiles = []
    for i in range(num):
        heading = int(i * step)
        cx = int((heading / 360.0) * w) % w
        x0 = cx - sw // 2

        if x0 < 0:
            left = pano.crop((w + x0, y0, w, y1))
            right = pano.crop((0, y0, x0 + sw, y1))
            tile = Image.new("RGB", (sw, y1 - y0))
            tile.paste(left, (0, 0))
            tile.paste(right, (left.width, 0))
        elif x0 + sw > w:
            left = pano.crop((x0, y0, w, y1))
            right = pano.crop((0, y0, x0 + sw - w, y1))
            tile = Image.new("RGB", (sw, y1 - y0))
            tile.paste(left, (0, 0))
            tile.paste(right, (left.width, 0))
        else:
            tile = pano.crop((x0, y0, x0 + sw, y1))

        tiles.append((heading, tile))
    return tiles


# ── URL parsing ──────────────────────────────────────────────────────────

def _parse_pano_id_from_url(url: str) -> str | None:
    """Extract a pano ID from a Google Maps URL."""
    m = re.search(r'!1s([A-Za-z0-9_-]+)!2e', url)
    if m:
        return m.group(1)
    m = re.search(r'panoid=([A-Za-z0-9_-]+)', url)
    if m:
        return m.group(1)
    return None


# ── Main ─────────────────────────────────────────────────────────────────

def run(query: str, zoom: int = 3, num_tiles: int = 6):
    if not API_KEY:
        sys.exit("Set GOOGLE_API_KEY in .env")

    session = _session()

    # detect Google Maps URL with pano ID
    pano_id = None
    if "google.com/maps" in query or "goo.gl" in query:
        pano_id = _parse_pano_id_from_url(query)
        if pano_id:
            print(f"pano ID from URL: {pano_id}")

    if pano_id:
        meta = _metadata(session, pano_id)
        if not meta:
            sys.exit("pano not found")
        cp = meta.get("copyright", "").replace("From the Owner, Photo by: ", "")
        print(f"  {meta['imageWidth']}x{meta['imageHeight']} by {cp} ({meta.get('date', '?')})")
        selected = meta

    elif "," in query and all(p.replace(".", "").replace("-", "").strip().isdigit() for p in query.split(",")):
        parts = query.split(",")
        lat, lng = float(parts[0].strip()), float(parts[1].strip())
        print(f"coordinates: {lat}, {lng}")
        print(f"\ndiscovering panoramas...")
        panos = discover(lat, lng, session)
        if not panos:
            sys.exit("no panoramas found")
        print(f"found {len(panos)} panoramas:")
        best = pick_best(panos, session)
        if not best:
            sys.exit("no usable panorama found")
        selected = best

    else:
        print(f"searching: {query}")
        place = find_place(query)
        if not place:
            sys.exit("place not found")
        loc = place["location"]
        lat, lng = loc["latitude"], loc["longitude"]
        print(f"\ndiscovering panoramas...")
        panos = discover(lat, lng, session)
        if not panos:
            sys.exit("no panoramas found")
        print(f"found {len(panos)} panoramas:")
        best = pick_best(panos, session)
        if not best:
            sys.exit("no usable panorama found")
        selected = best

    # stitch full panorama
    pid = selected["panoId"]
    cp = selected.get("copyright", "").replace("From the Owner, Photo by: ", "")
    date = selected.get("date", "?")
    print(f"\nstitching panorama: {cp} ({date})")
    pano_img = stitch(pid, session, zoom=zoom)

    # extract perspective tiles
    tiles = extract_perspective_tiles(pano_img, num=num_tiles)

    OUTPUT_DIR.mkdir(exist_ok=True)
    print(f"\nextracting {len(tiles)} tiles to {OUTPUT_DIR}/")
    for i, (heading, tile_img) in enumerate(tiles):
        tile_path = OUTPUT_DIR / f"tile{i+1}_{heading:03d}.png"
        tile_img.save(tile_path, "PNG")
        print(f"  tile{i+1} {heading:3d}° -> {tile_path.name} ({tile_img.size[0]}x{tile_img.size[1]})")

    print(f"\ndone! {len(tiles)} tiles saved to {OUTPUT_DIR}/")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(0)

    zoom = 3
    num_tiles = 6
    query_parts = []
    i = 0
    while i < len(args):
        if args[i] == "--zoom" and i + 1 < len(args):
            zoom = int(args[i + 1])
            i += 2
        elif args[i] == "--tiles" and i + 1 < len(args):
            num_tiles = int(args[i + 1])
            i += 2
        else:
            query_parts.append(args[i])
            i += 1

    run(" ".join(query_parts), zoom=zoom, num_tiles=num_tiles)
