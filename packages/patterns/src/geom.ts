// Plain 2-D helpers with no opinions: every pattern file and the fill build on these, and
// nothing here knows what a pattern is.
import type { Box, Island, Pt, Polyline, Ring, Shapes } from './types';

export const TAU = Math.PI * 2;
export const SQRT3 = Math.sqrt(3);

export const pt = (x: number, y: number): Pt => [x, y];

/** Shoelace: positive for a counter-clockwise ring (Y up), the convention @vostok/laser uses. */
export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[i]!;
    const q = ring[j]!;
    a += q[0] * p[1] - p[0] * q[1];
  }
  return a / 2;
}

export function ringLength(points: Pt[], closed: boolean): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  if (closed && points.length > 1) sum += Math.hypot(points[0]![0] - points[points.length - 1]![0], points[0]![1] - points[points.length - 1]![1]);
  return sum;
}

export function emptyBox(): Box {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function growBox(b: Box, p: Pt): void {
  if (p[0] < b.minX) b.minX = p[0];
  if (p[0] > b.maxX) b.maxX = p[0];
  if (p[1] < b.minY) b.minY = p[1];
  if (p[1] > b.maxY) b.maxY = p[1];
}

export function bboxOfPoints(points: Pt[]): Box {
  const b = emptyBox();
  for (const p of points) growBox(b, p);
  return b;
}

export function bboxOfShapes(shapes: Shapes): Box {
  const b = emptyBox();
  for (const island of shapes) for (const ring of island) for (const p of ring) growBox(b, p);
  return b;
}

export const boxValid = (b: Box): boolean => Number.isFinite(b.minX) && b.maxX >= b.minX && b.maxY >= b.minY;

export function padBox(b: Box, pad: number): Box {
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

export const boxCentre = (b: Box): Pt => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];

/** Even-odd point-in-ring (a point on the edge is a coin toss, as everywhere). */
export function pointInRing(p: Pt, ring: Ring): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** Inside the material of `shapes`: even-odd across every ring at once, which is right for
 *  islands whose holes are their own rings and wrong for overlapping outers (union those first). */
export function insideShapes(shapes: Shapes, p: Pt): boolean {
  let inside = false;
  for (const island of shapes) for (const ring of island) if (pointInRing(p, ring)) inside = !inside;
  return inside;
}

export function pointSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = p[0] - a[0];
  const wy = p[1] - a[1];
  const l2 = vx * vx + vy * vy;
  const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / l2));
  return Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t));
}

/** Where a→b crosses c→d as a fraction along a→b, or null when parallel or the crossing misses c→d. */
export function segmentCrossing(a: Pt, b: Pt, c: Pt, d: Pt): number | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0];
  const qy = c[1] - a[1];
  const u = (qx * ry - qy * rx) / den;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  return (qx * sy - qy * sx) / den;
}

export function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const t = segmentCrossing(a, b, c, d);
  return t !== null && t >= -1e-9 && t <= 1 + 1e-9;
}

/** The least distance between two segments. */
export function segmentDistance(a: Pt, b: Pt, c: Pt, d: Pt): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

