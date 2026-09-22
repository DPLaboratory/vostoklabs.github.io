import { readSymbols } from '../symbols/model';
// Sports bag tags — one template per ball, each a fixed two-layer build in the arrangement the
// competition ships (Ian, 2026-09-21: "look how competition does it, bottom is the ball, with
// ball style engraved, second layer is the name and the number, both stuck to the frame" —
// `ref/REF-cuttle-basketball-bag-tag.png`, `ref/REF-cuttle-baseball-bag-tag.png`,
// `ref/REF-cuttle-football-bag-tag.png`).
//
// What this replaces: `sports-bag-tag.ts`, one template with a Ball thumbs picker whose five
// tiles were one football and four identical discs, a name and a number welded into a lump on
// the ball's face, and the loop tab dragged wherever. Four templates now, one ball each, and
// the ball is the gallery card rather than a dropdown.
//
// The two pieces, always, one origin:
//
//   BACKER  the ball's own silhouette from the DARK sheet, carrying the marks that make it that
//           ball (a basketball's seams, a baseball's stitches, a soccer ball's panels, a
//           football's scored band) and the hanging hole. Never any lettering in Raised mode:
//           what the eye reads first is the light piece on top.
//   FRAME   the primary, from the LIGHT sheet: the same silhouette as a constant-width RIM, with
//           the name across the window and the number below it WELDED into the ring where they
//           touch it (the union is one island — §6.1 of `docs/design/laser-cutting-knowledge.md`
//           records this as Cuttle's own construction), and every junction SCORED so the letters
//           read as their own shapes on the frame rather than as lumps of it (`ringPatches`).
//           A football's laces are welded into the ring the same way, centred along the ball's
//           long axis and hanging into the window.
//
// "Text doesn't need to be a single body, people will glue it on anyway" (Ian): where the name
// cannot reach the ring — a long name on a shallow football, a block face whose word is too deep
// for the window's ends — it becomes its OWN light piece, centred in the window with
// `assembledAt` and a scored glue guide on the backer. Never a bridge bar across the window.
//
// The numbers, all derived from Size, because each has exactly one right answer once the
// customer has said how big the tag is (Ø 85 mm default; 75–89 mm is the sourced range for a
// round ball tag, `laser-cutting-knowledge.md` §6.2). At Ø 85 with a 3 mm hole:
//   rim        = max(rimWidthFor(D), holeDia + 2 × WALL)      → 7.0 mm
//   window     = the ball's TRUE offset by the rim            → 71.0 × 71.0, football 68.2 × 34.6
//   hole       = Ø 3 on the rim's centre line at the top      → 2.0 mm of wall on both sides
//   bite       = 0.45 × rim, 2–4 mm                           → 3.2 mm of welded overlap
//   number ink = 0.24 × the window's height + the bite        → 20.2 mm, 17.0 of it in the window
import {
  bboxOf,
  blankById,
  blankDetail,
  circleRing,
  placeShapes,
  signedArea,
  strokeRing,
  type BlankParams,
  type Box,
  type Pt,
  type Shapes,
} from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { rimWidthFor } from '../engine/frame';
import { sizeForCapHeight, textMetrics } from '../engine/metrics';
import { MIN_COUNTER, textLayer } from '../engine/text';
import type { BuildInput, DesignLayer, KeyringSpec, PartInput } from '../engine/types';
import { NO_KEYRING, hangHoleFields } from './keyring';
import {
  WELDING_SCRIPTS,
  connectSpec,
  countersTooTight,
  letterScoreField,
  lightPieceFields,
  stem,
} from './shared';
import { num, str, type Field, type TemplateDef, type Values } from './types';

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
const more = (f: Field): Field => ({ ...f, advanced: true });

/** Material left round the hanging hole, mm. §5.2/§5.4 of the laser reference: 2 mm is real
 *  shipped precedent on plywood, and the rim is GROWN to hold it rather than the hole being
 *  slid inward to find its own border. */
const WALL = 2;
/** How far any ink stays inside the ball's own outer edge, mm. */
const EDGE = 1.5;
/** How much window a name that could NOT reach the ring keeps between itself and the rim, mm —
 *  it is a separate piece then, and a piece glued 2 mm off the frame still reads as centred. */
const CLEAR = 2;
/** Below this a welded letter stops reading as a letter (00-context §1.2). */
const MIN_CAP = 3;
/** How far inside a light piece's own edge its glue guide is scored, so the line disappears
 *  under the piece that is glued over it. */
const GUIDE_INSET = 0.3;

/** How deep welded ink runs into the ring, mm: enough that the weld survives kerf on both edges
 *  and reads as a join rather than a kiss, never so deep that the ink reaches the outer edge. */
const biteFor = (rim: number) => clamp(0.45 * rim, 2, 4);
/** Air between the name, the number and a football's laces, mm. */
const gapFor = (D: number) => Math.max(1.5, 0.02 * D);
/** The bar that holds an i's dot to the rest of a welded word, mm (G33: 1.5–3). */
const bridgeFor = (size: number) => Math.min(3, Math.max(1.5, 0.12 * size));

/**
 * The faces this design is for, in order (G2). `WELDING_SCRIPTS` first — the four bundled faces
 * measured to write as ONE connected line, so a name set in them is the glyph outlines exactly
 * as the type designer drew them, with no overlap walk and no seams to score (G33). That is what
 * every reference tag is set in: a flowing script welded to the ring.
 *
 * Then three fat rounded faces for a block name, which weld and score instead. Each was built
 * here at the card's own name and at "Alexandra" before it was listed: one island, counters
 * open, and the ring still one piece.
 */
