import { readSymbols } from '../symbols/model';
// Hair tie card — the portrait pattern card, the second of the two holders Ian asked for
// (`ref/REF-hair-tie-tall-card-floral-T.png`, and "for this one we can employ our patterns
// engine btw").
//
// One piece, four cuts and two burns:
//
//   · a portrait rounded rectangle, 60 × 120 by default, corner 8;
//   · a tall vertical slot down its middle (12 × 70) — the ties are pushed through and hang on
//     the two rails either side;
//   · a round bite in each side edge near each end (Ø 12, four of them): a tie stretched round
//     the card drops into a pair of them and cannot slide along;
//   · a Ø 4 mm hanging hole 5 mm below the top edge, cut into the outline — the design's own
//     hanging point, never the shared Ring control;
//   · a repeating pattern engraved over the face (`@vostok/patterns`), kept 3 mm clear of every
//     cut so no burn ever runs into a kerf;
//   · a monogram beside the slot, engraved (or cut, or scored).
//
// The pattern engine is called exactly the way `pattern-fill.ts` calls it — one `pattern` field,
// the gallery picker behind it, `fillShape` given the REGION the pattern may fill. The region is
// this template's only real work: the card, less the slot, less the hanging hole, less the box
// the monogram sits in, and the engine's `inset` puts 3 mm of air round every one of them.
import { bboxOf, circleRing, placeShapes, roundedRectRing, type Box, type Pt, type Shapes } from '@vostok/laser';
import { fillShape, patternById, type PatternDef, type PatternOp } from '@vostok/patterns';
import { applyCase, textLayer } from '../engine/text';
import { sizeForCapHeight } from '../engine/metrics';
import type { BuildInput, DesignLayer } from '../engine/types';
import { NO_KEYRING } from './keyring';
import { letteringFields, opField, opOf, stem } from './shared';
import { num, str, type TemplateDef, type Values } from './types';

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

/** The least material left between any two cuts, mm (`docs/design/laser-cutting-knowledge.md`
 *  §2.5: at least the sheet's own thickness; 4 is 3 mm ply with the kerf paid for). */
const MIN_WEB = 4;
/** Air between the engraving and every cut, mm — the number §H asks for, and the number the
 *  region is inset by. A burn that reaches a kerf chars the edge it is cut on. */
const PATTERN_INSET = 3;
const HOLE_DIA = 4;
const HOLE_EDGE = 5;
/** Letters below this stop reading once they are cut rather than burnt. */
const CAP_FLOOR = 6;

/** A scattered botanical — daisies and small leaf clusters, the tile nearest the reference
 *  photograph's floral. The default build IS the gallery card, so this is the picture. Pattern
 *  Monster's library (MIT), lazy-loaded: a customer who never opens the gallery never pays for
 *  the ~900 KB of path data. */
const DEFAULT_PATTERN = 'pm-flower-5';
/** What a pattern falls back to when an id names nothing this build knows. */
const FALLBACK_PATTERN = 'honeycomb';

const OP_WORD: Record<PatternOp, string> = { cut: 'cut out', engrave: 'engraved', score: 'scored' };

/** Faces whose single capital carries a card this size: a high-contrast serif first (what the
 *  reference sets), then the grotesques and one rounded face. */
const MONOGRAM_FACES = ['playfair-display', 'cinzel', 'abril-fatface', 'bebas-neue', 'anton', 'fredoka'];

let libraryLoaded: Promise<PatternDef[]> | null = null;
async function libraryPattern(id: string): Promise<PatternDef | undefined> {
  libraryLoaded ??= import('@vostok/patterns/library').then((m) => m.LIBRARY);
  const lib = await libraryLoaded;
  return lib.find((d) => d.id === id) ?? lib[0];
}

const grow = (b: Box, d: number): Box => ({ minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d });
const inside = (b: Box, of: Box): boolean => b.minX >= of.minX - 1e-6 && b.maxX <= of.maxX + 1e-6 && b.minY >= of.minY - 1e-6 && b.maxY <= of.maxY + 1e-6;
const clearOf = (b: Box, of: Box): boolean => b.maxX <= of.minX + 1e-6 || b.minX >= of.maxX - 1e-6 || b.maxY <= of.minY + 1e-6 || b.minY >= of.maxY - 1e-6;

