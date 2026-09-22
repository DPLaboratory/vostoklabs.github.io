// Clipping lines to a region, keeping holes off its edge, and merging the duplicate segments
// a tiled lattice draws. Pure; nothing here needs a polygon library.
//
// Lines are clipped AS LINES (the studio's clip.ts, lifted): split every segment where it
// crosses a region edge, keep a piece when its midpoint is on material, merge what is
// consecutive. A hole is a polygon, and a polygon crossing the edge is not clipped here unless
// it is convex (Sutherland–Hodgman against the region's rings is exact then) — the host owns
// the general boolean, because it already has one and this package must not.
import { insideShapes, isConvex, pointSegmentDistance, segmentCrossing, segmentDistance, signedArea } from './geom';
import type { Island, Pt, Polyline, Ring, Shapes } from './types';

const EPS_T = 1e-7;
/** A run shorter than this is numerical dust off a near-tangent crossing. */
const MIN_RUN = 0.05;

interface Edge {
  c: Pt;
  d: Pt;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The region's edges in a uniform grid, so a segment only meets the edges near it. */
export class EdgeIndex {
  readonly edges: Edge[] = [];
  private readonly cells = new Map<string, Edge[]>();
  private readonly size: number;
  readonly shapes: Shapes;

  constructor(shapes: Shapes, cell?: number) {
    this.shapes = shapes;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const island of shapes) {
      for (const ring of island) {
        for (let i = 0; i < ring.length; i++) {
          const c = ring[i]!;
          const d = ring[(i + 1) % ring.length]!;
          const e: Edge = { c, d, minX: Math.min(c[0], d[0]), maxX: Math.max(c[0], d[0]), minY: Math.min(c[1], d[1]), maxY: Math.max(c[1], d[1]) };
          this.edges.push(e);
          minX = Math.min(minX, e.minX);
          minY = Math.min(minY, e.minY);
          maxX = Math.max(maxX, e.maxX);
          maxY = Math.max(maxY, e.maxY);
        }
      }
    }
    const span = Math.max(maxX - minX, maxY - minY, 1);
    this.size = cell ?? Math.max(1, span / 24);
    for (const e of this.edges) this.forCells(e.minX, e.minY, e.maxX, e.maxY, (k) => {
      let bucket = this.cells.get(k);
      if (!bucket) this.cells.set(k, (bucket = []));
      bucket.push(e);
    });
  }

  private forCells(minX: number, minY: number, maxX: number, maxY: number, fn: (key: string) => void): void {
    const x0 = Math.floor(minX / this.size);
    const x1 = Math.floor(maxX / this.size);
    const y0 = Math.floor(minY / this.size);
    const y1 = Math.floor(maxY / this.size);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) fn(`${x},${y}`);
  }

  /** Edges whose box meets the given box (each at most once). */
  near(minX: number, minY: number, maxX: number, maxY: number): Edge[] {
    const seen = new Set<Edge>();
    const out: Edge[] = [];
    this.forCells(minX, minY, maxX, maxY, (k) => {
      const bucket = this.cells.get(k);
      if (!bucket) return;
      for (const e of bucket) {
        if (seen.has(e)) continue;
        seen.add(e);
        if (e.maxX < minX || e.minX > maxX || e.maxY < minY || e.minY > maxY) continue;
        out.push(e);
      }
    });
    return out;
  }

  inside(p: Pt): boolean {
    return insideShapes(this.shapes, p);
  }

  /** Least distance from a point to any edge, capped: only edges within `limit` are examined. */
  distance(p: Pt, limit: number): number {
    let best = Infinity;
    for (const e of this.near(p[0] - limit, p[1] - limit, p[0] + limit, p[1] + limit)) best = Math.min(best, pointSegmentDistance(p, e.c, e.d));
    return best;
  }

  /** Least distance from a segment to any edge within `limit`. */
  segmentDistance(a: Pt, b: Pt, limit: number): number {
    let best = Infinity;
    const minX = Math.min(a[0], b[0]) - limit;
    const maxX = Math.max(a[0], b[0]) + limit;
    const minY = Math.min(a[1], b[1]) - limit;
    const maxY = Math.max(a[1], b[1]) + limit;
    for (const e of this.near(minX, minY, maxX, maxY)) best = Math.min(best, segmentDistance(a, b, e.c, e.d));
    return best;
  }

  /** Does any edge cross the segment a→b? */
  crosses(a: Pt, b: Pt): boolean {
    for (const e of this.near(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]))) {
      const t = segmentCrossing(a, b, e.c, e.d);
      if (t !== null && t > EPS_T && t < 1 - EPS_T) return true;
    }
    return false;
  }
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** The maximal sub-intervals of a→b whose midpoint lies on material. */
function insidePieces(a: Pt, b: Pt, index: EdgeIndex): [number, number][] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [];
  const ts = [0, 1];
  for (const e of index.near(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]))) {
    const t = segmentCrossing(a, b, e.c, e.d);
    if (t !== null && t > EPS_T && t < 1 - EPS_T) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    if ((t1 - t0) * len < 1e-6) continue;
    const m = (t0 + t1) / 2;
    if (!index.inside([a[0] + dx * m, a[1] + dy * m])) continue;
    const prev = out[out.length - 1];
    if (prev && t0 - prev[1] < EPS_T) prev[1] = t1;
    else out.push([t0, t1]);
  }
  return out;
}

