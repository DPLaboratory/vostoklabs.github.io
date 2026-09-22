# @vostok/patterns

Repeating patterns as laser geometry. A pattern is maths — a tile or a field — and the engine
fills any shape with it and hands back what the laser does: holes to **cut** out (with the web
between them guaranteed), lines to **score**, regions to **engrave**. Pure TypeScript, no
dependencies, millimetres, Y up, the same `Shapes = Ring[][]` contract as `@vostok/laser`.

```ts
import { fillShape, patternById, circle } from '@vostok/patterns';

const coaster = [[circle(0, 0, 45)]];                       // any islands of rings; holes allowed
const r = fillShape(coaster, patternById('honeycomb')!, {
  op: 'cut', params: { size: 8, gap: 2 }, web: 2, inset: 4, angle: 30,
});
r.shapes    // Ring[][]  — one island per hole (cut) or filled region (engrave) or whole ring (score)
r.paths     // Pt[][]    — open runs: score lines, or hinge slits when the op is cut
r.stats     // { cells, holes, dropped, lines, lineLength, area, unclipped }
r.warnings  // plain sentences: "Honeycomb leaves only 1 mm between cuts here; 2 mm is the minimum…"
```

```bash
pnpm --filter @vostok/patterns typecheck
pnpm --filter @vostok/patterns test           # node suite, no browser (tests/run.mjs)
pnpm --filter @vostok/patterns sheet          # every pattern in a disc → tests/.out/sheet.png
node packages/patterns/tests/sheet.mjs --ops --only=dots,kikko --shape=ring   # variations
pnpm --filter @vostok/patterns fetch-monster  # regenerate the Pattern Monster tile data
```

## What the fill does

