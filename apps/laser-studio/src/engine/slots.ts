// Kerf-aware joints: the two widths a cut joint is drawn at, and the slot and tab rings
// themselves. Pure rings, millimetres, Y up, outer rings CCW. The constructions built OUT of
// The stands that used them live in ./cross-stand.ts, ./tent.ts and ./slot-stand.ts (2026-09-22).
//
// There is no CSG on the main thread, so nothing here subtracts anything: a notch is built as
// part of the outline ring that carries it, and `slotRing`/`tabRing` hand back plain rings for
// the cases where the worker (or a `minus` layer) does the boolean.
import type { CutRing } from '@vostok/export';

export type SlotEdge = 'top' | 'bottom' | 'left' | 'right';

/** How far past its own edge a slot or tab runs, mm — enough that the cut clears the corner. */
const OVERSHOOT = 0.5;
/** The lead-in chamfer on a tab's free end, mm. */
const CHAMFER = 0.4;

/**
 * The width to DRAW a slot so a piece `thickness` thick fits it after cutting.
 *
 * Sign convention: the beam removes `kerf` of material, so a slot leaves the machine about
 * `kerf` WIDER than it was drawn. Draw it that much narrower and the cut slot lands on
 * `thickness + clearance` — a push fit you tap home, not a rattle. The default 0.05 mm
 * clearance is a hand press fit in ply; raise it for a joint that has to go together dry and
 * often, drop it to 0 for a glued one.
 */
export function slotWidth(thickness: number, kerf: number, clearance = 0.05): number {
  return thickness - kerf + clearance;
}

/**
 * The width to DRAW a TAB so it comes off the machine `nominal` mm across.
 *
 * `slotWidth`'s missing companion, and the other half of a joint where BOTH sides are cut. A
 * slot is a void, so the beam takes its `kerf` out of the walls and the opening grows; a tab is
 * a boss, so the beam takes the same `kerf` out of the tab itself and it shrinks. Mating two cut
 * faces therefore splits the compensation: draw the tab a kerf WIDE (`n + kerf`) and the slot a
 * kerf NARROW (`slotWidth`), and the physical pair lands exactly `clearance` apart.
 *
 * Never needed where a "tab" is the raw sheet edge — the material's own thickness is not cut
 * in-plane, so `slotWidth` alone is right there and always has been.
 */
export function tabWidth(nominal: number, kerf: number): number {
  return nominal + kerf;
}

// ------------------------------------------------------------------ slots and tabs --

/** Into the part, from each edge. */
const AXIS: Record<SlotEdge, [number, number]> = {
  bottom: [0, 1],
  top: [0, -1],
  left: [1, 0],
  right: [-1, 0],
};

interface Rect { minX: number; minY: number; maxX: number; maxY: number }

/** A band `width` across, running from `t0` to `t1` along the inward axis of `from`. */
function band(cx: number, cy: number, width: number, t0: number, t1: number, from: SlotEdge): Rect {
  const [ax, ay] = AXIS[from];
  const half = width / 2;
  const x0 = cx + ax * t0;
  const x1 = cx + ax * t1;
  const y0 = cy + ay * t0;
  const y1 = cy + ay * t1;
  return {
    minX: Math.min(x0, x1) - Math.abs(ay) * half,
    maxX: Math.max(x0, x1) + Math.abs(ay) * half,
    minY: Math.min(y0, y1) - Math.abs(ax) * half,
    maxY: Math.max(y0, y1) + Math.abs(ax) * half,
  };
}

const rectRing = (r: Rect): CutRing => [[r.minX, r.minY], [r.maxX, r.minY], [r.maxX, r.maxY], [r.minX, r.maxY]];

/**
 * An open slot: `width` × `depth`, its open end on the part's edge at (cx, cy) and its closed
 * end `depth` INTO the part. `from: 'bottom'` opens downward at the bottom edge, so it spans
 * y ∈ [cy − 0.5, cy + depth] — the half millimetre of overshoot past the edge is what makes it
 * an open slot instead of a slot with a 0.0 mm sliver of material left across its mouth.
 *
 * Meant to be subtracted: give it to a layer with `op: 'cut'`, or to `minus`.
 */
export function slotRing(cx: number, cy: number, width: number, depth: number, from: SlotEdge): CutRing {
  return rectRing(band(cx, cy, width, -OVERSHOOT, depth, from));
}

/**
 * The mating tab: `width` × `depth` sticking OUT of the edge at (cx, cy), overlapping the part
 * by half a millimetre so a union welds it on rather than leaving a hairline seam. Its free end
 * is chamfered 0.4 mm so it starts in the slot instead of catching on the lip.
 */
export function tabRing(cx: number, cy: number, width: number, depth: number, from: SlotEdge): CutRing {
  const ring = rectRing(band(cx, cy, width, -depth, OVERSHOOT, from));
  const [ax, ay] = AXIS[from];
  const along = (p: [number, number]) => (p[0] - cx) * ax + (p[1] - cy) * ay;
  const free = Math.min(...ring.map(along));
  const ch = Math.max(0, Math.min(CHAMFER, width / 2, depth));
  if (ch === 0) return ring;
  return chamfer(ring, (p) => along(p) < free + 1e-9, ch);
}

/** Replace the picked corners with a short flat, walking order preserved. */
function chamfer(ring: CutRing, pick: (p: [number, number]) => boolean, ch: number): CutRing {
  const n = ring.length;
  const out: CutRing = [];
  const towards = (p: [number, number], q: [number, number]): [number, number] => {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const t = len === 0 ? 0 : Math.min(ch, len / 2) / len;
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  };
  for (let i = 0; i < n; i++) {
    const p = ring[i]!;
    if (!pick(p)) {
      out.push(p);
      continue;
    }
    out.push(towards(p, ring[(i + n - 1) % n]!), towards(p, ring[(i + 1) % n]!));
  }
  return out;
}

// ------------------------------------------------------------------ the stand --