const TAG_FACES = [...WELDING_SCRIPTS, 'fredoka', 'baloo-2', 'lilita-one'];

// ------------------------------------------------------------------- the ball, as geometry --

/**
 * Every ball this design ships is a LENS: the intersection of two discs of radius `r` centred at
 * (0, ∓cy). A round ball is the degenerate case, cy = 0.
 *
 * This is what lets the frame be cut on the main thread. Erosion distributes over intersection —
 * (A ∩ B) ⊖ D = (A ⊖ D) ∩ (B ⊖ D) — so the window is the SAME lens with `r − rim`, exactly, with
 * no offset pass in the worker and no scaled-down copy of the outline pretending to be one. The
 * difference matters on the football: at Ø 85 a 7 mm rim takes 7 mm off the ball's height and
 * 8.4 mm off each pointed end, which is what a true offset does and a scale never can.
 */
interface Lens {
  /** Half-width and half-height of the lens, mm. */
  halfW: number;
  halfH: number;
  /** The two disc centres' y offset, and their radius. */
  cy: number;
  r: number;
}

/** The lens with `halfW × halfH`, from the standard chord identity. */
function lensOf(halfW: number, halfH: number): Lens {
  const cy = Math.abs(halfW - halfH) < 1e-9 ? 0 : (halfW * halfW - halfH * halfH) / (2 * halfH);
  return { halfW, halfH, cy, r: halfH + cy };
}

/** The same lens eroded by `d` — its own radius less `d`, the centres untouched. Null when the
 *  erosion has swallowed it. */
function erode(lens: Lens, d: number): Lens | null {
  const r = lens.r - d;
  if (r <= lens.cy + 0.5) return null;
  return { halfW: Math.sqrt(Math.max(0, r * r - lens.cy * lens.cy)), halfH: r - lens.cy, cy: lens.cy, r };
}

/** How far inside the lens a point lies, mm — negative outside. The window's edge is at `rim`,
 *  so `depth < rim` is the ring and `depth < 0` is off the ball. */
function depthIn(lens: Lens, p: Pt): number {
  const a = lens.r - Math.hypot(p[0], p[1] + lens.cy);
  if (lens.cy === 0) return a;
  return Math.min(a, lens.r - Math.hypot(p[0], p[1] - lens.cy));
}

/** The lens as a ring, wound CCW: the top arc left to right over the top, then the bottom arc
 *  back under. A circle when `cy` is 0. */
function lensRing(lens: Lens, n = 96): CutRing {
  if (lens.cy === 0) return circleRing(0, 0, lens.r, n);
  const t0 = Math.atan2(lens.cy, lens.halfW); // the right tip, seen from the lower centre
  const ring: CutRing = [];
  const steps = Math.max(8, Math.round(n / 2));
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((Math.PI - 2 * t0) * i) / steps;
    ring.push([lens.r * Math.cos(t), -lens.cy + lens.r * Math.sin(t)]);
  }
  for (let i = 1; i < steps; i++) {
    const t = t0 - Math.PI + ((Math.PI - 2 * t0) * i) / steps;
    ring.push([lens.r * Math.cos(t), lens.cy + lens.r * Math.sin(t)]);
  }
  return ring;
}

/** A ribbon `width` wide along every contour of `shapes` — the lettering grown by half of it,
 *  without the CSG offset a template cannot reach from the main thread. It is what a ball's own
 *  marks are cut back by in Engrave mode (`DesignLayer.minus`): two blacks that touch are one
 *  black, and a soccer ball's pentagon is a solid fill right where the name goes. */
function halo(shapes: Shapes, width: number): Shapes {
  const out: Shapes = [];
  for (const island of shapes) {
    let ring = island[0];
    for (const r of island) if (ring && Math.abs(signedArea(r)) > Math.abs(signedArea(ring))) ring = r;
    if (!ring || ring.length < 3) continue;
    out.push([ring]);
    // `strokeRing` walks an OPEN polyline, so a ring handed over as it is comes back ribboned
    // everywhere except along the segment that closes it. Repeating the first point closes it.
    out.push([strokeRing([...ring, ring[0]!], width)]);
    // A mitred band leaves a wedge open at every corner it turns outward, apex on the corner —
    // exactly where a mark then runs into a letter. A disc at the corner is the round join.
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i + ring.length - 1) % ring.length]!;
      const p = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const turn = Math.abs(Math.atan2(p[1] - a[1], p[0] - a[0]) - Math.atan2(b[1] - p[1], b[0] - p[0]));
      const wrapped = turn > Math.PI ? 2 * Math.PI - turn : turn;
      if (wrapped > 0.14) out.push([circleRing(p[0], p[1], width / 2, 10)]);
    }
  }
  return out;
}

const scaleShapes = (shapes: Shapes, k: number, about: Pt): Shapes =>
  shapes.map((island) => island.map((ring) => ring.map(([x, y]): Pt => [about[0] + k * (x - about[0]), about[1] + k * (y - about[1])])));

/** Every vertex of a set of shapes, strided so a block of tessellated glyphs answers a fit in a
 *  few hundred tests rather than a few thousand. The extremes are always kept: they are the
 *  points a fit is actually decided by. */
function inkPoints(shapes: Shapes, cap = 700): Pt[] {
  const all: Pt[] = [];
  for (const island of shapes) for (const ring of island) for (const p of ring) all.push(p);
  if (all.length <= cap) return all;
  const stride = Math.ceil(all.length / cap);
  const out: Pt[] = [];
  let lo = all[0]!;
  let hi = all[0]!;
  for (let i = 0; i < all.length; i++) {
    if (i % stride === 0) out.push(all[i]!);
    if (all[i]![0] < lo[0]) lo = all[i]!;
    if (all[i]![0] > hi[0]) hi = all[i]!;
  }
  out.push(lo, hi);
  return out;
}