1. **Resolve** the params (defaults from the definition, the caller's on top, clamped).
2. **Place** the pattern: scaled, rotated about the region's centre, slid by `dx`/`dy`. A tiled
   pattern gets a cell centred on the region's centre, so a symmetric shape gets a symmetric
   fill (a coaster has a hole in the middle, not a web). `align: 'corner'` anchors the pattern
   to the bounding box instead.
3. **Generate** — the tile repeated over the region's box plus a margin, or the field drawn
   into it — then **merge**: duplicate and collinear line segments collapse (a hexagon lattice
   drawn hexagon by hexagon comes out with each edge once, four half-lines from four cells
   come out as one line), identical shapes dedupe.
4. **Inset** the region by `inset` (a vertex offset with a mitre cap; if the outline cannot
   take it, the fill runs to the edge and says so).
5. **Clip** by op:
   - `cut` — a closed shape is kept only when it is wholly on material and clears the edge by
     `web`; anything crossing the edge is dropped (a hole that touches the edge opens the
     outline). `slits` (living hinges) are clipped as lines and trimmed by `web`; `slitWidth`
     turns them into closed slots for a host whose cut layer takes shapes only. A pattern of
     lines refuses to cut and says why.
   - `score` — lines are clipped as lines (split at every crossing, the pieces on material
     kept); closed shapes are scored round as rings, and come back closed when they survived
     whole.
   - `engrave` — closed shapes are clipped to the outline: exactly for convex ones, through
     `clipPolygons` (the host's boolean — manifold's `intersectShapes`) for concave ones, else
     kept whole with `stats.unclipped` counting them for the host. Lines ride along as paths.

## Writing a pattern

A tiled pattern is a cell and one period; a field pattern draws into a box. Both hand back
`{ holes, lines, slits }` — closed shapes, decoration lines, and lines that are safe to cut
through. Put the motif on the cell's centre. Draw only what the cell owns where you can; where a
whole polygon is clearer, draw it and let the merge drop the shared edges.

```ts
export const honeycomb: PatternDef = {
  id: 'honeycomb', name: 'Honeycomb', family: 'geometric', tags: ['holes', 'hexagon'],
  blurb: 'Hexagonal holes leaving a honeycomb web.',
  ops: ['cut', 'engrave', 'score'],                     // first = default
  params: [SIZE(8, 2, 80, 'Hole size'), GAP(2)],        // the studio renders these as its own field kinds
  cell: (p) => { const pitch = num(p, 'size') + num(p, 'gap'); return { w: pitch, h: pitch * SQRT3 }; },
  tile: (p) => {
    const s = num(p, 'size'); const pitch = s + num(p, 'gap');
    return { holes: [[hexagon(pitch / 2, (pitch * SQRT3) / 2, s)], [hexagon(0, 0, s)]], lines: [], slits: [] };
  },
  web: (p) => num(p, 'gap'),                            // what the pattern leaves between its own holes
};
```

Rules a pattern must keep:

- **Holes never overlap or touch** at legal params; `web(p)` reports the narrowest gap so the
  fill can warn against the caller's minimum.
- **A closed hole is simple** (one ring). An island with counters is an engrave region; as a
  cut, only its outer ring is used (an annulus would drop its middle on the bed).
- **`lines` are never cut**; **`slits` are** — only a hinge should put anything in `slits`.
- **Y up**: `+y` is up on the finished piece (seigaiha's fans open upward).
- **Deterministic**: a random field takes a `seed` param and hashes the cell, not the call
  order, so scrolling the region does not reshuffle it.
- **No artwork**: procedural only. Traced or drawn tiles go through `svgTilePattern` with a
  `source` (see the library) and a licence that owes nothing on a customer's export.

Register in `src/patterns/index.ts` (one line), run the suite (it drives every registered
pattern through every op it claims) and look at `pnpm sheet`.

## The tile library

`import { LIBRARY, LIBRARY_TILES, tileById, tileSvg, inspireLook } from '@vostok/patterns/library'`
— Pattern Monster's 330 free tiles (MIT, © 2020–2023 pattern.monster) as patterns, lazy so the
procedural half never pays for the ~900 KB of path data; `@vostok/patterns/library-index` is the
70 KB metadata file (id, title, mode, tags, the site's own slider ranges, a measured default
size) a picker lists and filters without the geometry.

- `tileSvg(tile, look, w, h)` is an exact clone of the site's renderer — the same `<pattern>`
  markup, stroke/join rules, zoom · rotate · spacing · slide — so a gallery card here is the
  card there; `inspireLook(tile, seed, colours)` is their "Inspire me"; `MONSTER_DARK/LIGHT`
  their palettes. `pnpm sheet --cards --tag=x --only=a,b` renders cards to hold against the site.
- `svgTilePattern({ width, height, paths, mode, maxSpacing, maxStroke })` turns any SVG tile
  into a `PatternDef` with the site's knobs: `size` (the period, mm), `spacingX/Y` where the
  tile allows it, `stroke` for line tiles (engraved as bands of that width via `strokeWidth`).
  Stroke tiles become lines (score, or engraved bands); fill tiles become regions read with
  SVG's **nonzero** rule, per colour layer — rings wound like the layer's largest are paint, the
  others its holes, overlapping paint unions (the consumer's job: nonzero fill or manifold's
  Positive rule), and a full-cell ring is a background unless it carries holes. Fill tiles carry
  a **measured** `web` (least distance between islands over 3 × 3 cells), so a tile whose
  shapes touch refuses to cut rather than dropping loose pieces.
- Each tile's default `size` is measured by the fetch script: about 0.45 mm per tile unit (the
  site's look on a coaster), raised for stroke tiles whose lines would crowd under 0.8 mm.
- Every library pattern carries `source`; the licence text sits in `data/` and goes into every
  bundle's THIRD-PARTY-NOTICES (`scripts/third-party-notices.mjs` adds it for any app that
  depends on this package).

## Clipping, exactly

Lines are clipped as lines. Closed shapes crossing the edge are clipped exactly: convex ones by
Sutherland–Hodgman, everything else by the general intersection in `clip.ts` — the boundary of
A ∩ B is the parts of A's edges inside B plus the parts of B's edges inside A, both already
computed by the line clipper, chained back into loops at their shared crossing points (snapped
by proximity, zero-length pieces dropped, degenerate rings discarded, many-ringed islands
retried ring by ring). Only a crossing that lands on a vertex still defeats it; those shapes are
handed to `clipPolygons` (the host's boolean) or kept whole with `stats.unclipped` counting
them — two of the 330 tiles, in a disc.

## Pickers

`thumbPath(def)` renders a 40 × 40 tile of the pattern as one SVG path `d` — the studio's
`thumbs` field takes exactly that. A field pattern that needs different numbers at that size
says so in `def.thumb`.

## Layout

```
src/types.ts        the vocabulary (PatternDef, FillOptions, FillResult, PatternGeometry)
src/fill.ts         fillShape — the one entry point; insetShapes
src/tiler.ts        repeat a cell over a box
src/clip.ts         lines clipped to a region, convex polygon clip, segment merge, EdgeIndex
src/geom.ts         primitives: circle, arc, hexagon, regularPolygon, roundedRect, slot, star…
src/svgpath.ts      SVG path data → polylines/rings (M L H V C S Q T A Z, arcs, flags)
src/svg.ts          fillSvg (a preview), thumbPath (a picker tile)
src/patterns/       geometric · lattices (incl. the Japanese hex family) · hinges · fields
src/library/        svgTilePattern + the Pattern Monster data
tests/run.mjs       the suite; tests/sheet.mjs the contact sheet (sharp, no browser)
```