function runLength(points: Pt[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  return sum;
}

export interface Run {
  points: Pt[];
  /** The whole ring survived and is still a ring. */
  closed: boolean;
}

export function clipRun(points: Pt[], index: EdgeIndex, isRing: boolean, minRun = MIN_RUN): Run[] {
  const n = points.length;
  if (n < 2) return [];
  const segments = isRing ? n : n - 1;
  const runs: Run[] = [];
  let run: Pt[] | null = null;
  let open = false;
  let fromTheStart = false;
  for (let i = 0; i < segments; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    const pieces = insidePieces(a, b, index);
    if (!pieces.length) {
      if (run) runs.push({ points: run, closed: false });
      run = null;
      open = false;
      continue;
    }
    for (let j = 0; j < pieces.length; j++) {
      const [t0, t1] = pieces[j]!;
      if (run && open && j === 0 && t0 <= EPS_T) run.push(lerp(a, b, t1));
      else {
        if (run) runs.push({ points: run, closed: false });
        run = [lerp(a, b, t0), lerp(a, b, t1)];
        if (i === 0 && j === 0 && t0 <= EPS_T) fromTheStart = true;
      }
      open = j === pieces.length - 1 && t1 >= 1 - EPS_T;
      if (!open) {
        runs.push({ points: run, closed: false });
        run = null;
      }
    }
  }
  if (run) runs.push({ points: run, closed: false });
  if (isRing && open && fromTheStart && runs.length) {
    if (runs.length === 1) runs[0] = { points: runs[0]!.points.slice(0, -1), closed: true };
    else {
      const tail = runs.pop()!;
      const head = runs.shift()!;
      runs.unshift({ points: [...tail.points, ...head.points.slice(1)], closed: false });
    }
  }
  return runs.filter((r) => r.points.length >= 2 && (r.closed || runLength(r.points) >= minRun));
}

/** The parts of each open polyline that lie on the region's material. */
export function clipPolylines(polylines: Polyline[], index: EdgeIndex): Polyline[] {
  return polylines.flatMap((p) => clipRun(p, index, false).map((r) => r.points));
}

/** Rings clipped as lines: a ring that survived whole stays closed, the rest become runs. */
export function clipRingsAsLines(rings: Ring[], index: EdgeIndex): { closed: Ring[]; open: Polyline[] } {
  const closed: Ring[] = [];
  const open: Polyline[] = [];
  for (const ring of rings) {
    for (const run of clipRun(ring, index, true)) {
      if (run.closed) closed.push(run.points);
      else open.push(run.points);
    }
  }
  return { closed, open };
}

/**
 * Cut a polyline into the pieces that stay at least `margin` from the region's edge. The
 * runs are sampled every ~`margin/2` (never coarser than 0.5 mm) and a piece is kept when its
 * midpoint clears the edge — a decorative fill is judged by eye, not by a CMM, and this keeps
 * the package free of an offset routine.
 */
export function trimNearEdge(polylines: Polyline[], index: EdgeIndex, margin: number): Polyline[] {
  if (margin <= 0) return polylines;
  const step = Math.min(0.5, margin / 2);
  const out: Polyline[] = [];
  for (const line of polylines) {
    let run: Pt[] | null = null;
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i]!;
      const b = line[i + 1]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k < n; k++) {
        const p = lerp(a, b, k / n);
        const q = lerp(a, b, (k + 1) / n);
        const m = lerp(a, b, (k + 0.5) / n);
        if (index.distance(m, margin) >= margin) {
          if (!run) run = [p];
          run.push(q);
        } else if (run) {
          out.push(run);
          run = null;
        }
      }
    }
    if (run) out.push(run);
  }
  return out.filter((r) => runLength(r) >= MIN_RUN);
}

