# Relic models (the "Reference Wing")

The Relic tier are famous computer-graphics reference models, rendered as glass in the hero view.

## Real meshes (loaded on demand via `ModelGem`)

| Family key | Model | File | Source |
|---|---|---|---|
| `stanford_bunny` | Stanford Bunny | `bunny.ply` | Princeton Suggestive-Contours gallery |
| `cow` | Classic test cow | `cow.ply` | Princeton Suggestive-Contours gallery |
| `horse` | Scanned horse | `horse.ply` | Princeton Suggestive-Contours gallery |
| `maxplanck` | Max Planck bust | `maxplanck.ply` | Princeton Suggestive-Contours gallery |
| `spot` | Spot the cow | `spot.obj` | Keenan Crane Model Repository |

Princeton gallery: https://gfx.cs.princeton.edu/proj/sugcon/models/ · Spot: https://www.cs.cmu.edu/~kmcrane/Projects/ModelRepository/

## Procedural / placeholder

- `utah_teapot` — exact, three's `TeapotGeometry` (no file needed).
- `benchy`, `stanford_dragon`, `suzanne` — distinctive placeholders (box / (3,7) torus knot / squashed sphere).
  Drop a decimated `.glb`/`.ply`/`.obj` here and add it to `MODEL_FILES` in `src/three/ModelGem.tsx` to swap in a real mesh.

Keep web meshes light (~5–50k tris). Big Stanford scans (Dragon ~870k, Lucy ~28M) are too heavy for the browser.
Check each model's licence before shipping (most are free for non-commercial / with attribution).
