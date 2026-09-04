# Holo Props

Holographic prop viewers — self-contained HTML files, no build step and no
dependencies. Each one is a single file: open it in a browser, or host it.

| Prop | File | Notes |
| --- | --- | --- |
| Coin | `coin.html` | 45 × 3.4 mm challenge coin, three faces, four emission colours |

## Coin

Modelled rather than drawn. Each face is painted as a greyscale relief map,
blurred to match the mesh spacing so the struck detail never aliases, then
swept into a polar heightfield with a milled (reeded) edge — 98,816 triangles,
generated in the browser at load.

The hologram look comes from rendering both faces additively with the depth
test off, so the reverse of the coin shows through the obverse. Relief reads
from the model-space normal, not from a light: anywhere the face is struck,
the normal tilts out of the coin's axis and that slope emits. Bloom is a
bright-pass and two separable blurs into quarter-resolution buffers.

- **Face** — Crest, Compass, Cipher. Each has its own obverse and reverse.
- **Emission** — mint, ice, gold, crimson.
- **Projection** — spin and the sweeping read-out band, both toggleable.
- Drag to orbit, wheel to zoom.

Requires WebGL2, and says so plainly if it is unavailable.