export const hairTieCard: TemplateDef = {
  id: 'hair-tie-card',
  name: 'Hair tie card',
  blurb: 'A tall hair tie card with a pattern engraved over it, a slot down the middle and a bite in each corner.',
  tags: ['home', 'engrave + cut'],
  fields: [
    // ------------------------------------------------------- RIGHT: what you type --
    {
      kind: 'text', key: 'text', label: 'Letter', panel: 'right', section: 'Letter', value: 'T',
      placeholder: 'One letter', maxLength: 2, symbols: true,
      help: 'A monogram beside the slot — leave it empty for none.',
    },
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'playfair-display', recommended: MONOGRAM_FACES },

    // ------------------------------------------- LEFT: "Card" — opens first --
    { kind: 'number', key: 'width', label: 'Width', section: 'Card', value: 60, min: 40, max: 120, step: 1, unit: 'mm' },
    { kind: 'number', key: 'height', label: 'Height', section: 'Card', value: 120, min: 70, max: 220, step: 1, unit: 'mm' },

    // ---------------------------------------------------------- LEFT: "Pattern" --
    {
      kind: 'pattern', key: 'pattern', label: 'Pattern', section: 'Pattern', value: DEFAULT_PATTERN,
      help: 'Engraved over the card, 3 mm clear of every cut.',
    },
    { kind: 'number', key: 'patternScale', label: 'Zoom', section: 'Pattern', value: 100, min: 40, max: 300, step: 5, unit: '%' },

    // ---------------------------------------------------- LEFT: "More options" --
    { kind: 'number', key: 'patternAngle', label: 'Pattern angle', section: 'Pattern', value: 0, min: 0, max: 180, step: 5, unit: '°', advanced: true },
    {
      kind: 'number', key: 'slotW', label: 'Slot width', section: 'Card', value: 12, min: 6, max: 28, step: 0.5, unit: 'mm', advanced: true,
      help: 'The ties are pushed through and hang on the rails.',
    },
    { kind: 'number', key: 'slotH', label: 'Slot height', section: 'Card', value: 70, min: 20, max: 180, step: 1, unit: 'mm', advanced: true },
    {
      kind: 'number', key: 'bite', label: 'Corner bite', section: 'Card', value: 6, min: 0, max: 14, step: 0.5, unit: 'mm', advanced: true,
      help: 'How deep the four seats are cut into the edges.',
    },
    { kind: 'number', key: 'corner', label: 'Corner radius', section: 'Card', value: 8, min: 0, max: 20, step: 0.5, unit: 'mm', advanced: true },
    { kind: 'number', key: 'letterSize', label: 'Letter size', section: 'Letter', value: 22, min: 8, max: 60, step: 0.5, unit: 'mm', advanced: true },
    { ...opField('Letter', 'engrave', 'Monogram'), advanced: true },
    ...letteringFields('Letter'),
  ],

  async build(v: Values): Promise<BuildInput> {
    const warnings: string[] = [];
    const w = clamp(num(v, 'width'), 40, 120);
    const h = clamp(num(v, 'height'), 70, 220);
    const corner = clamp(num(v, 'corner'), 0, 0.3 * Math.min(w, h));

    // ------------------------------------------------- the outline and its hole --
    const holeCy = h / 2 - HOLE_EDGE;
    const card: Shapes = [[roundedRectRing(w, h, corner), circleRing(0, holeCy, HOLE_DIA / 2, 48)]];

    // -------------------------------------------------- the bites in the edges --
    // One in each side edge near each end, so a tie stretched across the card sits in a PAIR of
    // them. Held clear of the rounded corner above it and of its twin below, and never so deep
    // that what is left beside the slot drops under the web floor.
    const bite = clamp(num(v, 'bite'), 0, Math.max(0, Math.min(0.25 * w, (h / 2 - corner - 2 * MIN_WEB) / 2)));
    const biteY = h / 2 - corner - bite - MIN_WEB;
    const bites: Shapes = bite < 1 ? [] : [
      [circleRing(-w / 2, biteY, bite, 48)], [circleRing(w / 2, biteY, bite, 48)],
      [circleRing(-w / 2, -biteY, bite, 48)], [circleRing(w / 2, -biteY, bite, 48)],
    ];

    // ------------------------------------------------------------- the slot --
    const maxSlotW = w - 2 * bite - 2 * MIN_WEB;
    const slotW = clamp(num(v, 'slotW'), 4, Math.max(4, maxSlotW));
    if (num(v, 'slotW') > maxSlotW + 0.01) warnings.push(`The slot was cut back to ${slotW.toFixed(0)} mm so the rails keep ${MIN_WEB} mm beside the bites.`);
    const maxSlotH = Math.min(2 * (holeCy - HOLE_DIA / 2 - MIN_WEB), h - 2 * MIN_WEB);
    const slotH = clamp(num(v, 'slotH'), 10, Math.max(10, maxSlotH));
    if (num(v, 'slotH') > maxSlotH + 0.01) warnings.push(`The slot was cut back to ${slotH.toFixed(0)} mm tall to keep clear of the hanging hole.`);
    const slotRing = roundedRectRing(slotW, slotH, Math.min(2, slotW / 2));
    const slotBox = bboxOf([[slotRing]]);

    // ------------------------------------------------------- the monogram --
    // Left of the slot, on the rail's own centre line, at the biggest capital the rail holds.
    const railW = w / 2 - slotW / 2;
    const mx = -(slotW / 2 + railW / 2);
    const letter = await fitLetter(
      v,
      clamp(num(v, 'letterSize'), CAP_FLOOR, 60),
      railW - 2 * PATTERN_INSET,
      Math.max(4, 2 * (biteY - bite - MIN_WEB)),
      mx,
    );
    if (letter?.tight) warnings.push(`The monogram is at its ${CAP_FLOOR} mm floor and still runs past the rail — use a wider card.`);
    const letterBox = letter ? bboxOf(letter.layers.flatMap((l) => l.shapes)) : null;

    // ---------------------------------------------------------- the pattern --
    // The region the pattern may fill: the card, less every cut and less the monogram's own box.
    // Each reserve is a HOLE in the card's island — `fillShape` reads the region even-odd — and
    // `inset` puts `PATTERN_INSET` of air round the outline and round every reserve at once.
    const region: Shapes = [[
      roundedRectRing(w, h, corner),
      circleRing(0, holeCy, HOLE_DIA / 2, 48),
      slotRing,
      ...(letterBox ? [roundedRectRing(letterBox.maxX - letterBox.minX, letterBox.maxY - letterBox.minY, 1).map(([x, y]): Pt => [x + (letterBox.minX + letterBox.maxX) / 2, y + (letterBox.minY + letterBox.maxY) / 2])] : []),
    ]];
    const chosen = str(v, 'pattern');
    const def = (chosen.startsWith('pm-') ? await libraryPattern(chosen) : patternById(chosen)) ?? patternById(FALLBACK_PATTERN)!;
    let op: PatternOp = 'engrave';
    if (!def.ops.includes(op)) {
      op = def.ops[0]!;
      warnings.push(`${def.name} cannot be ${OP_WORD.engrave} — it is ${OP_WORD[op]} instead.`);
    }
    const fill = fillShape(region, def, {
      op,
      // The library's own knob for a tile drawn as lines; a procedural pattern declares no
      // `stroke` key, so `resolveParams` drops it and one params object serves both halves.
      params: { stroke: 1 },
      scale: num(v, 'patternScale') / 100,
      angle: num(v, 'patternAngle'),
      inset: PATTERN_INSET,
    });
    warnings.push(...fill.warnings);

    // Whatever the clip could not settle exactly — a concave motif crossing the edge that needs
    // the worker's boolean, which this side of the build does not have — is dropped here rather
    // than left to be clipped by the plate and reported as a burn that "runs past the edge".
    const keepBox = { minX: -w / 2 + PATTERN_INSET, maxX: w / 2 - PATTERN_INSET, minY: -h / 2 + PATTERN_INSET, maxY: h / 2 - PATTERN_INSET };
    const holeGuard = HOLE_DIA / 2 + PATTERN_INSET;
    const biteGuard = bite + PATTERN_INSET;
    const onMaterial = (island: Shapes[number]): boolean => {
      const b = bboxOf([island]);
      if (!inside(b, keepBox) || !clearOf(b, grow(slotBox, PATTERN_INSET))) return false;
      if (letterBox && !clearOf(b, grow(letterBox, PATTERN_INSET))) return false;
      for (const ring of island) {
        for (const p of ring) {
          if (Math.hypot(p[0], p[1] - holeCy) < holeGuard) return false;
          if (bite >= 1) {
            for (const sx of [-1, 1] as const) {
              for (const sy of [-1, 1] as const) {
                if (Math.hypot(p[0] - (sx * w) / 2, p[1] - sy * biteY) < biteGuard) return false;
              }
            }
          }
        }
      }
      return true;
    };
    const engraved = fill.shapes.filter(onMaterial);

    // ------------------------------------------------------------ the layers --
    const layers: DesignLayer[] = [];
    if (engraved.length) layers.push({ id: 'pattern', label: def.name, shapes: engraved, op: op === 'cut' ? 'engrave' : op });
    // A pattern drawn as lines has no region to fill: its lines are scored, the way pattern-fill
    // runs them, and the export legend says so.
    if (fill.paths.length) layers.push({ id: 'pattern-lines', label: `${def.name} lines`, shapes: [], op: 'score', paths: fill.paths });
    if (letter) layers.push(...letter.layers);
    layers.push({ id: 'slot', label: 'Slot', op: 'cut', shapes: [[slotRing]], stencil: false });
    if (bites.length) {
      // Trimmed to the material before it is punched: the outer half of each bite hangs in fresh
      // air and must not reach the size on the status line (G15).
      layers.push({ id: 'bites', label: 'Corner bites', op: 'cut', shapes: bites, keep: card, stencil: false });
    }

    return {
      blank: { kind: 'shape', shapes: card, oneIsland: true },
      // No Ring control at all: the hole above is the design's (Ian, 2026-09-21).
      keyring: NO_KEYRING,
      layers,
      ...(warnings.length ? { warnings } : {}),
      status: def.name,
    };
  },

  fileName: (v) => stem(str(v, 'text') || 'monogram', 'hair-tie-card'),

  exportNote: 'Engrave the pattern first, then cut the slot, the bites and the outline.',
};