// ---- convex polygon clipping -------------------------------------------------------------

/** Sutherland–Hodgman: `subject` clipped to the CONVEX ring `clip`. */
export function clipToConvex(subject: Ring, clip: Ring): Ring {
  const ccw = signedArea(clip) > 0 ? clip : [...clip].reverse();
  let out = subject;
  for (let i = 0; i < ccw.length && out.length; i++) {
    const a = ccw[i]!;
    const b = ccw[(i + 1) % ccw.length]!;
    const input = out;
    out = [];
    const insideOf = (p: Pt) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-9;
    for (let j = 0; j < input.length; j++) {
      const cur = input[j]!;
      const prev = input[(j + input.length - 1) % input.length]!;
      const curIn = insideOf(cur);
      const prevIn = insideOf(prev);
      if (curIn) {
        if (!prevIn) out.push(intersectLines(prev, cur, a, b));
        out.push(cur);
      } else if (prevIn) out.push(intersectLines(prev, cur, a, b));
    }
  }
  return out;
}

/** Where p→q meets the infinite LINE through a→b — Sutherland–Hodgman clips against the
 *  clip polygon's edge lines, not its edges, so the crossing may lie far past b. */
function intersectLines(p: Pt, q: Pt, a: Pt, b: Pt): Pt {
  const rx = q[0] - p[0];
  const ry = q[1] - p[1];
  const sx = b[0] - a[0];
  const sy = b[1] - a[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return p;
  const t = ((a[0] - p[0]) * sy - (a[1] - p[1]) * sx) / den;
  return lerp(p, q, Math.max(0, Math.min(1, t)));
}

/**
 * A convex hole clipped to the region: every ring of every island is clipped to the hole, and
 * what is left is nested back into islands (an outer that survived keeps the counters that did).
 * Exact for convex holes; a concave hole is the host's boolean's job.
 */
export function clipHoleToRegion(hole: Ring, region: Shapes): Island[] {
  if (!isConvex(hole)) return [];
  const rings: Ring[] = [];
  for (const island of region) {
    for (const ring of island) {
      const r = clipToConvex(ring, hole);
      if (r.length >= 3 && Math.abs(signedArea(r)) > 1e-6) rings.push(r);
    }
  }
  // Every region ring is either an outer or a hole; even-odd nesting of what survived sorts
  // them back out, because a counter clipped to the hole is still inside its outer's clip.
  return nestFromRegion(rings);
}

function nestFromRegion(rings: Ring[]): Island[] {
  if (rings.length <= 1) return rings.length ? [rings] : [];
  const areas = rings.map((r) => Math.abs(signedArea(r)));
  const order = rings.map((_, i) => i).sort((a, b) => areas[b]! - areas[a]!);
  const islands: Island[] = [];
  const parentOf = new Map<number, Island>();
  for (const i of order) {
    const r = rings[i]!;
    let depth = 0;
    let parent: Island | null = null;
    for (const j of order) {
      if (j === i || areas[j]! <= areas[i]!) continue;
      if (insideRing(r, rings[j]!)) {
        depth++;
        if (!parent) parent = parentOf.get(j) ?? null;
      }
    }
    if (depth % 2 === 0) {
      const island: Island = [r];
      islands.push(island);
      parentOf.set(i, island);
    } else if (parent) {
      parent.push(r);
      parentOf.set(i, parent);
    }
  }
  return islands;
}

function insideRing(inner: Ring, outer: Ring): boolean {
  // The centroid of a convex clip result is inside it; good enough for nesting.
  let x = 0;
  let y = 0;
  for (const p of inner) {
    x += p[0];
    y += p[1];
  }
  const c: Pt = [x / inner.length, y / inner.length];
  let inside = false;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const a = outer[i]!;
    const b = outer[j]!;
    if (a[1] > c[1] !== b[1] > c[1] && c[0] < ((b[0] - a[0]) * (c[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// ---- general polygon intersection ------------------------------------------------------------

/**
 * An island (outer ring + holes) clipped to the region — any shape against any shape, with no
 * polygon library: the boundary of A ∩ B is made of the parts of A's edges that lie inside B
 * and the parts of B's edges that lie inside A. Both are what `clipRun` already computes, so
 * the pieces are collected as segments and chained back into loops at their shared crossing
 * points. A ring that survived whole on either side is a loop already. Null when the chaining
 * leaves an open run (a crossing landed on a vertex, an edge lay along an edge) — the caller
 * then keeps the shape whole for the host's boolean, as before.
 */
export function clipIslandToRegion(input: Island, index: EdgeIndex): Island[] | null {
  // A zero-area ring (a dot flattened to three collinear points) is not a shape and cannot be
  // walked; it is dropped before anything else.
  const island = input.filter((r) => r.length >= 3 && Math.abs(signedArea(r)) > 1e-6);
  if (!island.length) return [];
  const whole = clipRingsToRegion(island, index);
  if (whole || island.length === 1) return whole;
  // A many-ringed island whose holes straddle its outer (a tile's wrap-around copies) defeats
  // the even-odd insideness the chaining relies on. Ring by ring, each is a simple polygon and
  // clips cleanly; the pieces are nested back into islands by containment.
  const rings: Ring[] = [];
  for (const ring of island) {
    const pieces = clipRingsToRegion([ring], index);
    if (!pieces) return null;
    for (const piece of pieces) for (const r of piece) rings.push(r);
  }
  return rings.length ? nestFromRegion(rings) : [];
}

function clipRingsToRegion(island: Island, index: EdgeIndex): Island[] | null {
  const islandIndex = new EdgeIndex([island]);
  const rings: Ring[] = [];
  const segments: [Pt, Pt][] = [];
  const collect = (runs: Run[]) => {
    for (const run of runs) {
      if (run.closed) rings.push(run.points);
      else for (let i = 0; i < run.points.length - 1; i++) segments.push([run.points[i]!, run.points[i + 1]!]);
    }
  };
  // No fragment is dust here: a 0.01 mm piece at a crossing is what joins two loops.
  for (const ring of island) collect(clipRun(ring, index, true, 0));
  for (const regionIsland of index.shapes) for (const ring of regionIsland) collect(clipRun(ring, islandIndex, true, 0));
  // The same crossing is computed twice — once along each polygon's edge — and the two answers
  // differ in the last bits, so endpoints are snapped by proximity before the chaining keys
  // them; a segment the snap collapsed to a point would read as a junction, so it goes.
  snapEndpoints(segments, 1e-4);
  const live = segments.filter(([a, b]) => a !== b && key(a) !== key(b));
  for (const chain of chainSegments(live)) {
    const first = chain[0]!;
    const last = chain[chain.length - 1]!;
    if (chain.length < 4 || key(first) !== key(last)) return null;
    rings.push(chain.slice(0, -1));
  }
  const kept = rings.filter((r) => r.length >= 3 && Math.abs(signedArea(r)) > 1e-6);
  return kept.length ? nestFromRegion(kept) : [];
}

/** Endpoints within `tol` of an earlier endpoint take its exact coordinates. */
function snapEndpoints(segments: [Pt, Pt][], tol: number): void {
  const cells = new Map<string, Pt[]>();
  const cellKey = (x: number, y: number) => `${Math.floor(x / tol)},${Math.floor(y / tol)}`;
  const snap = (p: Pt): Pt => {
    const cx = Math.floor(p[0] / tol);
    const cy = Math.floor(p[1] / tol);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const bucket = cells.get(`${cx + i},${cy + j}`);
        if (!bucket) continue;
        for (const q of bucket) if (Math.abs(q[0] - p[0]) <= tol && Math.abs(q[1] - p[1]) <= tol) return q;
      }
    }
    const k = cellKey(p[0], p[1]);
    let bucket = cells.get(k);
    if (!bucket) cells.set(k, (bucket = []));
    bucket.push(p);
    return p;
  };
  for (const s of segments) {
    s[0] = snap(s[0]);
    s[1] = snap(s[1]);
  }
}

// ---- segment merging ------------------------------------------------------------------------

/** Coordinates quantised to a micron, so two floats that mean the same point agree. */
const key = (p: Pt): string => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;

/**
 * Lines → unique, maximal, chained polylines. Every polyline is broken into segments, exact
 * duplicates and collinear overlaps are merged along their line, and the survivors are chained
 * end to end where exactly two meet. A hexagon lattice drawn hexagon by hexagon comes out with
 * each edge once; four half-lines from four cells come out as one line.
 */
export function mergeLines(lines: Polyline[]): Polyline[] {
  // Group by the line each segment lies on: a unit direction (sign-normalised) and the signed
  // distance of the line from the origin, both quantised.
  const groups = new Map<string, { ux: number; uy: number; ox: number; oy: number; spans: [number, number][] }>();
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i]!;
      const b = line[i + 1]!;
      let dx = b[0] - a[0];
      let dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      dx /= len;
      dy /= len;
      if (dx < -1e-9 || (Math.abs(dx) <= 1e-9 && dy < 0)) {
        dx = -dx;
        dy = -dy;
      }
      // The line's offset: the point on it nearest the origin.
      const t = a[0] * dx + a[1] * dy;
      const ox = a[0] - dx * t;
      const oy = a[1] - dy * t;
      const k = `${Math.round(dx * 1e5)},${Math.round(dy * 1e5)}|${Math.round(ox * 200)},${Math.round(oy * 200)}`;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { ux: dx, uy: dy, ox, oy, spans: [] }));
      const ta = (a[0] - g.ox) * g.ux + (a[1] - g.oy) * g.uy;
      const tb = (b[0] - g.ox) * g.ux + (b[1] - g.oy) * g.uy;
      g.spans.push(ta < tb ? [ta, tb] : [tb, ta]);
    }
  }
  const segments: [Pt, Pt][] = [];
  for (const g of groups.values()) {
    g.spans.sort((p, q) => p[0] - q[0]);
    let cur: [number, number] | null = null;
    const flush = () => {
      if (cur) segments.push([[g.ox + g.ux * cur[0], g.oy + g.uy * cur[0]], [g.ox + g.ux * cur[1], g.oy + g.uy * cur[1]]]);
    };
    for (const s of g.spans) {
      if (cur && s[0] <= cur[1] + 1e-4) cur[1] = Math.max(cur[1], s[1]);
      else {
        flush();
        cur = [s[0], s[1]];
      }
    }
    flush();
  }
  return chainSegments(segments);
}

