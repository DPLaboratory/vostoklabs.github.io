import { readSymbols } from '../symbols/model';
// Hair tie holder — the landscape slot card (Ian, 2026-09-21: "completely off, scrap that and
// let's have a couple of simpler templates", with two reference pictures; this one is
// `ref/REF-hair-tie-slot-card-sophia.png`). The v3 shape-on-a-plaque with its notched waist and
// its Slot bar alternative are gone: one template, one object, one shape.
//
// What the object is, in the order the material comes off the bed:
//
//   THE CARD — a landscape rounded rectangle, 90 × 62 by default, with
//     · a central rectangular slot (50 × 12): the ties are pushed through it and hang from the
//       bar of material below, which is what actually holds them;
//     · a notch cut into each side edge at mid height (6 along the edge × 8 deep): a tie
//       stretched round the card drops into the two seats and cannot slide off either end;
//     · a Ø 4 mm hanging hole 5 mm down from the top edge, cut into the OUTLINE — the design's
//       own hanging point, not the shared Ring control (that control is Loop tab | None now, and
//       a loop tab on a nursery card is not the product);
//     · an inner outline scored 3 mm in, the dotted line the reference draws.
//   THE NAME — its own cut piece, laid beside the card on the sheet and glued on below the slot
//     (`assembledAt`, so the 3D view and the gallery card show it glued). The letters are one
//     union: a face that joins writes it, anything else is overlapped a little and the buried
//     edges scored. Until the engine's G33 note lands this is the `connected-text` idiom —
//     `connectSpec` + a `hug` at margin 0 with bridges — which is the same weld the seams are
//     drawn from.
//
// Every cut keeps 4 mm of material from every other cut: 3 mm ply wants a web of at least its
// own thickness between two kerfs (`docs/design/laser-cutting-knowledge.md` §2.5), and 4 is that
// with the kerf paid for. The sliders are clamped to it rather than allowed to produce a card
// that snaps, and the clamp says so.
import { bboxOf, circleRing, placeShapes, roundedRectRing, type Pt, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { MIN_COUNTER, applyCase, textLayer } from '../engine/text';
import { sizeForCapHeight } from '../engine/metrics';
import type { BuildInput, DesignLayer, PartInput } from '../engine/types';
import { NO_KEYRING } from './keyring';
import { connectSpec, countersTooTight, letterScoreField, letteringFields, stem } from './shared';
import { num, str, type TemplateDef, type Values } from './types';

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

/** The least material left between any two cuts, mm. 3 mm ply's own thickness is the floor
 *  (§2.5); 4 is that with the kerf paid for, and it is what every slider here is clamped to. */
const MIN_WEB = 4;
/** The hanging hole: a 4 mm hole takes a jump ring, a ribbon or a cup hook, and 5 mm down from
 *  the edge leaves 3 mm of material above it — the material's own thickness (§5.2/§5.4). */
const HOLE_DIA = 4;
const HOLE_EDGE = 5;
/** How far in the scored inner outline runs, mm — the reference's dotted line. */
const INNER_INSET = 3;
/** Air between the name piece and the card's edges once it is glued on, mm. */
const NAME_AIR = 4;
/** Letters below this stop reading once they are cut rather than printed. */
const CAP_FLOOR = 6;
/** The bar that joins a letter the weld could not reach (a space, an inline symbol's pip), mm.
 *  The sheet's own thickness: a thinner bar is the first thing to snap off the piece. */
const NAME_BRIDGE = 3;
/** The slot's corner radius, mm. The reference draws a plain rectangle; a small radius is the
 *  same drawing with the pierce divot off the corner (§2.1). */
const SLOT_CORNER = 1.5;

/** How far the scored inner line stops short of a seat it would otherwise run into, mm. */
const INNER_GAP = 0.8;

/** A notch: a stadium centred ON the edge, so its inner half bites `depth` into the material and
 *  its outer half hangs in fresh air. Full-radius ends, which is what lets a stretched elastic
 *  slide into the seat instead of catching, and what keeps the notch from being a stress riser. */
const notchRing = (x: number, y: number, depth: number, along: number): CutRing =>
  placeShapes([[roundedRectRing(2 * depth, along, Math.min(depth, along / 2))]], x, y, 0)[0]![0]!;

/** Is `p` inside a rounded rectangle of half-sizes `hw × hh` and radius `r` about `c`, grown by
 *  `g`? Exact: the corner test only runs in the corner quadrant, so a stadium answers as a
 *  stadium rather than as its bounding box. */
function inRoundedRect(p: Pt, c: Pt, hw: number, hh: number, r: number, g = 0): boolean {
  const dx = Math.abs(p[0] - c[0]);
  const dy = Math.abs(p[1] - c[1]);
  const W = hw + g;
  const H = hh + g;
  const R = Math.min(r + g, W, H);
  if (dx > W || dy > H) return false;
  const ax = W - R;
  const ay = H - R;
  if (dx <= ax || dy <= ay) return true;
  return (dx - ax) ** 2 + (dy - ay) ** 2 <= R * R;
}

/**
 * The scored inner outline, as OPEN runs that stop either side of the seats.
 *
 * The reference draws it exactly this way (`ref/REF-hair-tie-slot-card-sophia.png`): the dotted
 * line runs round the card 3 mm in and simply stops where a seat is cut, picking up again on the
 * far side. Handing the engine a closed ring and letting it clip draws the same picture and then
 * reports 4 % of the rule "runs past the edge" — which is the engine describing a seat, not a
 * fault. So the break is made here, where it is the design's decision.
 */
function innerRuns(w: number, h: number, corner: number, inset: number, guards: { c: Pt; hw: number; hh: number; r: number }[]): Pt[][] {
  const ring = roundedRectRing(w - 2 * inset, h - 2 * inset, Math.max(0, corner - inset), 12);
  // Densified, because a rounded rectangle draws each straight edge as ONE segment and a run can
  // only start and stop on a vertex.
  const dense: Pt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.6));
    for (let s = 0; s < steps; s++) dense.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
  }
  const clear = dense.map((p) => !guards.some((g) => inRoundedRect(p, g.c, g.hw, g.hh, g.r, INNER_GAP)));
  if (clear.every(Boolean)) return [[...dense, dense[0]!]];
  // Start at the first point that follows a blocked one, so the walk never splits a live run.
  const start = clear.findIndex((ok, i) => ok && !clear[(i + clear.length - 1) % clear.length]);
  if (start < 0) return [];
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  for (let i = 0; i < dense.length; i++) {
    const k = (start + i) % dense.length;
    if (clear[k]) run.push(dense[k]!);
    else if (run.length) { if (run.length > 1) runs.push(run); run = []; }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/** Faces whose capitals weld into a piece a 3 mm sheet survives: fat, rounded, open-countered.
 *  Measured, not guessed — every one of these cuts "Sophia", "Mia" and "Charlotte" at the shipped
 *  size with nothing to say. The two that look like they belong and do not: Titan One, whose
 *  counters are already under a millimetre at a 14 mm capital, and the connecting scripts, which
 *  this design sets in CAPITALS (the reference is "SOPHIA") where they no longer connect and the
 *  hug has to bar them together. Nothing with hairlines either — a 0.5 mm stroke is not a piece,
 *  it is a splinter (`laser-cutting-knowledge.md` §2.3). */
const NAME_FACES = ['fredoka', 'baloo-2', 'lilita-one', 'bakbak-one', 'chewy', 'anton'];

export const hairTieHolder: TemplateDef = {
  id: 'hair-tie-holder',
  name: 'Hair tie holder',
  blurb: 'A slot card for hair ties, with a seat cut into each edge and the name cut as its own piece to glue on.',
  tags: ['home', 'score + cut'],
  batch: { key: 'text', noun: 'holder' },
  fields: [
    // ------------------------------------------------------- RIGHT: what you type --
    {
      kind: 'text', key: 'text', label: 'Name', panel: 'right', section: 'Name', value: 'Sophia',
      placeholder: 'A name', maxLength: 14, symbols: true,
      help: 'Cut as its own piece and glued on the card.',
    },
    {
      kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'fredoka',
      recommended: NAME_FACES,
    },

    // -------------------------------------------- LEFT: "Card" — opens first --
    { kind: 'number', key: 'width', label: 'Width', section: 'Card', value: 90, min: 60, max: 160, step: 1, unit: 'mm' },
    // 45, not 40: under 45 the band left under the slot is thinner than the 6 mm floor a cut
    // letter has, so the slider's own minimum shipped a warning (G25).
    { kind: 'number', key: 'height', label: 'Height', section: 'Card', value: 62, min: 45, max: 120, step: 1, unit: 'mm' },
    {
      kind: 'number', key: 'slotW', label: 'Slot width', section: 'Card', value: 50, min: 20, max: 140, step: 1, unit: 'mm',
      help: 'The ties are pushed through and hang on the bar.',
    },

    // ---------------------------------------------------- LEFT: "More options" --
    { kind: 'number', key: 'slotH', label: 'Slot height', section: 'Card', value: 12, min: 6, max: 30, step: 0.5, unit: 'mm', advanced: true },
    {
      kind: 'number', key: 'notchD', label: 'Seat depth', section: 'Card', value: 8, min: 3, max: 16, step: 0.5, unit: 'mm', advanced: true,
      help: 'How far into the edge a stretched tie drops.',
    },
    { kind: 'number', key: 'notchW', label: 'Seat width', section: 'Card', value: 6, min: 3, max: 16, step: 0.5, unit: 'mm', advanced: true },
    { kind: 'toggle', key: 'innerLine', label: 'Inner line', section: 'Card', value: true, advanced: true, help: 'Scores an outline 3 mm inside the edge.' },
    { kind: 'number', key: 'corner', label: 'Corner radius', section: 'Card', value: 8, min: 0, max: 20, step: 0.5, unit: 'mm', advanced: true },
    { kind: 'number', key: 'nameSize', label: 'Name size', section: 'Name', value: 14, min: 8, max: 28, step: 0.5, unit: 'mm', advanced: true },
    // Under More with the rest: a left category holding one control is a rail icon that answers
    // a question nobody asked. The first screen is the name, the card and the font.
    { ...letterScoreField('Name', 'score'), advanced: true },
    ...letteringFields('Name', { textCase: 'upper' }),
  ],

  async build(v: Values): Promise<BuildInput> {
    const warnings: string[] = [];
    const w = clamp(num(v, 'width'), 60, 160);
    const h = clamp(num(v, 'height'), 45, 120);
    const corner = clamp(num(v, 'corner'), 0, 0.3 * Math.min(w, h));

    // ------------------------------------------------------------- the card --
    // The hanging hole is a hole in the OUTLINE, not a layer: it is part of the shape the way
    // the slot is part of the product, and nothing the customer can drag off the edge.
    const holeCy = h / 2 - HOLE_EDGE;
    const card: Shapes = [[roundedRectRing(w, h, corner), circleRing(0, holeCy, HOLE_DIA / 2, 48)]];

    // ------------------------------------------------- the seats in the edges --
    // Held off the top and bottom edges as well as off the slot: a seat is a cut like any other.
    const notchD = clamp(num(v, 'notchD'), 3, Math.max(3, Math.min(16, w / 2 - 2 * MIN_WEB)));
    const notchW = clamp(num(v, 'notchW'), 3, Math.max(3, Math.min(16, h - 2 * MIN_WEB)));
    const notches: Shapes = [
      [notchRing(-w / 2, 0, notchD, notchW)],
      [notchRing(w / 2, 0, notchD, notchW)],
    ];

    // ------------------------------------------------------------- the slot --
    // Wide enough to take a handful of ties, and held `MIN_WEB` clear of the seats' floors on
    // each side and of the hanging hole above.
    const maxSlotW = w - 2 * notchD - 2 * MIN_WEB;
    const slotW = clamp(num(v, 'slotW'), 10, Math.max(10, maxSlotW));
    if (num(v, 'slotW') > maxSlotW + 0.01) warnings.push(`The slot was cut back to ${slotW.toFixed(0)} mm to keep ${MIN_WEB} mm of material between it and the seats.`);
    const maxSlotH = Math.min(2 * (holeCy - HOLE_DIA / 2 - MIN_WEB), h - 2 * MIN_WEB);
    const slotH = clamp(num(v, 'slotH'), 4, Math.max(4, maxSlotH));
    if (num(v, 'slotH') > maxSlotH + 0.01) warnings.push(`The slot was cut back to ${slotH.toFixed(0)} mm tall to keep clear of the hanging hole.`);

    const layers: DesignLayer[] = [
      {
        id: 'slot', label: 'Slot', op: 'cut', stencil: false,
        shapes: [[roundedRectRing(slotW, slotH, Math.min(SLOT_CORNER, slotH / 2, slotW / 2))]],
      },
      {
        // Trimmed to the material before it is punched: the outer half of each seat hangs in
        // fresh air and must not reach the size on the status line (G15).
        id: 'notches', label: 'Seats', op: 'cut', shapes: notches, keep: card, stencil: false,
      },
    ];
    if (v.innerLine !== false && w > 2 * INNER_INSET + 4 && h > 2 * INNER_INSET + 4) {
      const seat = { hw: notchD, hh: notchW / 2, r: Math.min(notchD, notchW / 2) };
      const runs = innerRuns(w, h, corner, INNER_INSET, [
        { c: [-w / 2, 0], ...seat },
        { c: [w / 2, 0], ...seat },
      ]);
      if (runs.length) layers.push({ id: 'inner', label: 'Inner line', op: 'score', shapes: [], paths: runs });
    }

    // -------------------------------------------------- the name, its own piece --
    // The band under the slot is where it glues: the hole and the slot own everything above it.
    const bandTop = -slotH / 2;
    const bandH = bandTop + h / 2;
    const name = await namePiece(
      v,
      clamp(num(v, 'nameSize'), CAP_FLOOR, 28),
      w - 2 * Math.max(corner, NAME_AIR),
      bandH - 2 * NAME_AIR,
    );
    const parts: PartInput[] = [];
    if (name) {
      if (name.tight) warnings.push(`The name is at its ${CAP_FLOOR} mm floor and still runs past the card — use a shorter name or a wider card.`);
      warnings.push(...countersTooTight(name.layers.flatMap((l) => l.shapes)));
      parts.push({
        id: 'name',
        label: 'Name',
        // The piece IS the letters: margin 0 and no smoothing, so it is cut on the glyph
        // outlines and not in a jacket (G31). Bridges join what the weld could not reach.
        blank: { kind: 'hug', margin: 0, smoothing: 0, bridge: NAME_BRIDGE, counters: 'open', minHole: MIN_COUNTER, bridges: 'all' },
        layers: [
          ...name.layers.map((l) => ({ ...l, op: 'off' as const, hugOnly: true })),
          ...name.seams,
        ],
        keyring: 'none',
        assembledAt: { x: 0, y: bandTop - bandH / 2 },
        material: 'light',
      });
    }

    return {
      label: 'Card',
      material: 'dark',
      blank: { kind: 'shape', shapes: card, oneIsland: true },
      // No Ring control at all: the hole above is the design's (Ian, 2026-09-21).
      keyring: NO_KEYRING,
      layers,
      ...(parts.length ? { parts, layout: { flow: 'row' as const, gap: 6 } } : {}),
      ...(warnings.length ? { warnings } : {}),
      status: parts.length ? 'card + name piece' : 'card',
    };
  },

  fileName: (v) => stem(str(v, 'text') || 'holder', 'hair-tie'),

  exportNote: 'Glue the name onto the card below the slot, then push the ties through.',
};

/**
 * The name as ONE welded body, centred on its own origin — the piece the customer glues on.
 *
 * Built, measured, rebuilt at a smaller capital — never scaled: a face squeezed in one axis is a
 * different typeface, and the font cards are the whole reason the customer picked this one. The
 * floor is 6 mm; below that a cut letter is a splinter, so the fit stops and the caller warns.
 */
async function namePiece(v: Values, wantedCap: number, maxW: number, maxH: number): Promise<
{ layers: DesignLayer[]; seams: DesignLayer[]; cap: number; tight: boolean } | null> {
  const text = applyCase(str(v, 'text'), str(v, 'textCase')).trim();
  if (!text || maxW <= 2 || maxH <= 2) return null;
  const font = str(v, 'font');
  const draw = async (cap: number) => {
    const size = await sizeForCapHeight(font, cap);
    const connect = connectSpec(font, size);
    const layers = await textLayer(
      { text, symbols: readSymbols(v), font, size, letterSpacing: num(v, 'letterSpacing') / 100, connect },
      'off', 'name', 'Name',
    );
    return { layers, connect, box: bboxOf(layers.flatMap((l) => l.shapes)) };
  };

  let out = await draw(wantedCap);
  if (!out.layers.length) return null;
  let cap = wantedCap;
  const k = Math.min(
    1,
    maxW / Math.max(1e-6, out.box.maxX - out.box.minX),
    maxH / Math.max(1e-6, out.box.maxY - out.box.minY),
  );
  if (k < 0.999) {
    cap = Math.max(CAP_FLOOR, wantedCap * k);
    out = await draw(cap);
  }
  const bw = out.box.maxX - out.box.minX;
  const bh = out.box.maxY - out.box.minY;
  const dx = -(out.box.minX + out.box.maxX) / 2;
  const dy = -(out.box.minY + out.box.maxY) / 2;
  const centred = out.layers.map((l) => ({ ...l, shapes: placeShapes(l.shapes, dx, dy, 0) }));
  // Seams are what a WELD leaves behind: a face that already joins was drawn that way by its type
  // designer, and a line burnt at every join crosses a script meant to read as one stroke.
  const seams = str(v, 'letterLines') === 'score' && (out.connect.overlap ?? 0) > 0
    ? centred.map((l) => ({ ...l, id: `${l.id}-seam`, label: 'Letter seams', op: 'score' as const, seams: true }))
    : [];
  return { layers: centred, seams, cap, tight: bw > maxW + 0.05 || bh > maxH + 0.05 };
}
