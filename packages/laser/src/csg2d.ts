// Worker-side 2D CSG on manifold-3d's CrossSection. Nothing here touches the DOM.
//
// The bridge between our ring contract (islands of rings, any winding) and manifold's
// (outer CCW positive, holes CW negative, one flat list) lives in `toCS` / `fromCS`, and
// nothing else in the app needs to know manifold's conventions.
import type { CutRing } from '@vostok/export';
import { signedArea, circleRing, simplifyRing } from './rings';
import type { Keyring } from './types';
import type { KeychainParams } from './types';

/** Anything manifold hands out that has to be freed — the WASM heap only grows. */
export type Keep = <M extends { delete(): void }>(m: M) => M;

export function withScope<T>(fn: (keep: Keep) => T): T {
  const created: { delete(): void }[] = [];
  const keep: Keep = (m) => {
    created.push(m);
    return m;
  };
  try {
    return fn(keep);
  } finally {
    for (const m of created) {
      try {
        m.delete();
      } catch {
        /* already freed */
      }
    }
  }
}

/** Islands → one CrossSection. The largest ring of an island is its outer, made CCW; the
 *  rest are holes, made CW; the Positive rule then fills exactly the material. */
export function toCS(wasm: any, shapes: CutRing[][], keep: Keep): any {
  const rings: number[][][] = [];
  for (const island of shapes) {
    const live = island.filter((r) => r.length >= 3);
    if (live.length === 0) continue;
    const areas = live.map(signedArea);
    let outer = 0;
    for (let i = 1; i < live.length; i++) if (Math.abs(areas[i]!) > Math.abs(areas[outer]!)) outer = i;
    live.forEach((r, i) => {
      const ccw = areas[i]! > 0;
      const wantCcw = i === outer;
      rings.push(ccw === wantCcw ? (r as number[][]) : ([...r].reverse() as number[][]));
    });
  }
  if (rings.length === 0) return keep(wasm.CrossSection.circle(0.01, 3));
  return keep(new wasm.CrossSection(rings, 'Positive'));
}

/** CrossSection → islands, one per connected component, counters kept as holes. */
export function fromCS(cs: any, keep: Keep): CutRing[][] {
  return (cs.decompose() as any[])
    .map((c) => keep(c))
    .filter((c) => c.area() > 0.01)
    .map((c) => c.toPolygons() as CutRing[]);
}

export function offsetShapes(wasm: any, shapes: CutRing[][], delta: number): CutRing[][] {
  return withScope((keep) => {
    const cs = toCS(wasm, shapes, keep);
    // Round joins with enough circular segments that a keyring halo's curve doesn't facet.
    /*
      No `circularSegments` argument. Manifold's default (0) means "ask the quality settings,
      which know the radius" — `setMinCircularEdgeLength` / `setMinCircularAngle`, set once when
      the worker starts. A hardcoded 32 was overriding that with a fixed count, which is fine on
      a 3 mm fillet and visibly polygonal on a 20 mm one: the same 32 chords have to cover a
      circumference six times longer. `simplify` afterwards because the close operation offsets
      twice in a row, and Manifold's own docs ask for it between chained offsets.
    */
    const out = keep(cs.offset(delta, 'Round', 2.0).simplify(1e-3));
    return fromCS(out, keep);
  });
}

export function unionShapes(wasm: any, shapes: CutRing[][]): CutRing[][] {
  return withScope((keep) => fromCS(toCS(wasm, shapes, keep), keep));
}

export function subtractShapes(wasm: any, a: CutRing[][], b: CutRing[][]): CutRing[][] {
  return withScope((keep) => {
    const out = keep(toCS(wasm, a, keep).subtract(toCS(wasm, b, keep)));
    return fromCS(out, keep);
  });
}

/** Keep only the outer loops, so a plate hugging two words does not trap a hole between them. */
function fillHoles(wasm: any, cs: any, keep: Keep): any {
  const polys = cs.toPolygons() as number[][][];
  const outers = polys.filter((p) => signedArea(p as CutRing) > 0);
  if (outers.length === 0 || outers.length === polys.length) return cs;
  return keep(new wasm.CrossSection(outers, 'Positive'));
}

