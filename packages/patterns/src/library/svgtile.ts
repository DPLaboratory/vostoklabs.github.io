// An SVG tile as a pattern. Give it what an SVG `<pattern>` would hold — a width, a height and
// the path data of its `<path>` elements — and it becomes a tiled PatternDef whose knobs are
// the tile library's own: the period in mm, the spacing the tile allows, and the stroke width
// its lines are engraved at. Stroke tiles become lines (score, or engraved bands); fill tiles
// become closed shapes (engrave, and cut where the shapes leave a web — measured, not
// assumed). The `source` travels with it, because this is the one kind of pattern that did
// not come from maths.
import { bboxOfShapes, pointInRing, segmentDistance, signedArea } from '../geom';
import { number, num } from '../params';
import type { Island, ParamSpec, PatternDef, PatternGeometry, PatternSource, Polyline, Pt, Ring } from '../types';

export interface SvgTileSpec {
  id: string;
  name: string;
  /** The tile's own units, as its SVG `<pattern>` would declare them. */
  width: number;
  height: number;
  /** Path data (`d`) of each `<path>`, in the tile's units, SVG orientation (Y down). */
  paths: string[];
  /** `stroke` / `stroke-join`: the paths are lines. `fill`: the paths are filled regions. */
  mode: 'stroke' | 'stroke-join' | 'fill';
  tags?: string[];
  blurb?: string;
  source?: PatternSource;
  /** The period in mm at which the tile reads well. Default 20. */
  defaultSize?: number;
  /** The most spacing the tile allows, tile units, [x, y] — Pattern Monster's own ranges. */
  maxSpacing?: [number, number];
  /** The widest stroke the tile is drawn with, tile units. Default 6. */
  maxStroke?: number;
  /** For fill tiles: drop any ring covering more than this share of the cell — a background
   *  rectangle is not a motif. Default 0.9. */
  backgroundShare?: number;
}

type Flatten = (d: string, tol: number) => { rings: Ring[]; polylines: Polyline[] };

/** Least distance between any two islands of a tiled fill (3 × 3 cells), mm — the web a cut
 *  would leave; 0 when shapes touch or overlap and a cut would drop the material between. */
function measureWeb(holes: Island[], cell: { w: number; h: number }): number {
  const outers: Ring[] = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const island of holes) outers.push(island[0]!.map(([x, y]): Pt => [x + i * cell.w, y + j * cell.h]));
  const boxes = outers.map((r) => bboxOfShapes([[r]]));
  let best = Infinity;
  for (let a = 0; a < outers.length; a++) {
    for (let b = a + 1; b < outers.length; b++) {
      const A = boxes[a]!;
      const B = boxes[b]!;
      const gap = Math.max(B.minX - A.maxX, A.minX - B.maxX, B.minY - A.maxY, A.minY - B.maxY);
      if (gap >= best) continue;
      const ra = outers[a]!;
      const rb = outers[b]!;
      for (let i = 0; i < ra.length && best > 0; i++) {
        const p = ra[i]!;
        const q = ra[(i + 1) % ra.length]!;
        for (let j = 0; j < rb.length; j++) {
          const d = segmentDistance(p, q, rb[j]!, rb[(j + 1) % rb.length]!);
          if (d < best) best = d;
          if (best <= 1e-6) return 0;
        }
      }
    }
  }
  return Number.isFinite(best) ? best : Infinity;
}