// -------------------------------------------------------------- where the ink meets the ring --

/**
 * The lettering is WELDED into the ring, so the cut is one outline — and without a line at the
 * junction the letters read as lumps of the frame rather than as letters sitting on it. Ian,
 * 2026-09-22: "number is not scored so it welding with the outer frame … name and number merges
 * with the frame outline. Cat ornament have it done well so the name doesnt merge with the frame."
 *
 * The cat's answer (`themed-face-ornament.ts`) is the one copied here: hand the seam layer a patch
 * of the RING as a trailing "glyph", and the engine scores each letter's own outline where that
 * patch covers it (G33 / W3) — the reference's blue at the J's tail and under the 23
 * (`ref/REF-cuttle-basketball-bag-tag.png`).
 *
 * A PATCH, never the whole ring: `seamPaths` sizes "what counts as a dot" off the BIGGEST island
 * it is handed, so the ring itself makes every letter of a five-letter name a crumb beside it and
 * nothing is scored at all.
 */

/** How far inside the ball's own edge a ring patch stops, mm. Under `EDGE`, so a patch covers
 *  every point the ink is allowed to reach, and never lies on the cut line itself. */
const PATCH_EDGE = 1;
/** Two junctions closer than this share one patch, degrees. */
const JOIN_DEG = 10;
/** How far past the ink a patch reaches at each end, degrees — and the air two patches must keep
 *  between them, because a shared radial edge would be scored as if it were a letter's. */
const PATCH_PAD = 3;

/** The lens's own radius at an angle — two discs intersected, in polar form. It is what lets a
 *  patch of a football's ring follow the taper exactly, with no offset pass in the worker. */
const radiusAt = (l: Lens, a: number) =>
  Math.sqrt(Math.max(0, l.r * l.r - (l.cy * Math.cos(a)) ** 2)) - l.cy * Math.abs(Math.sin(a));

/** One patch of ring material: the band between the window and the ball's edge, `a0` to `a1`. */
function bandPatch(outer: Lens, win: Lens, a0: number, a1: number): CutRing {
  const n = Math.max(8, Math.ceil(((a1 - a0) * 180) / Math.PI / 2));
  const at = (l: Lens, a: number): Pt => [radiusAt(l, a) * Math.cos(a), radiusAt(l, a) * Math.sin(a)];
  const ring: CutRing = [];
  for (let i = 0; i <= n; i++) ring.push(at(outer, a0 + ((a1 - a0) * i) / n));
  for (let i = n; i >= 0; i--) ring.push(at(win, a0 + ((a1 - a0) * i) / n));
  return ring;
}

/**
 * The ring's material where this ink runs into it, one patch per junction.
 *
 * The junctions are found rather than assumed: every ink point in the band is taken by angle, the
 * angles cut into runs wherever there is a gap wider than `JOIN_DEG` — the two ends of a name,
 * the feet of a number, an ascender that rises into the ring on its own — and each run padded,
 * widened past the engine's dot rule, and cut as a patch. Measured at the defaults: 4–25° a
 * junction, 39° for the two feet of a "12".
 *
 * `grow` is the hairline of bold the ENGINE adds to this layer after the template has finished.
 * The patch is built that much narrower so it comes out exactly `PATCH_EDGE` inside the ball
 * rather than a hair past it: a patch is material in the hug, and material over the cut line
 * bulges the tag.
 */
function ringPatches(shapes: Shapes, lens: Lens, win: Lens, rim: number, grow: number): Shapes {
  const outer = erode(lens, PATCH_EDGE + grow);
  if (!outer) return [];
  const angles: number[] = [];
  for (const island of shapes) for (const ring of island) for (const p of ring) {
    if (depthIn(lens, p) < rim) angles.push(Math.atan2(p[1], p[0]));
  }
  if (!angles.length) return [];
  angles.sort((a, b) => a - b);
  const join = (JOIN_DEG * Math.PI) / 180;
  const runs: [number, number][] = [[angles[0]!, angles[0]!]];
  for (const a of angles) {
    const last = runs[runs.length - 1]!;
    if (a - last[1] <= join) last[1] = a;
    else runs.push([a, a]);
  }
  // A name's left junction straddles the −x axis, where `atan2` changes sign: the first run and
  // the last are ONE junction when they meet across it, and two patches that shared that seam
  // would each be clipped against the other.
  const wrap = (rs: [number, number][], gap: number) => {
    if (rs.length > 1 && rs[0]![0] + 2 * Math.PI - rs[rs.length - 1]![1] <= gap) {
      rs[rs.length - 1]![1] = rs[0]![1] + 2 * Math.PI;
      rs.shift();
    }
    return rs;
  };
  wrap(runs, join);

  // Every patch is then widened until the engine cannot read it as a crumb. `seamPaths` calls an
  // island a DOT — an i's tittle, a symbol's pip — when its longest side is under 0.4 × the
  // shortest side of the biggest island it was handed, and a dot is neither scored nor scored
  // against: a patch under that bar takes its junction with it, silently. Measured: the 4°
  // junctions of "Noah" in Fredoka at Ø 85 went unscored until this. Widening costs nothing —
  // the band a patch covers is frame either way — so the chord is taken to half the body, which
  // clears the bar with a quarter of it to spare.
  const shortest = (island: CutRing[]) => { const b = bboxOf([island]); return Math.min(b.maxX - b.minX, b.maxY - b.minY); };
  const body = Math.max(rim - PATCH_EDGE, ...shapes.map(shortest));
  const pad = (PATCH_PAD * Math.PI) / 180;
  const spans: [number, number][] = runs.map(([a0, a1]) => {
    const mid = (a0 + a1) / 2;
    const half = Math.max((a1 - a0) / 2 + pad, Math.asin(Math.min(0.5, body / (4 * radiusAt(outer, mid)))));
    return [mid - half, mid + half];
  });
  // …and any two that now touch are one patch: a shared radial edge would be clipped against its
  // neighbour and scored straight across the ring.
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1] + pad) last[1] = Math.max(last[1], s[1]);
    else merged.push(s);
  }
  return wrap(merged, pad).map((r): CutRing[] => [bandPatch(outer, win, r[0], r[1])]);
}