function bbox(contours: number[][][]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of contours) {
    for (const p of poly) {
      const x = p[0]!;
      const y = p[1]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/**
 * The flat keychain: a plate around the letters with a keyring lug, and the letters themselves.
 *
 * A slimmed-down relative of name-keychain's `buildProfiles` — same operations (offset,
 * hull, union, subtract), same conventions (round joins, holes filled, lug fused by a hull
 * tab). The plan (PRD §8) is to lift that builder into a shared package and delete this one,
 * so the two products cannot drift; until then this is deliberately the minimal shape.
 */
export function buildKeychainProfile(wasm: any, textContours: number[][][], p: KeychainParams) {
  return withScope((keep) => {
    const { CrossSection } = wasm;
    const hasText = textContours.some((c) => c.length >= 3);
    const glyphs = hasText ? keep(new CrossSection(textContours, 'NonZero')) : keep(CrossSection.circle(0.01, 3));
    const box = bbox(textContours);
    const w = Math.max(box.maxX - box.minX, 0.1);
    const h = Math.max(box.maxY - box.minY, 0.1);
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;

    const margin = p.outlineWidth;
    const lugOuter = p.holeDia / 2 + p.ringThickness;
    const lugPre = Math.max(lugOuter - margin, 0.6);

    // Plate source: the letters (fused by a strip so a word is one piece) or a box.
    let src: any;
    if (p.plateShape === 'rectangle') {
      src = keep(CrossSection.square([w, h], true).translate([cx, cy]));
    } else {
      const strip = keep(CrossSection.square([w, Math.max(h * 0.35, 0.5)], true).translate([cx, cy]));
      src = keep(glyphs.add(strip));
    }

    let hole: any = null;
    if (p.holeSide !== 'none') {
      const left = p.holeSide === 'left';
      const hx = left ? box.minX - (lugOuter + 1.5) : cx;
      const hy = left ? cy : box.maxY + lugOuter + 1.5;
      const neck = Math.max(lugOuter * 2.2, 8);
      const ax = left ? hx + neck : hx;
      const ay = left ? hy : hy - neck;
      const lug = keep(CrossSection.circle(lugPre, 32).translate([hx, hy]));
      const anchor = keep(CrossSection.circle(Math.min(lugPre * 0.85, 2), 16).translate([ax, ay]));
      const tab = keep(CrossSection.hull([lug, anchor]));
      src = keep(src.add(tab));
      hole = keep(CrossSection.circle(p.holeDia / 2, 48).translate([hx, hy]));
    }

    const smooth = Math.max(0, p.smoothing);
    let plate = keep(src.offset(margin + smooth, 'Round', 2.0, 24));
    if (smooth > 0.05) plate = keep(plate.offset(-smooth, 'Round', 2.0, 24));
    plate = fillHoles(wasm, plate, keep);
    if (hole) plate = keep(plate.subtract(hole));

    const text = hole ? keep(glyphs.subtract(hole)) : glyphs;
    return { plate: fromCS(plate, keep), text: hasText ? fromCS(text, keep) : [] };
  });
}

export function intersectShapes(wasm: any, a: CutRing[][], b: CutRing[][]): CutRing[][] {
  return withScope((keep) => {
    const out = keep(toCS(wasm, a, keep).intersect(toCS(wasm, b, keep)));
    return fromCS(out, keep);
  });
}

/** A close (grow then shrink): every concavity narrower than 2 × r is filled, everything else
 *  comes back as it was. Manifold asks for a simplify between chained offsets; `offsetShapes`
 *  already does one per call. */
function closeShapes(wasm: any, shapes: CutRing[][], r: number): CutRing[][] {
  return offsetShapes(wasm, offsetShapes(wasm, shapes, r), -r);
}

/** A ring's area and perimeter — enough to tell a fillet from a tessellation sliver. */
function ringMetrics(ring: CutRing): { area: number; perimeter: number } {
  let perimeter = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    perimeter += Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
  }
  return { area: Math.abs(signedArea(ring)), perimeter };
}

type Rect = { minX: number; minY: number; maxX: number; maxY: number };

function ringBox(ring: CutRing): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p[0]! < minX) minX = p[0]!;
    if (p[0]! > maxX) maxX = p[0]!;
    if (p[1]! < minY) minY = p[1]!;
    if (p[1]! > maxY) maxY = p[1]!;
  }
  return { minX, minY, maxX, maxY };
}