/** Identical rings (a subpath drawn twice) collapse to one. */
function dedupeRings(rings: Ring[]): Ring[] {
  const seen = new Set<string>();
  const out: Ring[] = [];
  for (const r of rings) {
    if (r.length < 3) continue;
    let x = 0;
    let y = 0;
    for (const p of r) {
      x += p[0];
      y += p[1];
    }
    const k = `${r.length}|${Math.round(signedArea(r) * 1e4)}|${Math.round((x / r.length) * 1e4)},${Math.round((y / r.length) * 1e4)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/**
 * A layer's rings as islands under the nonzero rule: rings wound like the largest one are
 * paint, the rest are holes, and each hole joins the smallest paint ring that contains it. A
 * hole inside no paint ring is a stray and is dropped. Overlapping paint rings stay separate
 * islands — the consumer's nonzero fill or union makes them one region.
 */
function nonzeroIslands(rings: Ring[]): Island[] {
  if (!rings.length) return [];
  const areas = rings.map(signedArea);
  let largest = 0;
  for (let i = 1; i < rings.length; i++) if (Math.abs(areas[i]!) > Math.abs(areas[largest]!)) largest = i;
  const paintSign = Math.sign(areas[largest]!) || 1;
  const paint = rings.map((r, i) => ({ r, i, area: Math.abs(areas[i]!) })).filter((x) => Math.sign(areas[x.i]!) === paintSign).sort((a, b) => a.area - b.area);
  const islands = new Map<number, Island>();
  for (const p of paint) islands.set(p.i, [p.r]);
  for (let i = 0; i < rings.length; i++) {
    if (Math.sign(areas[i]!) === paintSign) continue;
    const probe = rings[i]![0]!;
    const owner = paint.find((p) => p.area > Math.abs(areas[i]!) && pointInRing(probe, p.r));
    if (owner) islands.get(owner.i)!.push(rings[i]!);
  }
  return [...islands.values()];
}

export function svgTilePattern(spec: SvgTileSpec, flatten: Flatten): PatternDef {
  const W = spec.width;
  const H = spec.height;
  const isFill = spec.mode === 'fill';
  const maxSpacing = spec.maxSpacing ?? [0, 0];
  const cache = new Map<string, { geo: PatternGeometry; web: number }>();

  const build = (p: Record<string, unknown>): { geo: PatternGeometry; web: number } => {
    const size = num(p as never, 'size');
    const k = size / W;
    const sx = maxSpacing[0] > 0 ? num(p as never, 'spacingX') : 0;
    const sy = maxSpacing[1] > 0 ? num(p as never, 'spacingY') : 0;
    const key = `${k}|${sx}|${sy}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const tol = Math.max(0.02, Math.min(W, H) / 400);
    const layers: Ring[][] = [];
    const lines: Polyline[] = [];
    // The tile sits at the bottom-left of its cell; the spacing is air to the right (half of
    // it moved in front, as Pattern Monster does) and above.
    const toMm = ([x, y]: Pt): Pt => [(x + sx / 2) * k, (H - y) * k];
    for (const d of spec.paths) {
      const flat = flatten(d, tol);
      layers.push(flat.rings.map((r) => r.map(toMm)));
      for (const l of flat.polylines) lines.push(l.map(toMm));
    }
    let geo: PatternGeometry;
    let web = Infinity;
    if (!isFill) {
      geo = { holes: [], lines: [...lines, ...layers.flat().map((r): Polyline => [...r, r[0]!])], slits: [] };
    } else {
      const cellArea = (W + sx) * (H + sy) * k * k;
      const share = spec.backgroundShare ?? 0.9;
      // Each path is one colour layer, painted over the ones before it, with SVG's default
      // NONZERO rule: subpaths wound one way are paint, subpaths wound the other way are the
      // holes in it, and two paint subpaths that overlap simply union (a tile often draws a
      // motif again at the cell's edge for the wrap). So a layer's rings are sorted by their
      // WINDING — the largest ring's sense is "paint" — never by even-odd nesting, which would
      // cancel a diamond drawn twice and turn a fan's thin arcs into its body. A ring covering
      // the whole cell is that layer's background unless it carries holes (a frame).
      const holes: Island[] = [];
      for (const rings of layers) for (const island of nonzeroIslands(dedupeRings(rings))) {
        if (island.length > 1 || Math.abs(signedArea(island[0]!)) < cellArea * share) holes.push(island);
      }
      geo = { holes, lines, slits: [] };
      web = measureWeb(holes, { w: (W + sx) * k, h: (H + sy) * k });
    }
    const out = { geo, web };
    cache.set(key, out);
    return out;
  };

  const params: ParamSpec[] = [number('size', 'Tile size', spec.defaultSize ?? 20, 2, 200, 0.5)];
  if (maxSpacing[0] > 0) params.push(number('spacingX', 'Horizontal spacing', 0, 0, maxSpacing[0], 0.5, ''));
  if (maxSpacing[1] > 0) params.push(number('spacingY', 'Vertical spacing', 0, 0, maxSpacing[1], 0.5, ''));
  if (!isFill) params.push(number('stroke', 'Stroke', 1, 0.5, spec.maxStroke ?? 6, 0.5, '', 'How wide the lines are engraved. A score is always a hairline.'));

  return {
    id: spec.id,
    name: spec.name,
    family: 'library',
    tags: spec.tags ?? [],
    ...(spec.blurb ? { blurb: spec.blurb } : {}),
    ...(spec.source ? { source: spec.source } : {}),
    ops: isFill ? ['engrave', 'cut', 'score'] : ['score', 'engrave'],
    params,
    cell: (p) => {
      const k = num(p, 'size') / W;
      const sx = maxSpacing[0] > 0 ? num(p, 'spacingX') : 0;
      const sy = maxSpacing[1] > 0 ? num(p, 'spacingY') : 0;
      return { w: (W + sx) * k, h: (H + sy) * k };
    },
    tile: (p) => build(p).geo,
    ...(isFill ? { web: (p: Record<string, unknown>) => build(p).web } : {}),
    // The stroke slider is in tile units, as on the site; in millimetres it scales with the tile.
    ...(!isFill ? { strokeWidth: (p: Record<string, unknown>) => (num(p as never, 'stroke') * num(p as never, 'size')) / W } : {}),
  } as PatternDef;
}