// ------------------------------------------------------------------- how much room there is --

/** What a piece of ink on this tag has to keep clear of. Every clearance carries the layer's own
 *  `grow` (the weld's hairline of bold, which the engine adds after the template has finished),
 *  so a fit measures the ink that will really be cut. */
interface Room {
  lens: Lens;
  grow: number;
  hole: { c: Pt; r: number } | null;
  /** Rectangles already in place on the frame — the number, a football's laces — each grown by
   *  the air this design keeps between two pieces of ink. */
  blocks: { minX: number; minY: number; maxX: number; maxY: number }[];
}

/** Whether a point has `minDepth` of ball around it and clears the hole and the blocks. */
function clearAt(room: Room, p: Pt, minDepth: number): boolean {
  if (depthIn(room.lens, p) < minDepth + room.grow) return false;
  if (room.hole && Math.hypot(p[0] - room.hole.c[0], p[1] - room.hole.c[1]) < room.hole.r + room.grow) return false;
  for (const b of room.blocks) {
    if (p[0] > b.minX - room.grow && p[0] < b.maxX + room.grow && p[1] > b.minY - room.grow && p[1] < b.maxY + room.grow) return false;
  }
  return true;
}

/**
 * The largest scale about `c` at which every one of `pts` still clears everything.
 *
 * Scanned, then bisected — not bisected alone. The ball and the hole are convex constraints and
 * would answer a bisection honestly, but a BLOCK is not: a ray from the name's centre can pass
 * through the number's box and out the far side, and a bisection would sail straight over it and
 * report a fit that lands the descender of a "y" in the middle of a 15.
 */
function roomFor(pts: Pt[], c: Pt, room: Room, minDepth: number, hi = 5): number {
  const okAt = (k: number) => pts.every((p) => clearAt(room, [c[0] + k * (p[0] - c[0]), c[1] + k * (p[1] - c[1])], minDepth));
  if (!okAt(0.02)) return 0;
  const STEPS = 48;
  let lo = 0.02;
  let bad = hi;
  for (let i = 1; i <= STEPS; i++) {
    const k = (hi * i) / STEPS;
    if (okAt(k)) lo = k;
    else { bad = k; break; }
  }
  if (bad >= hi) return hi;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + bad) / 2;
    if (okAt(mid)) lo = mid;
    else bad = mid;
  }
  return lo;
}

/** Whether the ink, scaled by `k` about `c`, runs `bite` mm into the ring on BOTH sides of the
 *  centre — which is what welds a word to the frame in one union rather than at one end. */
function bitesBoth(pts: Pt[], c: Pt, k: number, room: Room, rim: number, bite: number): boolean {
  let left = false;
  let right = false;
  for (const p of pts) {
    const q: Pt = [c[0] + k * (p[0] - c[0]), c[1] + k * (p[1] - c[1])];
    if (depthIn(room.lens, q) - room.grow > rim - bite) continue;
    if (q[0] < c[0]) left = true;
    else right = true;
    if (left && right) return true;
  }
  return false;
}

/** The scale the name is drawn at, and whether it reached the ring.
 *
 *  Three rules in order: grow until the ink bites the ring on both sides (welded — the reference
 *  construction); if the ball runs out first, grow only until the ink has `CLEAR` of window
 *  around it (a separate light piece, glued in the window); and never past what keeps `EDGE` of
 *  material outside the ink. */
function nameScale(pts: Pt[], c: Pt, room: Room, rim: number, bite: number): { k: number; welded: boolean } {
  const kFit = roomFor(pts, c, room, EDGE);
  if (kFit <= 0) return { k: 0, welded: false };
  const STEPS = 40;
  for (let i = 1; i <= STEPS; i++) {
    const k = (kFit * i) / STEPS;
    if (bitesBoth(pts, c, k, room, rim, bite)) return { k, welded: true };
  }
  return { k: roomFor(pts, c, room, rim + CLEAR), welded: false };
}

// ------------------------------------------------------------------------------ the balls --

interface BallSpec {
  id: string;
  /** The `@vostok/laser` blank this ball's outline and marks come from. */
  blank: string;
  name: string;
  blurb: string;
  /** The blank's own marks, on the BACKER, and how they are run. Null for the football, whose
   *  `detail()` draws the LACES rather than a seam — they are placed by hand below. */
  marks: { op: 'engrave' | 'score'; label: string } | null;
  /** A scored panel line inside the window (the football's seam, `REF-cuttle-football-bag-tag`). */
  band: boolean;
  /** The laces, scored at the top of the window (the football). */
  laces: boolean;
  /** The gallery card's own name and number. Never a competitor's example pair. */
  first: [string, string];
  /** The smallest tag this ball still reads at — a shallow ball runs out of window first. */
  minSize: number;
  /** The ops the default build really runs, in job order (G29). */
  ops: string;
}