export function isConvex(ring: Ring): boolean {
  const n = ring.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const c = ring[(i + 2) % n]!;
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-12) continue;
    const s = z > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export function ringCentroid(ring: Ring): Pt {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

// ---- transforms -------------------------------------------------------------------------

export const translatePts = (points: Pt[], dx: number, dy: number): Pt[] => points.map(([x, y]) => [x + dx, y + dy]);

export function mapIsland(island: Island, fn: (p: Pt) => Pt): Island {
  return island.map((r) => r.map(fn));
}

export function mapShapes(shapes: Shapes, fn: (p: Pt) => Pt): Shapes {
  return shapes.map((i) => mapIsland(i, fn));
}

/** Scale a ring about its centroid — how a hole gets its web without an offset routine. */
export function shrinkRing(ring: Ring, k: number): Ring {
  const c = ringCentroid(ring);
  return ring.map(([x, y]) => [c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k]);
}

// ---- primitives ---------------------------------------------------------------------------

/** How many chords a circle of radius r gets: about one per 0.4 mm of arc, 12..180. */
export function circleSegments(r: number): number {
  return Math.max(12, Math.min(180, Math.ceil((TAU * Math.abs(r)) / 0.4)));
}

export function circle(cx: number, cy: number, r: number, n = circleSegments(r)): Ring {
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return out;
}

/** An open arc from angle a0 to a1 (radians, CCW positive), sampled to the circle's density. */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, n?: number): Polyline {
  const span = a1 - a0;
  const steps = n ?? Math.max(2, Math.ceil((Math.abs(span) / TAU) * circleSegments(r)));
  const out: Polyline = [];
  for (let i = 0; i <= steps; i++) {
    const t = a0 + (span * i) / steps;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return out;
}

/** A regular n-gon of circumradius r; `rot` (radians) turns it, 0 = a vertex on +X. */
export function regularPolygon(cx: number, cy: number, r: number, n: number, rot = 0): Ring {
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const t = rot + (i / n) * TAU;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return out;
}

/** A pointy-top regular hexagon from its across-flats width. */
export function hexagon(cx: number, cy: number, acrossFlats: number): Ring {
  return regularPolygon(cx, cy, acrossFlats / SQRT3, 6, Math.PI / 6);
}

export function rect(cx: number, cy: number, w: number, h: number): Ring {
  return [
    [cx - w / 2, cy - h / 2],
    [cx + w / 2, cy - h / 2],
    [cx + w / 2, cy + h / 2],
    [cx - w / 2, cy + h / 2],
  ];
}

export function roundedRect(cx: number, cy: number, w: number, h: number, r: number): Ring {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr < 1e-6) return rect(cx, cy, w, h);
  const seg = Math.max(2, Math.ceil(circleSegments(rr) / 4));
  const out: Ring = [];
  const corners: [number, number, number][] = [
    [cx + w / 2 - rr, cy - h / 2 + rr, -Math.PI / 2],
    [cx + w / 2 - rr, cy + h / 2 - rr, 0],
    [cx - w / 2 + rr, cy + h / 2 - rr, Math.PI / 2],
    [cx - w / 2 + rr, cy - h / 2 + rr, Math.PI],
  ];
  for (const [x, y, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const t = a0 + ((Math.PI / 2) * i) / seg;
      out.push([x + rr * Math.cos(t), y + rr * Math.sin(t)]);
    }
  }
  return out;
}

/** A stadium: a slot of length l (tip to tip) and width w along +X. */
export function slot(cx: number, cy: number, l: number, w: number): Ring {
  return roundedRect(cx, cy, Math.max(l, w), w, w / 2);
}

export function star(cx: number, cy: number, points: number, rOuter: number, rInner: number, rot = Math.PI / 2): Ring {
  const out: Ring = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const t = rot + (i / (points * 2)) * TAU;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return out;
}

export const seg = (a: Pt, b: Pt): Polyline => [a, b];

/** A polyline y = f(x) sampled every `step` from x0 to x1. */
export function sampled(x0: number, x1: number, step: number, f: (x: number) => number): Polyline {
  const n = Math.max(1, Math.ceil((x1 - x0) / step));
  const out: Polyline = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    out.push([x, f(x)]);
  }
  return out;
}

// ---- nesting -------------------------------------------------------------------------------

/**
 * Loose rings → islands by even-odd containment: a ring inside an odd number of larger rings is
 * a hole of the nearest one around it. What an SVG tile's `fill-rule` means, made explicit.
 */
export function nestRings(rings: Ring[]): Island[] {
  const live = rings.filter((r) => r.length >= 3 && Math.abs(signedArea(r)) > 1e-9);
  const order = live.map((r, i) => ({ r, i, area: Math.abs(signedArea(r)) })).sort((a, b) => b.area - a.area);
  const depth = new Map<number, number>();
  const parent = new Map<number, number>();
  for (let k = 0; k < order.length; k++) {
    const me = order[k]!;
    const probe = me.r[0]!;
    let d = 0;
    let nearest = -1;
    for (let j = k - 1; j >= 0; j--) {
      const other = order[j]!;
      if (pointInRing(probe, other.r)) {
        d++;
        if (nearest < 0) nearest = other.i;
      }
    }
    depth.set(me.i, d);
    parent.set(me.i, nearest);
  }
  const islands = new Map<number, Island>();
  for (const { r, i } of order) if (depth.get(i)! % 2 === 0) islands.set(i, [r]);
  for (const { r, i } of order) {
    if (depth.get(i)! % 2 === 0) continue;
    const p = parent.get(i)!;
    const island = islands.get(p);
    if (island) island.push(r);
  }
  return [...islands.values()];
}
