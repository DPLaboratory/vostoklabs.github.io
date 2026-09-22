// The one entry point: a region, a pattern, an operation → what the laser does.
//
// Pattern space is the pattern's own frame (a cell at the origin, or a field about the
// origin). Region space is the caller's, Y up, mm. Between them sits one similarity —
// scale, rotate about the region's centre, slide — and everything the laser cares about is
// decided in region space against the region's real outline:
//
//   cut      closed shapes become holes. A hole is kept only when it lies wholly on material
//            and clears the edge by `web`; a hole that would touch the edge would open the
//            outline, and one that would touch its neighbour would leave a splinter.
//   score    lines are clipped to the material; closed shapes are scored round as lines.
//   engrave  closed shapes are filled regions clipped to the outline; lines ride along as
//            hairline engraves.
//
// An inset shrinks the region first (a vertex offset with a mitre cap — enough for the blanks
// this fills, and it gives up cleanly, with a warning, on an outline it cannot shrink).
import { EdgeIndex, clipHoleToRegion, clipIslandToRegion, clipPolylines, clipRingsAsLines, dedupeIslands, mergeLines, trimNearEdge } from './clip';
import { bboxOfShapes, boxCentre, boxValid, isConvex, ringLength, segmentsIntersect, signedArea, slot as slotRing } from './geom';
import { resolveParams } from './params';
import { tileGeometry } from './tiler';
import type { Box, FillOptions, FillResult, FillStats, Island, PatternDef, PatternGeometry, Pt, Polyline, Ring, Shapes } from './types';

const DEFAULT_WEB = 1.5;