const BALLS: BallSpec[] = [
  {
    id: 'basketball-tag', blank: 'basketball', name: 'Basketball bag tag',
    blurb: 'A basketball with its seams engraved, the name and number welded into the frame.',
    // Upright: one seam down, one across, an arc either side — what a basketball looks like.
    // (The blank used to swing the set 32° to dodge an inside hole at the north pole; this tag's
    // hole is in the FRAME's rim, and the swing is the blank's own parameter now, default 0.)
    marks: { op: 'engrave', label: 'Seams' }, band: false, laces: false,
    first: ['Elsie', '7'], minSize: 60, ops: 'engrave + score + cut',
  },
  {
    id: 'baseball-tag', blank: 'baseball', name: 'Baseball bag tag',
    blurb: 'A baseball with its stitching engraved, the name and number welded into the frame.',
    marks: { op: 'engrave', label: 'Stitching' }, band: false, laces: false,
    first: ['Noah', '12'], minSize: 60, ops: 'engrave + score + cut',
  },
  {
    id: 'soccer-tag', blank: 'soccer', name: 'Soccer bag tag',
    blurb: 'A soccer ball with its panels engraved, the name and number welded into the frame.',
    marks: { op: 'engrave', label: 'Panels' }, band: false, laces: false,
    first: ['Ava', '10'], minSize: 60, ops: 'engrave + score + cut',
  },
  {
    // The only ball that is not round, so the only one whose frame proves the true offset: at
    // Ø 85 a 7 mm rim takes 7 mm off the height and 8.4 mm off each pointed end.
    id: 'football-tag', blank: 'football', name: 'Football bag tag',
    blurb: 'A football with a scored panel seam, its laces and number welded into the frame.',
    marks: null, band: true, laces: true,
    first: ['Cole', '9'], minSize: 75, ops: 'score + cut',
  },
];

/** How wide the laces are drawn, as a share of the ball's own width — the reference's laces span
 *  48 % of theirs, measured off `REF-cuttle-football-bag-tag.png`. */
const LACE_WIDTH = 0.48;
/** How far inside the window the football's panel line is scored, as a share of the tag's size. */
const BAND_IN = 0.05;
/** How tall the number's INK is drawn, as a share of the window's height — measured as ink and
 *  not as a cap height, because a script's digits are nothing like its capitals (Pacifico's "9"
 *  is 70 % of its cap). The part that runs into the ring is extra, so the number READS this
 *  tall whatever the weld takes. */
const NUMBER_INK = 0.24;
/** How far above the window's centre the name's block may ride, as a share of the window's own
 *  half-height. The reference tags set the name a little high with the number under it. */
const LIFT = 0.10;
/** The biggest tag the slider offers, mm. */
const MAX_SIZE = 140;

// ------------------------------------------------------------------------------- the build --

