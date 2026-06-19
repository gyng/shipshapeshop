# Relic models (the "Reference Wing")

The Relic tier are famous computer-graphics reference models. The **Utah Teapot** renders exactly via
three's procedural `TeapotGeometry`. The scanned/modelled ones currently use distinctive **placeholder**
geometry; drop optimised `.glb` files here (same family key) to swap in the real meshes — no code changes
needed once a loader path keys off these files.

| Family key | Model | Source |
|---|---|---|
| `utah_teapot` | Utah Teapot (Newell, 1975) | procedural (TeapotGeometry) — already exact |
| `stanford_bunny` | Stanford Bunny (1994) | https://faculty.cc.gatech.edu/~turk/bunny/bunny.html · Stanford 3D Scanning Repository |
| `benchy` | 3DBenchy | https://www.3dbenchy.com/ |
| `stanford_dragon` | Stanford Dragon | Stanford 3D Scanning Repository |
| `suzanne` | Suzanne | Blender (the monkey mascot) |
| `spot` | Spot the cow | Keenan Crane (https://www.cs.cmu.edu/~kmcrane/Projects/ModelRepository/) |

Decimate to ~5–20k tris and export `.glb` (Draco-compressed) for the web. Check each model's licence before
shipping (most are free for non-commercial / with attribution).
