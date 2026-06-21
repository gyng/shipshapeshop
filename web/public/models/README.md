# Relic models (the "Reference Wing")

The Relic tier are famous computer-graphics reference models. They are **real meshes**, loaded once (async)
by the shared relics layer (`src/three/relics.ts` → `RELIC_MODELS`) and then used across **every** view that
renders 3D shapes — gallery thumbnails, the Orrery board, the diorama scenes (Room/Ship/Factory/Forge), and
the hero inspector. Until a mesh finishes loading (or if it fails to load), callers fall back to a procedural
placeholder defined in `src/three/geometry.ts`.

## Real meshes on disk

| Family key | Model | File | Source |
|---|---|---|---|
| `stanford_bunny` | Stanford Bunny | `bunny.ply` | Princeton Suggestive-Contours gallery |
| `cow` | Classic test cow | `cow.obj` | Princeton Suggestive-Contours gallery |
| `spot` | Spot the cow | `spot.obj` | Keenan Crane Model Repository |
| `armadillo` | Stanford Armadillo | `armadillo.ply` | Stanford 3D Scanning Repository (decimated) |
| `lucy` | Lucy | `lucy.ply` | Stanford 3D Scanning Repository (decimated) |
| `stanford_dragon` | Stanford Dragon | `dragon.ply` | Stanford 3D Scanning Repository (~23k tri) |
| `heptoroid` | Heptoroid | `heptoroid.ply` | genus-7 reference surface |
| `benchy` | 3DBenchy | `benchy.ply` | 3DBenchy (CreativeTools) |
| `csaszar` | Császár polyhedron | `csaszar.obj` | toroidal polyhedron (7 vertices) |
| `suzanne` | Suzanne (Blender monkey) | `suzanne.obj` | Blender Foundation — public domain (via alecjacobson/common-3d-test-models) |

Princeton gallery: https://gfx.cs.princeton.edu/proj/sugcon/models/ · Spot: https://www.cs.cmu.edu/~kmcrane/Projects/ModelRepository/

## Procedural (no file needed)

- `utah_teapot` — exact, three's `TeapotGeometry`.

## Adding / swapping a mesh

Drop a decimated `.glb`/`.ply`/`.obj` here and add an entry to `RELIC_MODELS` in `src/three/relics.ts`
(`{ url, kind, rot }`). It appears everywhere automatically. Optionally tune the matching procedural fallback
in `geometry.ts` so the brief pre-load placeholder is recognizable.

Keep web meshes light (~5–50k tris). Big raw Stanford scans (Dragon ~870k, Lucy ~28M) are too heavy for the
browser — decimate first. Check each model's licence before shipping (most are free for research / with
attribution; Suzanne is public domain).
