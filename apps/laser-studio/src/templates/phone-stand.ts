// The phone stand: two identical planks that slot together at a right angle, and a phone leaning
// in the V between them. Type a name, pick a size, cut two pieces.
//
// Everything about the stand — the arms, the slot, the lean, whether it STANDS — is
// `engine/cross-stand.ts`, which is where that arithmetic belongs and where the QR stand takes it
// from in wave 2. What is this template's own is the name on the front piece's lip: the one face
// a docked phone leaves in plain view, and the face the reference photo's maker put their own
// mark on.
//
// Ian, 2026-09-21: "The geometry is just completely wrong … make a complete overhaul." The plate
// dropped into a slotted base (`engine/stands.ts`'s `slotBase`) is gone; the reference is
// `ref/REF-phone-stand-cross-pieces-80x130.png`.
import { bboxOf, placeShapes, type Box, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { crossStandGeometry, crossStandPieces } from '../engine/cross-stand';
import { fitBoxInside } from '../engine/editorGeometry';
import { symbolLayer, textLayer } from '../engine/text';
import type { DesignLayer, KeyringSpec } from '../engine/types';
import { readSymbols } from '../symbols/model';
import { stem } from './shared';
import { num, str, type TemplateDef, type Values } from './types';

/** Fit → joint clearance, mm. The same three names and numbers the QR stands use (`qr-shared`
 *  FIT): Tight is nominal, Snug a thumb-press, Easy forgives a sheet that varies. Declared here
 *  rather than imported so a sign does not depend on a QR module. */
const FIT: Record<string, number> = { tight: 0, snug: 0.05, easy: 0.15 };
type Pt = [number, number];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** A stand is free-standing: nothing here hangs from a ring. */
const noRing = (): KeyringSpec => ({ enabled: false, mode: 'outside', side: 'top', along: 0.5, dia: 4, ring: 2.5, position: -1 });

/** Engraved caps under this break up in a thin face (the house floor). */
const MIN_CAP = 4.5;

/**
 * The lean, in degrees from the TABLE.
 *
 * `lean` used to mean the plate's tilt from VERTICAL (10–25°, default 15) on the slotted-base
 * stand this template replaced. It means the phone's own angle from the table now, which is a
 * different number for the same key — so a project saved under the old template would open as a
 * stand lying nearly flat. Anything outside the range the form offers is therefore an old file,
 * and takes the default.
 */
const leanOf = (v: Values): number => {
  const a = num(v, 'lean');
  return a >= 60 && a <= 72 ? a : 67;
};

const boxOf = (layers: DesignLayer[]) => bboxOf(layers.flatMap((l) => l.shapes));
const centreOf = (b: Box): Pt => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
const rectShapes = (b: Box): Shapes => [[[[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]] as CutRing]];

const move = (layers: DesignLayer[], dx: number, dy: number): DesignLayer[] =>
  Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9 ? layers : layers.map((l) => ({ ...l, shapes: placeShapes(l.shapes, dx, dy, 0) }));

/** Symbol and name scaled as ONE block about `c`, so the gap between them scales with them. */
const scaleAbout = (layers: DesignLayer[], k: number, c: Pt): DesignLayer[] =>
  layers.map((l) => ({ ...l, shapes: l.shapes.map((isl) => isl.map((r) => r.map(([x, y]) => [c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k] as Pt))) }));

export const phoneStand: TemplateDef = {
  id: 'phone-stand',
  name: 'Phone stand',
  blurb: 'Two crossing pieces your phone leans in, cut from one sheet.',
  tags: ['home', 'engrave + cut'],
  fields: [
    // ---------------------------------------------------------- RIGHT: what you type --
    {
      kind: 'text', key: 'text', label: 'Name', panel: 'right', section: 'Text', value: 'Elsie',
      placeholder: 'A name, a word…', maxLength: 18, help: 'Engraved on the front piece, under the phone.',
    },
    { kind: 'symbol', key: 'symbol', label: 'Symbol', panel: 'right', section: 'Text', value: '', help: 'Optional, above the name.' },
    {
      kind: 'font', key: 'font', label: 'Font', section: 'Font', value: 'montserrat',
      // Engraved small on the lip and read across a desk: clean sans with open counters, and two
      // scripts for a name. Every one was built at the default stand before it was listed.
      recommended: ['montserrat', 'work-sans', 'poppins', 'manrope', 'outfit', 'bebas-neue', 'great-vibes', 'yellowtail'],
    },

    // ------------------------------------------------------ LEFT: "Stand" (opens first) --
    {
      kind: 'number', key: 'width', label: 'Width', section: 'Stand', value: 80, min: 50, max: 120, step: 1, unit: 'mm',
      help: 'Across the V — a big phone is 78 mm wide.',
    },
    { kind: 'number', key: 'height', label: 'Height', section: 'Stand', value: 130, min: 90, max: 200, step: 1, unit: 'mm' },

    // -------------------------------------------------------------- LEFT: "Assembly" --
    // The sheet the joint is cut for, in its own category rather than buried under More (Ian,
    // 2026-09-22: "anywhere where we have interlocking parts … separate assembly section").
    {
      kind: 'number', key: 'thickness', label: 'Material thickness', section: 'Assembly', value: 3, min: 1.5, max: 9, step: 0.1, unit: 'mm',
      help: 'Measure your sheet, the slots are cut to match it.',
    },
    {
      kind: 'number', key: 'kerf', label: 'Kerf', section: 'Assembly', value: 0.18, min: 0, max: 0.5, step: 0.01, unit: 'mm',
      help: 'How much material your laser burns away per pass.',
    },
    {
      kind: 'select', key: 'fit', label: 'Fit', section: 'Assembly', value: 'snug',
      options: [{ value: 'tight', label: 'Tight' }, { value: 'snug', label: 'Snug' }, { value: 'easy', label: 'Easy' }],
      help: 'Snug holds by thumb pressure, Easy allows for a sheet that varies.',
    },
    // ------------------------------------------------------------------ LEFT: "More" --
    {
      kind: 'number', key: 'lean', label: 'Lean', section: 'Stand', value: 67, min: 60, max: 72, step: 1, unit: '°', advanced: true,
      help: 'How far back the phone leans off the table.',
    },
  ],

  async build(v) {
    const width = clamp(num(v, 'width'), 24, 300);
    const height = clamp(num(v, 'height'), 50, 400);
    const t = clamp(num(v, 'thickness'), 0.5, 20);
    const kerf = clamp(num(v, 'kerf'), 0, 2);

    // ------------------------------------------------------------------- the stand --
    const g = crossStandGeometry({ width, height, t, kerf, lean: leanOf(v), clearance: FIT[str(v, 'fit')] ?? FIT.snug });

    // -------------------------------------------------------------------- the name --
    // Sized off the lip it sits on, never off a constant: the same stand at 50 mm and at 120 mm
    // wide gets lettering in the same proportion.
    const box = g.content;
    const boxH = Math.max(0, box.maxY - box.minY);
    const symbols = readSymbols(v);
    const font = str(v, 'font');
    const text = str(v, 'text');
    const nameSize = clamp(0.32 * boxH, 4, 14);
    const symSize = clamp(0.5 * boxH, 6, 22);

    const mark = await symbolLayer(str(v, 'symbol'), symSize, 'engrave', { symbols }, 'symbol');
    let name = await textLayer({ symbols, text, font, size: nameSize }, 'engrave', 'name', 'Name');
    // The name hangs off the symbol's MEASURED box, not off `symSize`: a wide mark and a tall one
    // do not put their name in the same place.
    if (name.length && mark.length) {
      const mb = boxOf(mark);
      const nb = boxOf(name);
      const to: Pt = [(mb.minX + mb.maxX) / 2, mb.minY - nameSize * 0.45 - (nb.maxY - nb.minY) / 2];
      const from = centreOf(nb);
      name = move(name, to[0] - from[0], to[1] - from[1]);
    }

    let block = [...mark, ...name];
    let fit = 1;
    if (block.length && boxH > 0) {
      const centre = centreOf(box);
      const c = centreOf(boxOf(block));
      block = move(block, centre[0] - c[0], centre[1] - c[1]);
      const b = boxOf(block);
      fit = fitBoxInside(rectShapes(box), centre, [(b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2], 0, null);
      if (fit < 0.999) block = scaleAbout(block, Math.max(0.05, fit), centre);
    }

    // ------------------------------------------------------------------ the pieces --
    const pieces = crossStandPieces(g, { front: block });

    // ------------------------------------------------------------------ what to say --
    // The facility's first: whether the thing stands up outranks how the name came out.
    const warnings = [...g.warnings];
    if (name.length && fit < 0.75) warnings.push(`The name was shrunk to ${round1(nameSize * fit)} mm to fit the lip.`);
    if (name.length && nameSize * fit < MIN_CAP) {
      warnings.push('Below about 5 mm, thin and script fonts break up when engraved. Pick a bolder face or a taller stand.');
    }

    return {
      ...pieces,
      keyring: noRing(),
      ...(warnings.length ? { warnings } : {}),
    };
  },

  fileName: (v: Values) => stem(str(v, 'text') || 'phone-stand', 'stand'),

  exportNote: 'Slide the two pieces together at a right angle, the engraved one at the front.',
};