/**
 * Filled regions → the outline of their UNION, as lines.
 *
 * A tiled fill is built cell by cell, and a motif that runs off one cell into the next leaves
 * both cells carrying the same edge along the cell boundary. Score each island on its own and
 * that boundary is burnt: a grid appears behind the pattern, drawn straight through the motif
 * it is supposed to be part of. Ian saw it on `japanese-pattern-7` (2026-09-22); it was there
 * for every one of the library's fill tiles, which is why some patterns scored cleanly and some
 * did not.
 *
 * What the eye expects is the boundary of the merged region, so: an edge covered by TWO regions
 * is interior and goes, an edge covered by one is boundary and stays. That is parity, not
 * `mergeLines`' deduplication — merging two coincident edges into one is exactly what drew the
 * grid. Partial overlaps fall out of it correctly too, because coverage is counted along the
 * line rather than per whole segment: where three cells meet along a run, only the odd stretches
 * survive.
 *
 * Not a general polygon union. It resolves coincident EDGES, which is the only way a tiled fill
 * makes an interior boundary; two regions that genuinely cross would need the host's boolean,
 * and no tile in the library does that — they are clipped to their cells by construction.
 */
export function outlineOfRegions(rings: Ring[]): Polyline[] {
  const groups = new Map<string, { ux: number; uy: number; ox: number; oy: number; spans: [number, number][] }>();
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      // Rings are closed, so the last point joins the first — that edge is a boundary like any
      // other, and leaving it out opens every loop at one arbitrary corner.
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      let dx = b[0] - a[0];
      let dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      dx /= len;
      dy /= len;
      if (dx < -1e-9 || (Math.abs(dx) <= 1e-9 && dy < 0)) {
        dx = -dx;
        dy = -dy;
      }
      const t = a[0] * dx + a[1] * dy;
      const ox = a[0] - dx * t;
      const oy = a[1] - dy * t;
      const k = `${Math.round(dx * 1e5)},${Math.round(dy * 1e5)}|${Math.round(ox * 200)},${Math.round(oy * 200)}`;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { ux: dx, uy: dy, ox, oy, spans: [] }));
      const ta = (a[0] - g.ox) * g.ux + (a[1] - g.oy) * g.uy;
      const tb = (b[0] - g.ox) * g.ux + (b[1] - g.oy) * g.uy;
      g.spans.push(ta < tb ? [ta, tb] : [tb, ta]);
    }
  }

  const segments: [Pt, Pt][] = [];
  for (const g of groups.values()) {
    const at = (s: number): Pt => [g.ox + g.ux * s, g.oy + g.uy * s];
    // Every endpoint is a place the coverage can change; between two of them it is constant, so
    // one midpoint test per interval settles it.
    const cuts = [...new Set(g.spans.flatMap((s) => s))].sort((p, q) => p - q);
    let run: [number, number] | null = null;
    const flush = () => {
      if (run) segments.push([at(run[0]), at(run[1])]);
      run = null;
    };
    for (let i = 0; i < cuts.length - 1; i++) {
      const lo = cuts[i]!;
      const hi = cuts[i + 1]!;
      if (hi - lo < 1e-6) continue;
      const mid = (lo + hi) / 2;
      let cover = 0;
      for (const [s, e] of g.spans) if (s < mid && mid < e) cover++;
      if (cover % 2 === 1) {
        if (run && Math.abs(run[1] - lo) < 1e-6) run[1] = hi;
        else {
          flush();
          run = [lo, hi];
        }
      } else flush();
    }
    flush();
  }
  return chainSegments(segments);
}