/**
 * The monogram at the biggest capital that fits the rail, placed on it.
 *
 * Built, measured, rebuilt at a smaller capital — never scaled, because a face squeezed in one
 * axis is a different typeface and the font cards are why this one was picked. The floor is
 * 6 mm; under that the caller warns instead of shrinking further.
 */
async function fitLetter(v: Values, wantedCap: number, maxW: number, maxH: number, x: number): Promise<
{ layers: DesignLayer[]; tight: boolean } | null> {
  const text = applyCase(str(v, 'text'), str(v, 'textCase')).trim();
  if (!text || maxW <= 2 || maxH <= 2) return null;
  const font = str(v, 'font');
  const op = opOf(v);
  const draw = async (cap: number) => {
    const layers = await textLayer(
      { text, symbols: readSymbols(v), font, size: await sizeForCapHeight(font, cap), letterSpacing: num(v, 'letterSpacing') / 100 },
      op, 'letter', 'Monogram',
    );
    return { layers, box: bboxOf(layers.flatMap((l) => l.shapes)) };
  };

  let out = await draw(wantedCap);
  if (!out.layers.length) return null;
  const k = Math.min(1, maxW / Math.max(1e-6, out.box.maxX - out.box.minX), maxH / Math.max(1e-6, out.box.maxY - out.box.minY));
  if (k < 0.999) out = await draw(Math.max(CAP_FLOOR, wantedCap * k));
  const bw = out.box.maxX - out.box.minX;
  const bh = out.box.maxY - out.box.minY;
  const dx = x - (out.box.minX + out.box.maxX) / 2;
  const dy = -(out.box.minY + out.box.maxY) / 2;
  return {
    layers: out.layers.map((l) => ({ ...l, shapes: placeShapes(l.shapes, dx, dy, 0) })),
    tight: bw > maxW + 0.05 || bh > maxH + 0.05,
  };
}