export function fillShape(region: Shapes, def: PatternDef, opts: FillOptions): FillResult {
  const warnings: string[] = [];
  const stats: FillStats = { cells: 0, holes: 0, dropped: 0, lines: 0, lineLength: 0, area: 0, unclipped: 0 };
  const op = opts.op;
  const empty = (): FillResult => ({ op, shapes: [], paths: [], stats, warnings });

  const live = region.map((i) => i.filter((r) => r.length >= 3)).filter((i) => i.length > 0);
  const box = bboxOfShapes(live);
  if (!live.length || !boxValid(box)) return empty();
  const p = resolveParams(def, opts.params);
  if (!def.ops.includes(op)) warnings.push(`${def.name} is meant to be ${def.ops.join(' or ')}, not ${op}.`);

  // ---- the similarity between pattern space and region space ----
  const scale = opts.scale && opts.scale > 0 ? opts.scale : 1;
  const theta = ((opts.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const c = boxCentre(box);
  const align = opts.align ?? 'centre';
  const o: Pt = align === 'centre' ? c : [box.minX, box.minY];
  const dx = opts.dx ?? 0;
  const dy = opts.dy ?? 0;
  const toRegion = ([x, y]: Pt): Pt => {
    const px = x * scale + (o[0] - c[0]);
    const py = y * scale + (o[1] - c[1]);
    return [c[0] + px * cos - py * sin + dx, c[1] + px * sin + py * cos + dy];
  };
  const toPattern = ([x, y]: Pt): Pt => {
    const rx = x - c[0] - dx;
    const ry = y - c[1] - dy;
    const px = rx * cos + ry * sin;
    const py = -rx * sin + ry * cos;
    return [(px - (o[0] - c[0])) / scale, (py - (o[1] - c[1])) / scale];
  };
  const regionCorners: Pt[] = [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
    [box.minX, box.maxY],
  ];
  const corners = regionCorners.map(toPattern);
  const pbox: Box = {
    minX: Math.min(...corners.map((q) => q[0])),
    minY: Math.min(...corners.map((q) => q[1])),
    maxX: Math.max(...corners.map((q) => q[0])),
    maxY: Math.max(...corners.map((q) => q[1])),
  };

  // ---- generate ----
  let geo: PatternGeometry;
  if (def.tile && def.cell) {
    const t = tileGeometry(def, p, pbox, align === 'centre');
    stats.cells = t.cells;
    if (t.overflow) {
      warnings.push(`${def.name} at this size would need ${t.cells.toLocaleString()} cells — make it larger.`);
      return empty();
    }
    geo = t.geo;
  } else if (def.generate) {
    geo = def.generate(pbox, p);
  } else return empty();

  // Rings with no area (a dot flattened to a line) are not shapes; an island whose outer is one
  // is nothing at all.
  const holes = dedupeIslands(
    geo.holes
      .map((i) => i.map((r) => r.map(toRegion)).filter((r) => r.length >= 3 && Math.abs(signedArea(r)) > 1e-6))
      .filter((i) => i.length > 0),
  );
  const lines = mergeLines(geo.lines.map((l) => l.map(toRegion)));
  const slits = mergeLines(geo.slits.map((l) => l.map(toRegion)));

  // ---- the region to clip against ----
  const web = Math.max(0, opts.web ?? DEFAULT_WEB);
  const inset = Math.max(0, opts.inset ?? (op === 'cut' ? web : 0));
  let clipRegion = live;
  if (inset > 0) {
    const shrunk = insetShapes(live, inset);
    if (shrunk) clipRegion = shrunk;
    else warnings.push(`Could not keep a ${inset} mm margin on this outline; the pattern runs to the edge.`);
  }
  const index = new EdgeIndex(clipRegion);
  const partial = opts.partial ?? (op === 'cut' ? 'drop' : 'clip');

  if (op === 'cut') {
    const wanted = def.web?.(p);
    if (!holes.length && !slits.length) {
      warnings.push(`${def.name} is made of lines, so it can only be scored or engraved.`);
      return empty();
    }
    if (wanted !== undefined && wanted <= 1e-6) {
      // Shapes that touch or overlap: cut out, the material between them is gone and the
      // pieces they enclose fall out of the bed. Engrave it instead.
      warnings.push(`${def.name}'s shapes touch each other, so cutting them out would leave loose pieces — engrave it instead.`);
      return empty();
    }
    if (wanted !== undefined && wanted < web - 1e-6) warnings.push(`${def.name} leaves only ${round(wanted)} mm between cuts here; ${round(web)} mm is the minimum you asked for — widen the gap.`);
  }

  // ---- closed shapes ----
  const shapes: Shapes = [];
  const scoredRings: Ring[] = [];
  for (const island of holes) {
    const outer = island[0]!;
    const state = classify(outer, index);
    if (state === 'outside') {
      stats.dropped++;
      continue;
    }
    if (op === 'score') {
      for (const r of island) scoredRings.push(r);
      continue;
    }
    if (state === 'inside') {
      if (op === 'cut' && island.length > 1) {
        // An annulus cut out drops its middle on the bed; cut the outer only.
        shapes.push([outer]);
      } else shapes.push(island);
      continue;
    }
    // Crossing the (inset) edge.
    if (op === 'cut' || partial === 'drop') {
      stats.dropped++;
      continue;
    }
    if (partial === 'keep') {
      shapes.push(island);
      continue;
    }
    if (island.length === 1 && isConvex(outer)) {
      const clipped = clipHoleToRegion(outer, clipRegion);
      if (clipped.length) shapes.push(...clipped);
      else stats.dropped++;
      continue;
    }
    // Any other shape: the general intersection, and the host's boolean or the whole shape
    // only when a degenerate crossing defeats it.
    const general = clipIslandToRegion(island, index);
    if (general) {
      if (general.length) shapes.push(...general);
      else stats.dropped++;
    } else if (opts.clipPolygons) {
      const clipped = opts.clipPolygons([island], clipRegion);
      if (clipped.length) shapes.push(...clipped);
      else stats.dropped++;
    } else {
      shapes.push(island);
      stats.unclipped++;
    }
  }

  // ---- lines ----
  let paths: Polyline[] = [];
  if (op === 'cut') {
    if (slits.length) {
      const kept = trimNearEdge(clipPolylines(slits, index), index, Math.max(0, web - inset));
      if (opts.slitWidth && opts.slitWidth > 0) {
        for (const run of kept) for (const s of slitsToSlots(run, opts.slitWidth)) shapes.push([s]);
      } else paths = kept;
    }
  } else {
    const wanted: Polyline[] = [...lines, ...slits];
    paths = clipPolylines(wanted, index);
    if (op === 'score' && scoredRings.length) {
      const rings = clipRingsAsLines(scoredRings, index);
      for (const r of rings.closed) shapes.push([r]);
      paths.push(...rings.open);
    }
    if (op === 'engrave') {
      // Engraved lines are burnt as bands when a width is known: a quad per segment and a
      // disc at every joint and end, overlapping where they meet — the host's union makes
      // them one region, and a same-colour fill reads as one anyway.
      const width = opts.strokeWidth ?? def.strokeWidth?.(p) ?? 0;
      if (width >= 0.1 && paths.length) {
        for (const run of paths) for (const band of bandsOf(run, width)) shapes.push([band]);
        paths = [];
      }
    }
  }

  stats.holes = shapes.length;
  stats.lines = paths.length;
  for (const line of paths) stats.lineLength += ringLength(line, false);
  for (const island of shapes) {
    if (op === 'score') stats.lineLength += ringLength(island[0]!, true);
    else for (let i = 0; i < island.length; i++) stats.area += (i === 0 ? 1 : -1) * Math.abs(signedArea(island[i]!));
  }
  if (op === 'cut' && stats.unclipped === 0 && stats.holes === 0 && stats.lines === 0 && (holes.length || slits.length)) {
    warnings.push(`Nothing of ${def.name} fits inside this shape with a ${round(web)} mm web — shrink the pattern or the web.`);
  }
  return { op, shapes, paths, stats, warnings };
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Wholly on material, wholly off it, or across the edge. */
function classify(ring: Ring, index: EdgeIndex): 'inside' | 'outside' | 'crossing' {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const near = index.near(minX, minY, maxX, maxY);
  if (near.length) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      for (const e of near) if (segmentsIntersect(a, b, e.c, e.d)) return 'crossing';
    }
    // No edge crosses the ring, but a region island could sit wholly inside it (a counter of a
    // letter inside a big hole): then the hole is not on plain material either.
    for (const e of near) if (pointInRingFast(e.c, ring)) return 'crossing';
  }
  return index.inside(ring[0]!) ? 'inside' : 'outside';
}

function pointInRingFast(p: Pt, ring: Ring): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** A polyline as a band of `width`: one quad per segment, a disc at each joint and both ends. */
function bandsOf(run: Polyline, width: number): Ring[] {
  const out: Ring[] = [];
  const h = width / 2;
  const disc = (c: Pt): Ring => {
    const n = Math.max(8, Math.min(24, Math.ceil((Math.PI * width) / 0.3)));
    const r: Ring = [];
    for (let i = 0; i < n; i++) r.push([c[0] + h * Math.cos((i / n) * 2 * Math.PI), c[1] + h * Math.sin((i / n) * 2 * Math.PI)]);
    return r;
  };
  for (let i = 0; i < run.length - 1; i++) {
    const a = run[i]!;
    const b = run[i + 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const nx = (-dy / len) * h;
    const ny = (dx / len) * h;
    out.push([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]);
  }
  for (const q of run) out.push(disc(q));
  return out;
}

/** A slit as closed slots, one per straight run, so a host with a shapes-only cut layer can
 *  take a living hinge. */
function slitsToSlots(run: Polyline, width: number): Ring[] {
  const out: Ring[] = [];
  for (let i = 0; i < run.length - 1; i++) {
    const a = run[i]!;
    const b = run[i + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const s = slotRing(0, 0, len + width, width);
    const cx = (a[0] + b[0]) / 2;
    const cy = (a[1] + b[1]) / 2;
    out.push(s.map(([x, y]) => [cx + x * Math.cos(ang) - y * Math.sin(ang), cy + x * Math.sin(ang) + y * Math.cos(ang)]));
  }
  return out;
}

/**
 * The region shrunk by `d` on every side: each ring's vertices slide along their angle
 * bisectors toward the material, mitres capped at 3d so a sharp corner does not spike. Null
 * when a ring would fold over itself (a feature narrower than 2d) — the caller then clips to
 * the real outline and says so.
 */
export function insetShapes(shapes: Shapes, d: number): Shapes | null {
  const out: Shapes = [];
  for (const island of shapes) {
    const isl: Island = [];
    for (let k = 0; k < island.length; k++) {
      const ring = island[k]!;
      // Outers run CCW, holes CW: the material is then always on the left of travel.
      const ccw = signedArea(ring) > 0;
      const oriented = (k === 0) === ccw ? ring : [...ring].reverse();
      const moved = offsetRingLeft(oriented, d);
      if (!moved) return null;
      if (k === 0 && Math.abs(signedArea(moved)) < 1e-6) return null;
      if (k === 0 || Math.abs(signedArea(moved)) > 1e-6) isl.push(moved);
    }
    if (isl.length) out.push(isl);
  }
  return out.length ? out : null;
}

function offsetRingLeft(ring: Ring, d: number): Ring | null {
  const n = ring.length;
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i + n - 1) % n]!;
    const q = ring[i]!;
    const r = ring[(i + 1) % n]!;
    let ax = q[0] - p[0];
    let ay = q[1] - p[1];
    let bx = r[0] - q[0];
    let by = r[1] - q[1];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) continue;
    ax /= la;
    ay /= la;
    bx /= lb;
    by /= lb;
    // Left normals of the two edges; the mitre direction is their sum.
    const n1x = -ay;
    const n1y = ax;
    const n2x = -by;
    const n2y = bx;
    let mx = n1x + n2x;
    let my = n1y + n2y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-9) {
      // A hairpin: fall back to the first normal.
      mx = n1x;
      my = n1y;
    } else {
      mx /= ml;
      my /= ml;
    }
    const cosHalf = mx * n1x + my * n1y;
    const len = Math.min(3 * d, d / Math.max(cosHalf, 1 / 3));
    out.push([q[0] + mx * len, q[1] + my * len]);
  }
  if (out.length < 3) return null;
  // Folded over: an edge crosses a non-adjacent edge, or the winding flipped.
  if (Math.sign(signedArea(out)) !== Math.sign(signedArea(ring))) return null;
  const m = out.length;
  if (m <= 400) {
    for (let i = 0; i < m; i++) {
      const a = out[i]!;
      const b = out[(i + 1) % m]!;
      for (let j = i + 2; j < m; j++) {
        if (i === 0 && j === m - 1) continue;
        const cc = out[j]!;
        const dd = out[(j + 1) % m]!;
        if (segmentsIntersect(a, b, cc, dd)) return null;
      }
    }
  }
  return out;
}

export function geometryBox(geo: PatternGeometry): Box {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow = ([x, y]: Pt) => {
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
  };
  for (const i of geo.holes) for (const r of i) for (const q of r) grow(q);
  for (const l of geo.lines) for (const q of l) grow(q);
  for (const l of geo.slits) for (const q of l) grow(q);
  return b;
}