/** Segments → polylines, joined wherever exactly two segment ends meet at a point. */
export function chainSegments(segments: [Pt, Pt][]): Polyline[] {
  const at = new Map<string, number[]>();
  segments.forEach(([a, b], i) => {
    for (const p of [a, b]) {
      const k = key(p);
      let list = at.get(k);
      if (!list) at.set(k, (list = []));
      list.push(i);
    }
  });
  const used = new Array<boolean>(segments.length).fill(false);
  const out: Polyline[] = [];
  const walk = (start: number, from: Pt): Polyline => {
    const line: Polyline = [from];
    let i = start;
    let p = from;
    for (;;) {
      used[i] = true;
      const [a, b] = segments[i]!;
      const q = key(a) === key(p) ? b : a;
      line.push(q);
      const next = (at.get(key(q)) ?? []).filter((j) => !used[j]);
      if (next.length !== 1 || (at.get(key(q)) ?? []).length !== 2) break;
      i = next[0]!;
      p = q;
    }
    return line;
  };
  // Open chains first, from the ends (a point with one segment, or a junction), then whatever
  // is left are closed loops.
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    const [a, b] = segments[i]!;
    const da = (at.get(key(a)) ?? []).length;
    const db = (at.get(key(b)) ?? []).length;
    if (da !== 2) out.push(walk(i, a));
    else if (db !== 2) out.push(walk(i, b));
  }
  for (let i = 0; i < segments.length; i++) if (!used[i]) out.push(walk(i, segments[i]![0]));
  return out;
}

/** Identical closed shapes drawn by neighbouring cells collapse to one. */
export function dedupeIslands(islands: Island[]): Island[] {
  const seen = new Set<string>();
  const out: Island[] = [];
  for (const island of islands) {
    const outer = island[0];
    if (!outer || outer.length < 3) continue;
    let x = 0;
    let y = 0;
    for (const p of outer) {
      x += p[0];
      y += p[1];
    }
    const k = `${Math.round((x / outer.length) * 1000)},${Math.round((y / outer.length) * 1000)},${Math.round(Math.abs(signedArea(outer)) * 1000)},${outer.length}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(island);
  }
  return out;
}