const overlaps = (a: Rect, b: Rect, pad = 0) =>
  a.maxX + pad >= b.minX && b.maxX + pad >= a.minX && a.maxY + pad >= b.minY && b.maxY + pad >= a.minY;

const grown = (b: Rect, by: number): Rect => ({ minX: b.minX - by, minY: b.minY - by, maxX: b.maxX + by, maxY: b.maxY + by });

/** An island's rings split into its outer (the largest) and its holes. `toPolygons` hands the
 *  rings back in no particular order, so the outer is found by area, exactly as `toCS` does — a
 *  hole treated as the outer would leave the piece's real edge looking like a hole to drop. */
function splitRings(island: CutRing[]): { outer: CutRing; holes: CutRing[] } {
  let at = 0;
  for (let i = 1; i < island.length; i++) if (Math.abs(signedArea(island[i]!)) > Math.abs(signedArea(island[at]!))) at = i;
  return { outer: island[at] ?? [], holes: island.filter((_, i) => i !== at) };
}

/**
 * Drop any hole the weld TRAPPED — a pocket of air the lug sealed off that the design never had.
 *
 * Welding a lug across the mouth of a design's notch (a bone's V at the end of a lobe) leaves the
 * rest of that notch enclosed: a hole in the middle of the part that nobody drew, that nothing
 * can pass through, and that drops a loose offcut on the bed.
 *
 * Two things have to be true before a hole is dropped, because dropping a real one — a frame's
 * window, an O's counter — would weld the design shut, which is the very bug this file is fixing.
 * It must overlap NO hole the design drew, and it must lie against the lug and its neck (`near`),
 * which is the only place this function can have made one.
 */
function dropTrappedHoles(result: CutRing[][], design: CutRing[][], near: Rect): CutRing[][] {
  if (!result.some((island) => island.length > 1)) return result;
  const designHoles = design.flatMap((island) => splitRings(island).holes).map(ringBox);
  return result.map((island) => {
    const { outer, holes } = splitRings(island);
    return [outer, ...holes.filter((h) => {
      const b = ringBox(h);
      const trapped = !designHoles.some((d) => overlaps(d, b)) && overlaps(near, b);
      return !trapped;
    })];
  });
}

/**
 * Bake a keyring into a shape: a lug welded on and filleted (outside), then the hole cut.
 * The placement is `holeCentre` from `keyring.ts`; this is the CSG half, synchronous so it
 * runs inside one worker call alongside everything else the part needs.
 *
 * `neck` is the bar that reaches back to the body when the lug has floated clear of it. It is
 * passed in rather than built here because only the caller knows where the lug's anchor on the
 * body is — and it has to arrive SEPARATELY from `shapes`, because `shapes` is the design and
 * the fillet below is defined against it.
 */
