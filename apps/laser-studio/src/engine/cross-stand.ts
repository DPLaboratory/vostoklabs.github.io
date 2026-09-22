// The crossing-pieces stand: two IDENTICAL planks that slot into each other at a right angle and
// hold a phone in the V between them. The facility a phone stand, a QR stand or a card holder is
// cut from — the caller brings the size and what goes on the front piece, and everything that
// decides whether the thing STANDS lives here.
//
// Reference: `docs/briefs/laser-studio-feedback-2026-09-21-templates/ref/REF-phone-stand-cross-pieces-80x130.png`
// — Ian's "here is even better explanation": two planks crossing, the phone leaning in the V,
// 80 mm across and 130 mm tall. The old geometry (an upright plate dropped into a slotted base,
// `engine/stands.ts`'s `slotBase`) is the "geometry is just completely wrong" he photographed.
//
// ------------------------------------------------------------------------ the geometry --
//
// Two flat pieces can only cross cleanly on ONE line: where their planes meet. Both slots are cut
// along that line, so the line — call it ℓ — is the piece's WIDTH direction, and each plank's
// length is perpendicular to ℓ inside its own plane. Perpendicular planes then put the two
// LENGTHS at 90° to each other for free: that is the "crossing at 90°" of the reference, and it
// is why a lengthwise slot could never make this joint.
//
// Work in the stand's cross section: y runs front(−)/back(+), z is up, the table is z = 0, ℓ is
// the x axis (left–right) and the crossing is at (0, 0, zc).
//
//   `lean` (θ) is the BACK piece's angle from the table — the angle a phone leaning on it takes.
//   u_back  = (0,  cos θ,  sin θ)   up and back: the rest, the long arm
//   u_front = (0, −sin θ,  cos θ)   up and front, at 90° to it: the lip, the short arm
//
// Each piece has a long arm and a short arm either side of its slot. The back piece stands on its
// SHORT arm (down-front) and reaches the top on its long one; the front piece stands on its LONG
// arm (down-back) and its short arm is the lip the phone's bottom edge sits on. Both pieces are
// the same part — the front one is drawn turned about, which is how it goes into the stand.
//
// THE THREE EQUATIONS. The two feet end square, so each one touches the table along the 80 mm
// line of its lower face corner, and the top is the back piece's upper corner. Writing `a` for
// the short arm, `b` for the long arm and asking for both feet on the table and the top at
// `height`:
//
//        a·sin θ + (t/2)·cos θ = zc          (the front foot, on the table)
//        b·cos θ + (t/2)·sin θ = zc          (the back foot, on the table)
//        zc + b·sin θ + (t/2)·cos θ = height (the top)
//
//   ⇒    zc = [height + (t/2)(sin θ·tan θ − cos θ)] / (1 + tan θ)
//
// Two line contacts 80 mm long and ~104 mm apart, not four points: the stand cannot rock.
//
// WHY IT HOLDS A PHONE. The phone lies on the back piece's front face and its bottom edge sits in
// the V, so its centre of mass is half its length up that face and half its thickness off it. At
// the default (80 × 130, t = 3, θ = 67°) the feet are at y = −15.2 (front) and y = +89.3 (back),
// and a 6.5-inch phone (160 × 75 × 8 mm, 170 g) puts its centre of mass at y = +26.8, z = 116.7 —
// 42 mm inside the front foot and 63 mm inside the back one. The stand's own 30-ish grams sit
// between the feet too, so they only help. `metrics.phone` carries those numbers and
// `cross-stand.test.mjs` re-derives them.
//
// ---------------------------------------------------------------------------- the API --
//
//   const g = crossStandGeometry({ width, height, t, kerf, lean });  // rings, poses, numbers
//   ...build your layers inside `g.content` (the front piece) or `g.backContent`...
//   const { blank, layers, pose, parts, status } = crossStandPieces(g, { front, back });
//
// Two calls because the content box has to exist before a caller can fit type or a QR into it.
// Nothing here touches manifold: every ring is closed-form, so a node test can hold the whole
// construction to the equations above.
import type { Box, Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { slotRing, slotWidth } from './slots';
import type { Blank, DesignLayer, PartInput, Pose } from './types';

type Pt = [number, number];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const rad = (deg: number) => (deg * Math.PI) / 180;
const turn = (ring: CutRing): CutRing => ring.map(([x, y]) => [-x, -y]);

/** How wide the plank's two ends are, as a share of its width at the crossing. Tapered because
 *  the crossing is where the bending moment peaks and where half the width is slot; and tapered
 *  by DIFFERENT amounts because the two ends do different work. The short arm's end is the front
 *  foot on one piece and the lip that carries the engraving on the other, so it stays broad; the
 *  long arm's end is the top of the stand and the back foot, and it can run slender. Neither ever
 *  goes narrow enough to make the stand easy to knock sideways: at the default they are 60 mm and
 *  34 mm across, so a sideways tip needs 14° and 8° respectively. */
const TIP_SHORT = 0.75;
const TIP_LONG = 0.42;
/** The taper's curve, `1 − u^TAPER_P`. Above 1 the sides leave the crossing flat, so the widest
 *  point is a soft crown rather than a corner; near 1 they run almost straight, which is what
 *  makes the piece read as a plank instead of an urn. */
const TAPER_P = 1.35;
/** Air between the two pieces on the sheet, mm. */
const SHEET_GAP = 8;
/** No mark sits closer than this to a cut edge, mm — the house inset. */
const EDGE = 4;
/** Air between the slot and anything engraved on the same arm, mm. */
const SLOT_WEB = 5;

const ODD_WIDTH = 'The slot comes out an odd width — check the thickness and the kerf.';

// ------------------------------------------------------------------ rounding a corner --

/** The arc that replaces vertex `p` between `a` and `b`, tangent to both edges, radius `r`.
 *  Falls back to the bare vertex where the corner is too tight for the radius asked for. */
function corner(a: Pt, p: Pt, b: Pt, r: number, segs = 8): Pt[] {
  if (r <= 0) return [p];
  const u: Pt = [a[0] - p[0], a[1] - p[1]];
  const v: Pt = [b[0] - p[0], b[1] - p[1]];
  const lu = Math.hypot(u[0], u[1]);
  const lv = Math.hypot(v[0], v[1]);
  if (lu < 1e-9 || lv < 1e-9) return [p];
  const un: Pt = [u[0] / lu, u[1] / lu];
  const vn: Pt = [v[0] / lv, v[1] / lv];
  const cosA = clamp(un[0] * vn[0] + un[1] * vn[1], -1, 1);
  const half = Math.acos(cosA) / 2;
  if (half < 1e-4 || half > Math.PI / 2 - 1e-4) return [p];
  // Cut back the same distance along both edges, never past half of either one.
  const d = Math.min(r / Math.tan(half), 0.45 * lu, 0.45 * lv);
  const rr = d * Math.tan(half);
  const bis: Pt = [un[0] + vn[0], un[1] + vn[1]];
  const lb = Math.hypot(bis[0], bis[1]);
  if (lb < 1e-9) return [p];
  const c: Pt = [p[0] + (bis[0] / lb) * (rr / Math.sin(half)), p[1] + (bis[1] / lb) * (rr / Math.sin(half))];
  const s: Pt = [p[0] + un[0] * d, p[1] + un[1] * d];
  const e: Pt = [p[0] + vn[0] * d, p[1] + vn[1] * d];
  const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
  let a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
  while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
  while (a1 - a0 < -Math.PI) a1 += 2 * Math.PI;
  const out: Pt[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = a0 + ((a1 - a0) * i) / segs;
    out.push([c[0] + rr * Math.cos(t), c[1] + rr * Math.sin(t)]);
  }
  return out;
}

/** Round every vertex of a closed polygon, each by its own radius. */
const fillet = (pts: Pt[], radii: number[]): CutRing =>
  pts.flatMap((p, i) => corner(pts[(i + pts.length - 1) % pts.length]!, p, pts[(i + 1) % pts.length]!, radii[i] ?? 0));

// ------------------------------------------------------------------ the numbers --

export interface CrossStandInput {
  /** Across the stand — the plank's width at the crossing, and the width of the V a phone sits
   *  in. The reference's 80 mm: a 6.5-inch phone is 75 mm wide. */
  width: number;
  /** How tall the assembled stand is, table to the back piece's top corner. */
  height: number;
  t: number;
  kerf: number;
  /** Degrees from the TABLE: the angle the phone leans at. 65–70 is the touchscreen range. */
  lean?: number;
  clearance?: number;
  /** The radius on the planks' four ends, mm. */
  corner?: number;
  /** How deep the front piece's shelf has to be for what leans on it (a phone with a case is
   *  about 10 mm), mm. The facility only warns on it — the arm's length is fixed by the joint. */
  lip?: number;
}

/** Every number the construction is proved on — the test reads these and re-derives them. */
export interface CrossStandMetrics {
  /** Degrees from the table. */
  lean: number;
  /** The stand, table to the top corner, and across. */
  height: number;
  width: number;
  /** How high the two planks cross, on their mid-planes, mm. */
  crossHeight: number;
  /** The two arms either side of the slot, tip to slot centre, mm. */
  shortArm: number;
  longArm: number;
  /** The plank, tip to tip — longer than the stand is tall, because it leans. */
  length: number;
  /** The plank's width at its two ends: the short arm's (the lip and the front foot) and the long
   *  arm's (the top of the stand and the back foot). */
  tip: { short: number; long: number };
  /** Where the two feet touch the table, as the world's y (front is negative), and the depth
   *  between them — the footprint everything has to stand inside. */
  foot: { front: number; back: number; depth: number };
  /** As drawn: `width` across the mating thickness, `depth` into the piece. The pair sums to the
   *  plank's width at the crossing, so the two pieces' side edges finish flush. */
  slot: { width: number; depth: number };
  /** Where the V's inner corner sits — the point a phone's bottom edge rests in. */
  crotch: { y: number; z: number };
  /** A 6.5-inch phone leaning on the V, and how far inside the feet its weight lands. */
  phone: { length: number; thickness: number; mass: number; com: { y: number; z: number }; marginFront: number; marginBack: number };
}

export interface CrossStandGeometry {
  width: number;
  height: number;
  t: number;
  /** The part, centred on its own box: x across (the slot's line), y along its length, the long
   *  arm up. The BACK piece is cut from this ring. */
  backPlank: CutRing;
  /** The same part, drawn turned about — which is how it goes into the stand: its short arm (the
   *  lip) then points up-front and its engraved face looks down-front, at the customer. Turning a
   *  piece in its own plane is free; flipping it over would put the engraving on the back. */
  frontPlank: CutRing;
  /** The back piece's slot, opening on the left edge. Give it to an `op: 'cut'` layer. */
  backSlot: Shapes;
  /** The front piece's: the same slot on the turned-about piece, so it opens on the right. */
  frontSlot: Shapes;
  /** The clear rectangle on the FRONT piece — its lip, above the slot, the one face a phone
   *  does not cover and the customer looks straight at. */
  content: Box;
  /** The clear rectangle on the BACK piece, above the crossing: the whole face a phone leans on,
   *  for a caller with nothing leaning on it (a QR stand, a card holder). */
  backContent: Box;
  frontPose: Pose;
  backPose: Pose;
  metrics: CrossStandMetrics;
  warnings: string[];
}

/** The phone the stand is proved against: a 6.5-inch handset with a case, and 170 g is the heavy
 *  end of that class (iPhone 15 Pro Max 221 g is heavier still, and it is 77 mm wide — the
 *  margins below have room for it). */
const PHONE = { length: 160, width: 75, thickness: 8, mass: 170 };

/**
 * The stand, in rings and poses. Pure: no CSG, no fonts, no values object.
 */
export function crossStandGeometry(i: CrossStandInput): CrossStandGeometry {
  const width = Math.max(24, i.width);
  const height = Math.max(50, i.height);
  const t = Math.max(0.5, i.t);
  const kerf = Math.max(0, i.kerf);
  const lean = clamp(i.lean ?? 67, 45, 80);
  const clearance = i.clearance ?? 0.05;
  const lipWanted = i.lip ?? 12;
  const warnings: string[] = [];

  const th = rad(lean);
  const sn = Math.sin(th);
  const cs = Math.cos(th);
  const tn = sn / cs;

  // ----------------------------------------------------------------- the three equations --
  const crossHeight = (height + (t / 2) * (sn * tn - cs)) / (1 + tn);
  const shortArm = (crossHeight - (t / 2) * cs) / sn;
  const longArm = (crossHeight - (t / 2) * sn) / cs;
  const length = shortArm + longArm;

  // --------------------------------------------------------------------------- the plank --
  const halfW = width / 2;
  const tipShort = TIP_SHORT * halfW;
  const tipLong = TIP_LONG * halfW;
  const halfL = length / 2;
  /** The slot's centre, in the drawn piece: the crossing, `shortArm` up from the short tip. */
  const slotY = shortArm - halfL;
  const cornerR = clamp(i.corner ?? Math.min(9, 0.22 * width), 0, 0.45 * (2 * tipLong));
  /** The taper: widest at the crossing, where half the width is slot and the bending moment
   *  peaks, easing to each arm's own tip width. A curve rather than two straight runs and a kink,
   *  so the widest point is EXACTLY `width` — rounding a kink would quietly cut the stand
   *  narrower than the customer asked for, and leaving it sharp is a corner nobody drew. */
  const halfAt = (y: number) => {
    const [arm, tip] = y >= slotY ? [halfL - slotY, tipLong] : [slotY + halfL, tipShort];
    const u = clamp(Math.abs(y - slotY) / Math.max(1e-6, arm), 0, 1);
    return tip + (halfW - tip) * (1 - Math.pow(u, TAPER_P));
  };
  const steps = Math.max(8, Math.ceil(length / 1.5));
  // The crossing itself is always sampled: it is the one height the customer asked for by name,
  // and a curve that only passes near it comes out a few hundredths narrow.
  const rows: number[] = [slotY];
  for (let k = 1; k < steps; k++) {
    const y = -halfL + (length * k) / steps;
    if (Math.abs(y - slotY) > 1e-6) rows.push(y);
  }
  rows.sort((a, b) => a - b);
  const side = (sign: 1 | -1): Pt[] => {
    const out: Pt[] = rows.map((y) => [sign * halfAt(y), y] as Pt);
    return sign === 1 ? out : out.reverse();
  };
  const pts: Pt[] = [[tipShort, -halfL], ...side(1), [tipLong, halfL], [-tipLong, halfL], ...side(-1), [-tipShort, -halfL]];
  const radii = pts.map((p) => (Math.abs(Math.abs(p[1]) - halfL) < 1e-9 ? cornerR : 0));
  /** The part, as drawn for the BACK piece. */
  const plank = fillet(pts, radii);

  // The joint. The slot is a void, so it is drawn a kerf narrow and comes off the machine on
  // `t + clearance`; its depth runs to the plank's own centreline, so the two depths sum to the
  // width at the crossing and the pieces' side edges finish flush.
  const slot = { width: slotWidth(t, kerf, clearance), depth: halfW };
  const backSlot: Shapes = [[slotRing(-halfW, slotY, slot.width, slot.depth, 'left')]];
  const frontSlot: Shapes = [[turn(slotRing(-halfW, slotY, slot.width, slot.depth, 'left'))]];

  // ----------------------------------------------------------------- what may be engraved --
  // Both boxes run from a web above the slot to the tip, as wide as the plank is at their
  // narrow end. On the front piece that is the lip — the one face a docked phone leaves visible.
  const topY = halfL - Math.max(EDGE, cornerR);
  const boxAbove = (from: number): Box => ({
    minX: -(halfAt(topY) - EDGE), maxX: halfAt(topY) - EDGE,
    minY: from + slot.width / 2 + SLOT_WEB, maxY: topY,
  });
  const content = boxAbove(-slotY);
  const backContent = boxAbove(slotY);

  // ------------------------------------------------------------------------ standing up --
  // The piece's centre is `half` along its long arm from the crossing. The back piece leans by
  // the lean itself; the front piece is the same part turned about, so it takes the lean plus a
  // right angle — which is what puts the two lengths at 90° and faces its engraved side
  // down-front, at the customer.
  const half = halfL - shortArm;
  const backPose: Pose = { x: 0, y: half * cs, z: crossHeight + half * sn, rx: lean };
  const frontPose: Pose = { x: 0, y: half * sn, z: crossHeight - half * cs, rx: lean + 90 };

  // ---------------------------------------------------------------------- does it stand --
  const foot = { front: -shortArm * cs + (t / 2) * sn, back: longArm * sn - (t / 2) * cs, depth: 0 };
  foot.depth = foot.back - foot.front;
  const crotch = { y: (t / 2) * (cs - sn), z: crossHeight + (t / 2) * (cs + sn) };
  const com = {
    y: crotch.y + (PHONE.length / 2) * cs - (PHONE.thickness / 2) * sn,
    z: crotch.z + (PHONE.length / 2) * sn + (PHONE.thickness / 2) * cs,
  };
  const marginFront = com.y - foot.front;
  const marginBack = foot.back - com.y;

  // -------------------------------------------------------------------------- what to say --
  if (lean < 60) warnings.push('Under 60° a phone lies too flat to read comfortably — 65 to 70° is the range.');
  if (lean > 72) warnings.push('Over 72° a phone stands nearly upright and tips forward off the lip easily.');
  if (Math.min(marginFront, marginBack) < 10) {
    warnings.push('A phone leaning on this lands close to the edge of the footprint — a lower lean or a shorter stand is steadier.');
  }
  if (width < PHONE.width - 5) warnings.push('Narrower than a phone: it will hold one, but a knock can tip it sideways.');
  if (shortArm < lipWanted + 2) warnings.push('The lip is too shallow to catch a phone in a case — make the stand taller.');
  if (longArm < PHONE.length / 2) warnings.push('A big phone leans past the top of the stand — make it taller.');
  if (slot.width <= 0.5 || slot.width >= 1.8 * t) warnings.push(ODD_WIDTH);
  if (content.maxY - content.minY < 8 || content.maxX <= content.minX) {
    warnings.push('There is no room left on the front piece to engrave anything — make the stand taller.');
  }

  return {
    width, height, t,
    backPlank: plank,
    frontPlank: turn(plank),
    backSlot,
    frontSlot,
    content,
    backContent,
    frontPose,
    backPose,
    metrics: {
      lean, height, width,
      crossHeight, shortArm, longArm, length,
      tip: { short: 2 * tipShort, long: 2 * tipLong },
      foot,
      slot,
      crotch,
      phone: { length: PHONE.length, thickness: PHONE.thickness, mass: PHONE.mass, com, marginFront, marginBack },
    },
    warnings,
  };
}

export interface CrossStandContent {
  /** What the FRONT piece carries, in its own frame — `g.content` is the room it has. */
  front: DesignLayer[];
  /** What the BACK piece carries (`g.backContent`): the whole face a phone leans on, so only a
   *  caller with nothing leaning on it — a QR stand, a card holder — should fill it. */
  back?: DesignLayer[];
  /** In a run the sheet nests every copy, so the explicit placements come off. */
  batched?: boolean;
}

export interface CrossStandPieces {
  label: string;
  blank: Blank;
  layers: DesignLayer[];
  material: 'light';
  pose: Pose;
  parts: PartInput[];
  status: string;
}

/**
 * The two pieces, ready to spread into a `BuildInput`: the FRONT piece is the primary — it is
 * what the customer looks at and what carries the name — and the back piece is the part. The
 * caller adds its own keyring (a stand hangs from nothing), warnings and file name.
 */
export function crossStandPieces(g: CrossStandGeometry, content: CrossStandContent): CrossStandPieces {
  const cut = (id: string, shapes: Shapes): DesignLayer => ({ id, label: 'Slot', op: 'cut', shapes });

  const parts: PartInput[] = [{
    id: 'back',
    label: 'Back piece',
    blank: { kind: 'shape', shapes: [[g.backPlank]] },
    layers: [...(content.back ?? []), cut('back-slot', g.backSlot)],
    keyring: 'none',
    material: 'light',
    ...(content.batched ? {} : { at: { x: g.width + SHEET_GAP, y: 0 } }),
    // Straight behind the front piece on the flat card: a stand seen from the front IS its front
    // piece, with the rest of it showing past the edges.
    assembledAt: { x: 0, y: 0 },
    previewStyle: 'dashed',
    z: 0,
    pose: g.backPose,
  }];

  return {
    label: 'Front piece',
    blank: { kind: 'shape', shapes: [[g.frontPlank]] },
    layers: [...content.front, cut('front-slot', g.frontSlot)],
    material: 'light',
    pose: g.frontPose,
    parts,
    status: '2 pieces',
  };
}