async function buildTag(spec: BallSpec, v: Values): Promise<BuildInput> {
  const def = blankById(spec.blank)!;
  const D = clamp(num(v, 'size'), spec.minSize, MAX_SIZE);
  const p: BlankParams = {
    ...def.defaults,
    width: D,
    height: (D * def.defaults.height) / def.defaults.width,
    holeSide: 'none',
    pair: false,
  };
  // The blank's own ring, in closed form: every one of these four is drawn as a circle or as
  // `leafRing`, and both are the lens above — which is what lets the frame be cut here instead
  // of by an offset pass in the worker. `blankDetail` still reads the blank, so the marks are
  // the ball's own.
  const lens = lensOf(p.width / 2, p.height / 2);
  const outline: Shapes = [[lensRing(lens, 180)]];
  const raised = str(v, 'lightOp') !== 'engrave';
  const hangs = v.hangHole !== false;
  const dia = clamp(num(v, 'holeDia'), 2, 6);
  const warnings: string[] = [];

  // The frame is as wide as the shared rule says, or as wide as the hanging hole needs —
  // whichever is more, so the hole always has WALL of material on both sides of it. At Ø 85 with
  // a 3 mm hole that is 7 mm, and the rim never eats more than 40 % of the ball's short half.
  const want = Math.max(rimWidthFor(D), hangs ? dia + 2 * WALL : 0);
  const rim = Math.min(want, 0.4 * lens.halfH);
  if (rim < want - 0.01) warnings.push('That hanging hole needs more frame than this tag has — use a smaller hole, or a bigger tag.');
  const win = erode(lens, rim)!;
  const bite = biteFor(rim);
  const gap = gapFor(D);

  // The hole sits on the rim's own centre line at the top of the ball, through BOTH sheets: the
  // ring then bears on 6 mm of glued stack instead of 3, and the two layers cannot shear apart.
  const holeAt: Pt = [0, lens.halfH - rim / 2];
  const keyring: KeyringSpec = hangs
    ? { ...NO_KEYRING, enabled: true, mode: 'inside', dia, ring: (rim - dia) / 2, rest: holeAt }
    : NO_KEYRING;

  const font = str(v, 'font');
  const base = { symbols: readSymbols(v), font, letterSpacing: 0 };
  const room: Room = { lens, grow: 0, hole: hangs ? { c: holeAt, r: dia / 2 + WALL } : null, blocks: [] };

  // ------------------------------------------------------------------------------- the laces --
  // Welded to the ring and hanging into the top of the window, centred, along the ball's long
  // axis — the reference's own arrangement (`REF-cuttle-football-bag-tag.png`). Two things place
  // it, and both are exact rather than chosen:
  //
  //   the TOP edge sits on the window's own top, which is also exactly WALL below the hanging
  //   hole (the rim IS dia + 2 × WALL), so the ladder clears the hole by the same 2 mm of
  //   material as everything else and leaves no sliver of waste between itself and the ring;
  //   the WIDTH is the reference's share of the ball, held to the widest span whose ends still
  //   have EDGE of ball above them — past that the ladder's tips run off the tapering edge.
  //
  // Everywhere but the centre the ball's edge has fallen below that top line, so the ends of the
  // ladder are buried in the ring: it is welded along its whole span, not tacked on at one end.
  const topAt = (x: number) => -lens.cy + Math.sqrt(Math.max(0, lens.r * lens.r - x * x));
  let laces: Shapes = [];
  if (spec.laces) {
    const d = blankDetail(def, p);
    const rings = d.raised?.[0] ?? d.engrave ?? [];
    if (rings.length) {
      const laceTop = Math.min(win.halfH, hangs ? holeAt[1] - dia / 2 - WALL : Infinity);
      let halfMax = 0;
      for (let x = 0.5; x <= lens.halfW; x += 0.5) { if (topAt(x) < laceTop + EDGE) break; halfMax = x; }
      const set = rings.map((r): CutRing[] => [r]);
      const tb = bboxOf(set);
      // Sized by its WIDTH: a ladder scaled to a share of the window's HEIGHT comes out three
      // times as wide as the ring it has to sit on, now that it lies along the long axis.
      const wide = Math.min(LACE_WIDTH * 2 * lens.halfW, 2 * halfMax);
      const scaled = scaleShapes(set, wide / Math.max(1e-6, tb.maxX - tb.minX), [0, 0]);
      const sb = bboxOf(scaled);
      laces = placeShapes(scaled, -(sb.minX + sb.maxX) / 2, laceTop - sb.maxY, 0);
      const lb = bboxOf(laces);
      room.blocks.push({ minX: lb.minX - gap, minY: lb.minY - gap, maxX: lb.maxX + gap, maxY: lb.maxY + gap });
    }
  }

  // Engraved lettering stays inside the window — and inside the football's scored panel line,
  // which is a line the name has no business crossing.
  const inkInset = spec.band ? BAND_IN * D + gap : CLEAR;

  // ------------------------------------------------------------------------------ the number --
  // Raised, the digits' feet run `bite` into the bottom of the ring: that is the whole weld, and
  // it is guaranteed rather than hoped for, because the window's lowest point is directly under
  // them. Engraved, they stay clear inside the window instead.
  const numberText = str(v, 'number').trim();
  const numberFloor = raised ? -win.halfH - bite : -win.halfH + inkInset;
  let number: { layers: DesignLayer[]; box: Box; size: number } | null = null;
  // What the digits READ at: a share of the window's height, plus whatever the weld buries.
  const numberInk = Math.max(MIN_CAP, NUMBER_INK * 2 * win.halfH + (raised ? bite : 0));
  if (numberText) {
    let size = await sizeForCapHeight(font, numberInk * 0.75);
    for (let pass = 0; pass < 3; pass++) {
      const drawn = await textLayer({ ...base, text: numberText, size, connect: connectSpec(font, size), x: 0, y: 0 }, 'off', 'number', 'Number');
      if (!drawn[0]) break;
      const grow = drawn[0].grow ?? 0;
      const bb = bboxOf(drawn[0].shapes);
      const placed = drawn.map((l) => ({ ...l, shapes: placeShapes(l.shapes, -(bb.minX + bb.maxX) / 2, numberFloor + grow - bb.minY, 0) }));
      const ink = placed.flatMap((l) => l.shapes);
      // A digit is not a capital — the size is solved against the ink the face really draws —
      // and then held to what the ball's taper allows at that height.
      const tall = numberInk / Math.max(1e-6, bb.maxY - bb.minY + 2 * grow);
      const k = Math.min(tall, roomFor(inkPoints(ink), [0, numberFloor], { ...room, grow }, EDGE));
      if (k <= 0) break;
      if (Math.abs(k - 1) < 0.02 || pass === 2) {
        const box = bboxOf(ink);
        number = { layers: placed, size, box: { minX: box.minX - grow, minY: box.minY - grow, maxX: box.maxX + grow, maxY: box.maxY + grow } };
        break;
      }
      size = Math.max(1, size * k);
    }
  }
  if (number) {
    const b = number.box;
    room.blocks.push({ minX: b.minX - gap, minY: b.minY - gap, maxX: b.maxX + gap, maxY: b.maxY + gap });
  }

  // -------------------------------------------------------------------------------- the name --
  // The band the name lives in: the window, less what the number has taken off the bottom. It
  // grows about that band's middle until it bites the ring on both sides (welded, the reference
  // construction) or until the ball runs out (its own light piece, glued in the window). Every
  // obstacle is tested per POINT, so a script's ascender may still rise past the laces on either
  // side of them.
  const bandBottom = number ? number.box.maxY + gap : -win.halfH + (raised ? 0 : inkInset);
  // The laces run right across the top of the window, so for the football they ARE the ceiling —
  // the name grows about the middle of what is left under them, which is what lets it stay wide
  // instead of being squeezed against a block it is centred on. Every ball without laces keeps
  // the whole window, its middle capped a little above the window's own centre: on a circle every
  // millimetre the name rides high is a millimetre of reach it loses at BOTH ends, which is the
  // difference between a welded name and a loose one.
  const bandTop = laces.length ? Math.min(win.halfH, bboxOf(laces).minY - gap) : win.halfH;
  const at: Pt = [0, Math.min((bandTop + bandBottom) / 2, LIFT * win.halfH)];
  const draw = (size: number) =>
    textLayer({ ...base, text: str(v, 'name'), size, connect: connectSpec(font, size), x: at[0], y: at[1] }, 'off', 'name', 'Name');

  let name: { layers: DesignLayer[]; size: number; welded: boolean } | null = null;
  if (str(v, 'name').trim() && bandTop > bandBottom + 2) {
    let size = await sizeForCapHeight(font, Math.max(2, 0.55 * (bandTop - bandBottom)));
    let drawn = await draw(size);
    let welded = false;
    for (let pass = 0; pass < 3 && drawn[0]; pass++) {
      const grow = drawn[0].grow ?? 0;
      const pts = inkPoints(drawn[0].shapes);
      const got = raised
        ? nameScale(pts, at, { ...room, grow }, rim, bite)
        : { k: roomFor(pts, at, { ...room, grow }, rim + inkInset), welded: false };
      welded = got.welded;
      if (got.k <= 0) { drawn = []; break; }
      if (Math.abs(got.k - 1) < 0.01) break;
      size = Math.max(1, size * got.k);
      drawn = await draw(size);
    }
    if (drawn[0]) {
      // The verdict is taken off the drawing that is really cut, never off the pass that sized
      // it: a redraw re-runs the weld at the new size and can move the outermost stroke.
      const grow = drawn[0].grow ?? 0;
      const reaches = raised && welded && bitesBoth(inkPoints(drawn[0].shapes), at, 1, { ...room, grow }, rim, 0.6 * bite);
      name = { layers: drawn, size, welded: reaches };
      const cap = (await textMetrics(font, size)).cap;
      if (cap < MIN_CAP) warnings.push('The lettering has shrunk under 3 mm — shorten the name, or make the tag bigger.');
      warnings.push(...countersTooTight(drawn.flatMap((l) => l.shapes)));
    }
  }

  // ------------------------------------------------------------------------------ the pieces --
  // The lettering is MATERIAL on whichever piece carries it and is never lasered itself (G33);
  // the seams are a second copy of the same per-glyph islands, with the RING's own patches last,
  // so what is scored is each letter's edge where a later letter — or the frame it welds into —
  // covers it. A connecting script has no letter-to-letter seam to draw and still runs into the
  // ring, so a patch alone is reason enough to draw the layer.
  const asMaterial = (ls: DesignLayer[]): DesignLayer[] => ls.map((l) => ({ ...l, op: 'off' as const, hugOnly: true }));
  const seamsOf = (ls: DesignLayer[], size: number, patches: Shapes = []): DesignLayer[] => {
    const welds = (connectSpec(font, size).overlap ?? 0) > 0;
    if (str(v, 'letterLines') !== 'score' || (!welds && !patches.length)) return [];
    return ls.map((l) => ({
      ...l,
      id: `${l.id}-seam`, label: 'Letter seams', op: 'score' as const, seams: true,
      shapes: [...l.shapes, ...patches],
      // The per-glyph tally has to grow with the islands appended after the letters, or the
      // engine sees a tally out of step with the islands it names and falls back to one island =
      // one glyph — scoring a stroke-built letter against its own strokes (W3). Each patch is
      // its own "glyph", and they come last, so every letter is read against them.
      //
      // A face that writes as one connected line has no junction of ITS own to draw: the type
      // designer drew it (G33), and the reference tag's script carries blue only where it meets
      // the ring. So the whole word is handed over as ONE glyph — the engine unions its islands
      // and probes that outline — and the only later shapes are the patches.
      glyphIslands: welds
        ? [...(l.glyphIslands ?? l.shapes.map(() => 1)), ...patches.map(() => 1)]
        : [l.shapes.length, ...patches.map(() => 1)],
    }));
  };
  /** The ring patches for a drawn word, from the layer the engine will really cut. */
  const ringOf = (ls: DesignLayer[]): Shapes =>
    ringPatches(ls.flatMap((l) => l.shapes), lens, win, rim, ls[0]?.grow ?? 0);
  const closed = (ring: CutRing): Pt[] => [...ring, ring[0]!];

  const frameLayers: DesignLayer[] = [
    { id: 'frame', label: 'Frame', shapes: [[lensRing(lens, 180), [...lensRing(win, 180)].reverse()]], op: 'off', hugOnly: true },
  ];
  if (laces.length) frameLayers.push({ id: 'laces', label: 'Laces', shapes: laces, op: 'off', hugOnly: true });
  if (raised && number) frameLayers.push(...asMaterial(number.layers), ...seamsOf(number.layers, number.size, ringOf(number.layers)));
  if (raised && name?.welded) {
    frameLayers.push(...asMaterial(name.layers), ...seamsOf(name.layers, name.size, ringOf(name.layers)));
  }

  const backerLayers: DesignLayer[] = [];
  const burn: Shapes = raised ? [] : [...(name?.layers ?? []), ...(number?.layers ?? [])].flatMap((l) => l.shapes);
  if (spec.marks) {
    const d = blankDetail(def, p);
    const rings = spec.marks.op === 'score' ? (d.score?.length ? d.score : d.engrave ?? []) : (d.engrave?.length ? d.engrave : d.score ?? []);
    if (rings.length) {
      backerLayers.push({
        id: 'marks', label: spec.marks.label, kind: 'detail', op: spec.marks.op,
        shapes: rings.map((r): CutRing[] => [r]),
        // Two blacks that touch are one black: engraved lettering has the ball's own marks cut
        // back around it, or a soccer ball's pentagon swallows the name whole.
        ...(burn.length ? { minus: halo(burn, clamp(0.025 * D, 1.2, 2.4)) } : {}),
      });
    }
  }
  if (spec.band) {
    // The panel seam of `REF-cuttle-football-bag-tag.png`: ONE scored line inside the window,
    // as open runs rather than a ribbon, so the laser draws it in a single pass.
    const inner = erode(lens, rim + BAND_IN * D);
    if (inner) backerLayers.push({ id: 'band', label: 'Panel line', kind: 'detail', op: 'score', shapes: [], paths: [closed(lensRing(inner, 160))] });
  }
  if (!raised && name) backerLayers.push(...name.layers.map((l) => ({ ...l, op: 'engrave' as const })));
  if (!raised && number) backerLayers.push(...number.layers.map((l) => ({ ...l, op: 'engrave' as const })));
  if (raised && str(v, 'glue') !== 'none') {
    // Where the frame's inner edge lands, a hair OUTSIDE it so the line disappears under the
    // ring once the frame is glued on — and the name's own outline when it is a loose piece.
    const edge = erode(lens, Math.max(0.5, rim - GUIDE_INSET));
    if (edge) backerLayers.push({ id: 'glue', label: 'Glue guide', kind: 'guide', op: 'score', shapes: [], paths: [closed(lensRing(edge, 180))] });
    if (name && !name.welded) {
      backerLayers.push(...name.layers.map((l) => ({
        ...l, id: `${l.id}-guide`, label: 'Glue guide', kind: 'guide' as const, op: 'score' as const,
        grow: (l.grow ?? 0) - GUIDE_INSET,
      })));
    }
  }

  const parts: PartInput[] = [{
    id: 'backer',
    label: 'Ball · dark sheet',
    blank: { kind: 'shape', shapes: outline },
    layers: backerLayers,
    // The same silhouette about the same origin and the SAME hole at the same local point, so
    // the glue-up is the build frame again and the two sheets register (00-context §4.2).
    keyring: hangs ? 'shared' : 'none',
    assembledAt: 'built',
    material: 'dark',
  }];
  if (raised && name && !name.welded) {
    parts.push({
      id: 'name',
      label: 'Name · light sheet',
      // G33: the piece IS the letters. Margin 0, no smoothing pass, counters open so the ball
      // shows through the bowl of an "o".
      blank: { kind: 'hug', margin: 0, smoothing: 0, counters: 'open', bridge: bridgeFor(name.size), minHole: MIN_COUNTER },
      layers: [...asMaterial(name.layers), ...seamsOf(name.layers, name.size)],
      keyring: 'none',
      assembledAt: { x: at[0], y: at[1] },
      material: 'light',
    });
  }

  return {
    label: 'Frame · light sheet',
    material: 'light',
    // Margin 0 and no smoothing: the piece is the ring and whatever ink reaches it, unioned and
    // nothing else (G33). `bridges: 'dots'` joins an i's tittle and NOTHING ELSE — a name that
    // could not reach the ring is its own piece, never a bar thrown across the window.
    blank: { kind: 'hug', margin: 0, smoothing: 0, counters: 'open', bridges: 'dots', bridge: bridgeFor(name?.size ?? 0.2 * D), minHole: MIN_COUNTER },
    keyring,
    layers: frameLayers,
    parts,
    layout: { flow: 'row', gap: 6 },
    status: `${parts.length + 1} pieces · dark ball, light frame${parts.length > 1 ? ' and name' : ''}`,
    ...(warnings.length ? { warnings } : {}),
  };
}