export function applyKeyring(
  wasm: any,
  shapes: CutRing[][],
  centre: [number, number],
  k: Keyring,
  opts: { neck?: CutRing[][] } = {},
): CutRing[][] {
  const hole = [[circleRing(centre[0], centre[1], k.dia / 2, 48)]];
  let body = shapes;
  if (k.mode === 'outside') {
    const lug = [[circleRing(centre[0], centre[1], k.dia / 2 + k.ring, 64)]];
    const attach = [...lug, ...(opts.neck ?? [])];
    body = unionShapes(wasm, [...shapes, ...attach]);
    /*
      The fillet is the material the close adds BECAUSE THE LUG IS THERE — never what it would
      have done to the design on its own.

      A close (grow, shrink) rounds the notch where the lug and its neck meet the outline, which
      is the whole point. But a close fills EVERY concavity narrower than twice the ring, and the
      design's own concavities are not the lug's business: a bone's two lobes meet in a cusp, a
      shaft meets a lobe in a notch, an "N" has two. Closing the plate welds those shut, and
      that is Ian's "random shape artifact" — a disc and a straight-edged fill bridging the
      notch between a pet tag's lobes whenever the loop was dragged near them.

      Clipping the close to a disc around the lug (what this used to do) does not help: the disc
      is dia/2 + 3·ring across — 11.5 mm on the shipped pet tag — so the notch the loop was
      dragged next to was inside it every time.

      So: close the design WITH the lug, close the design WITHOUT it, and keep only the
      difference. A concavity the design already had is filled in both and cancels; the junction
      the lug just made exists in one only. Nothing the design drew can change, wherever the loop
      lands.

      It is done TWICE, at two radii, because the weld has two jobs.

      At `ring` it ROUNDS: the notch where the lug or its neck meets the outline becomes a flare,
      and the tab reads as grown on rather than glued on.

      At half the minimum web it DEBURRS: wherever the lug has narrowed the design's own air to
      less than a millimetre — a lug that grazes the next lobe, a neck that pinches the mouth of a
      notch down to a hair — that air closes. A 0.3 mm slit is not a feature; it is a line the
      laser burns through and the customer sees as a scratch. It has to be a second pass and not
      just a wider first one: at `ring` the close would ALSO bridge anything within 2·ring, which
      is how a 3 mm slot beside the loop lost its mouth.
    */
    const weldAt = (r: number): CutRing[][] => {
      const added = subtractShapes(wasm, closeShapes(wasm, body, r), closeShapes(wasm, shapes, r));
      // The two closes are separate offset round trips, so their outlines can disagree by a
      // tessellation hair along edges neither of them filled. The offsets simplify at 1e-3, so a
      // hair is about that thick; the deburr pass's own answer — the sliver of air it just
      // closed — is also long and thin, 0.01 mm of mean thickness over 50 mm of wedge. So the
      // threshold sits just above the hair and nowhere near the sliver. A hair that slips through
      // costs nothing anyway: it is unioned back onto the edge it came from and `simplifyRing`
      // takes it off again.
      return added.filter((island) => {
        const m = ringMetrics(splitRings(island).outer);
        return m.area > 0.002 && m.perimeter > 0 && (2 * m.area) / m.perimeter > 0.002;
      });
    };
    const DEBURR = 0.5;
    // Where a trapped pocket can be: against the lug and its neck, and no further than the fillet
    // could have reached.
    const near = grown(attach.map((isl) => ringBox(isl[0] ?? [])).reduce((a, b) => ({
      minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
    })), 2 * k.ring);
    /*
      The lug lands where the customer dropped it, and sometimes that is in the mouth of one of
      the design's own notches. Then the notch behind it is sealed, and a sealed notch is not a
      hole the part wants — it is an offcut that falls out on the bed. `dropTrappedHoles` fills
      those, and only those: a pocket against the lug that overlaps nothing the design drew.

      The alternative — refusing to seal, so the notch stays open past the lug — was tried and is
      worse: what is left is a 0.5 mm slit running out of the notch, which no laser can cut and
      which reads as a scratch across the part.
    */
    const welds = [...weldAt(k.ring), ...(k.ring > DEBURR ? weldAt(DEBURR) : [])];
    body = dropTrappedHoles(welds.length ? unionShapes(wasm, [...body, ...welds]) : body, shapes, near);
  }
  const out = subtractShapes(wasm, body, hole);
  /*
    0.01 mm, not the 0.05 this used to use. The tolerance is a chord error, so on a 12 mm
    fillet 0.05 mm let the simplifier merge segments until they turned ~10° each — it undid
    the tessellation the offset had just been asked for, and the plate came back visibly
    polygonal. Manifold's own `simplify` inside `offsetShapes` already drops the spurious
    slivers; what is left here is only to keep a ring from carrying duplicate points.
  */
  return out.map((isl) => isl.map((r) => simplifyRing(r, 0.01)).filter((r) => r.length >= 3 && Math.abs(signedArea(r)) > 1e-6));
}
