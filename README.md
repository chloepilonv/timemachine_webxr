# Time Machine World Generation

Turn any Google Maps location into a navigable 3D world — in the present, the past (1920s), or the future.

The pipeline extracts perspective tiles from Google Street View, transforms them into different time periods using Gemini, and generates explorable 3D worlds via World Labs.

## Pipeline

```
Location (URL / coords / place name)
        |
        v
 [1] extract_tiles.py  -->  tiles_present/   (6 perspective tiles from Street View)
        |
        v
 [2a] generate_past.py   -->  tiles_past/    (1920s: cobblestone, Model Ts, gas lamps)
 [2b] generate_future.py -->  tiles_future/  (future: flying cars, robots, holograms)
        |
        v
 [3] create_world.py  -->  World Labs 3D world (navigable Gaussian splat)
```

## Setup

```bash
pip install httpx python-dotenv pillow
```

Create a `.env` file:
```
GOOGLE_API_KEY=...      # Places API + Map Tiles API + Street View enabled
GEMINI_API_KEY=...      # Gemini 3 Pro (image editing)
WORLDLABS_API_KEY=...   # World Labs Marble API
```

### Required Google Cloud APIs

Enable in [Google Cloud Console](https://console.cloud.google.com/apis/library):
- Places API (New)
- Map Tiles API
- Street View Static API

## Usage

### Step 1 — Extract tiles from a location

```bash
# From a place name
python scripts/extract_tiles.py "Ferry Building, San Francisco" --tiles 6

# From coordinates
python scripts/extract_tiles.py 37.7955,-122.3937 --tiles 6

# From a Google Maps Street View URL
python scripts/extract_tiles.py "https://www.google.com/maps/place/Ferry+Building/@37.79..." --tiles 6

# Options
#   --tiles N   Number of perspective tiles to extract (default: 6)
#   --zoom N    Panorama resolution 0-5 (default: 3)
```

Outputs PNG tiles to `tiles_present/`.

### Step 2 — Generate past or future versions

```bash
# Generate 1920s versions of all tiles in tiles_present/
python scripts/generate_past.py

# Generate futuristic versions
python scripts/generate_future.py
```

Each script reads tiles from `tiles_present/`, applies the Gemini prompt (from `prompts/`), and saves results to `tiles_past/` or `tiles_future/`.

The prompts enforce:
- Absolute camera lock (same geometry, angles, POV)
- Surface/object changes only (no structural modifications)
- Natural full color (no sepia, no neon overload)
- Continuous composition for 3D reconstruction

### Step 3 — Generate a 3D world

```bash
# From a single image
python scripts/create_world.py image tiles_future/future_tile1_ferry_front.png

# With a text prompt for context
python scripts/create_world.py image tiles_past/past_tile1.png "1920s San Francisco"

# From text only
python scripts/create_world.py text "a futuristic city plaza"

# List all your worlds
python scripts/create_world.py list
```

World Labs accepts up to 4 images per world. The first image determines the initial camera view.

## Project Structure

```
timemachine/
├── .env                          # API keys (not committed)
├── generated_worlds.txt          # URLs of generated worlds
├── prompts/
│   ├── prompt_past.txt           # Gemini prompt for 1920s transformation
│   └── prompt_future.txt         # Gemini prompt for future transformation
├── scripts/
│   ├── extract_tiles.py          # Google Street View -> perspective tiles
│   ├── generate_past.py          # tiles_present -> tiles_past via Gemini
│   ├── generate_future.py        # tiles_present -> tiles_future via Gemini
│   └── create_world.py           # Tiles -> World Labs 3D world
├── tiles_present/                # Extracted source tiles
├── tiles_past/                   # Gemini-generated 1920s tiles
└── tiles_future/                 # Gemini-generated future tiles
```

## Generated Worlds

| Era | URL |
|-----|-----|
| Present | https://marble.worldlabs.ai/world/11223fe8-f431-41d6-9fe2-9bc277ddab0c |
| Past | https://marble.worldlabs.ai/create/ad0f2d0d-044a-4eeb-b33f-df839462ec57 |
| Future | https://marble.worldlabs.ai/world/5b917cba-1247-4287-8613-5a199e74d7da |