// -------------------------------------------------------------------------------- the form --

function tagFields(spec: BallSpec): Field[] {
  return [
    // ---------------------------------------------------------- RIGHT: what you type --
    {
      kind: 'text', key: 'name', label: 'Name', panel: 'right', section: 'Text',
      value: spec.first[0], placeholder: 'A name', maxLength: 16, symbols: true,
    },
    {
      kind: 'text', key: 'number', label: 'Number', panel: 'right', section: 'Text',
      value: spec.first[1], placeholder: '9', maxLength: 3, symbols: false,
      help: 'Up to three digits; it welds to the frame’s bottom.',
    },
    // The font field always lands on the left as its own category, whatever `panel` says.
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'pacifico', recommended: TAG_FACES },

    // -------------------------------------------------------- LEFT: "Tag" (opens first) --
    // One knob, and it is the product's: how big the tag is. The frame, the window, the hole,
    // the number's size and the name's all follow from it.
    {
      kind: 'number', key: 'size', label: 'Size', section: 'Tag',
      value: 85, min: spec.minSize, max: MAX_SIZE, step: 1, unit: 'mm',
      help: '75–90 mm is the usual bag-tag size.',
    },
    ...lightPieceFields('Tag', 'raised', { help: 'Raised welds the lettering into the frame; Engrave burns it on.' }),

    // --------------------------------------------------------------- LEFT: "More options" --
    // Always on the page, whatever the face: the seams a script has none of are the ones between
    // its letters, and it still runs into the ring, which is the junction this control draws.
    more({ ...letterScoreField('Lettering'), help: 'Scores where the lettering meets the frame, and itself.' }),
    ...hangHoleFields('Hanging', { dia: 3, maxDia: 6 }).map(more),
  ];
}

const sportsTag = (spec: BallSpec): TemplateDef => ({
  id: spec.id,
  name: spec.name,
  blurb: spec.blurb,
  tags: ['tag', spec.ops],
  batch: { key: 'name', noun: 'tag' },
  fields: tagFields(spec),
  build: (v) => buildTag(spec, v),
  // A function, not a string (G27): there is nothing to glue when the lettering is engraved.
  exportNote: (v) =>
    str(v, 'lightOp') === 'engrave'
      ? 'Cut the ball from dark wood and the frame from light — nothing to glue.'
      : 'Cut the ball from dark wood and the light pieces from another sheet, then glue them on.',
  fileName: (v) => stem(str(v, 'name') || 'tag', str(v, 'number'), spec.blank),
});

export const basketballTag = sportsTag(BALLS[0]!);
export const baseballTag = sportsTag(BALLS[1]!);
export const soccerTag = sportsTag(BALLS[2]!);
export const footballTag = sportsTag(BALLS[3]!);
