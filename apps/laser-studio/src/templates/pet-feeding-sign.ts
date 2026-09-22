import { readSymbols, type InlineSymbol } from '../symbols/model';
// A sign for the bowls: a bone-shaped plaque with the pet's name big, two little dishes and
// "Food · Water" under it, and one way of hanging it on the wall.
//
// It used to be a rounded rectangle with the name dead-centred on both axes and TWO unrelated
// hanging systems (a screw-hole toggle and the shared Keyring section), which is the textbook
// "generic plaque generator" the research names by name. Three things changed and they are the
// design: the silhouette is a pet-department shape by default, the second line carries a dish
// either side of it so the sign says what it is without reading it, and Mounting is one control
// with one answer — two screws, four screws, a keyhole, or nothing.
//
// The holes are the design's own cut rings, not a keyring: a sign hangs from two points, and
// one hole lets it swing. Where they land is decided against the real outline, not the bounding
// box — on a bone the box's top corners are thin air.
import { bboxOf, circleRing, placeShapes, roundedRectRing, type Pt, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { insideUnion, unionOutlineDistance } from '../engine/editorGeometry';
import { applyCase } from '../engine/text';
import type { DesignLayer, KeyringSpec } from '../engine/types';
import { blankDetailLayers, blankShapes, blankTextBox, fitStackedText, letteringFields, opField, opOf, shapeFields, stem } from './shared';
import { bool, num, str, type TemplateDef, type Values } from './types';

/** Faces that hold up at both ends of this sign — a 20 mm name across a room and a caption at
 *  half that. Each was built as "555 0100" at a 3 mm cap and its narrowest counter measured;
 *  everything listed clears 0.69 mm, so nothing on it chars shut. Rounded display faces first
 *  (what a pet sign wants), two plain sans at the end for a caption that has to stay crisp. */
const READS_BIG_AND_SMALL = ['luckiest-guy', 'fredoka', 'baloo-2', 'lilita-one', 'chewy', 'paytone-one', 'oswald', 'montserrat'];

/** Faces for the CAPTION, which is a different job from the name: it is a label, read from nearer,
 *  at under half the name's height, and it should not compete with the display face above it. Each
 *  was built as "FOOD · WATER" at this sign's default caption height and looked at; the small-caps
 *  sans leads because a label in small capitals is what a shop sign does. */
const CAPTION_FACES = ['alegreya-sans-sc', 'montserrat', 'oswald', 'archivo', 'work-sans', 'figtree', 'josefin-sans', 'inter'];

/** The sign has no keyring — Mounting is the one hanging control — but the fit still wants to
 *  know there is no hole to dodge. */
const noRing = (): KeyringSpec => ({ enabled: false, mode: 'inside', side: 'top', along: 0.5, dia: 4, ring: 2.5, position: -1 });

// ------------------------------------------------------------------- the dishes --

/**
 * A feeding dish in the unit box a symbol glyph lives in: it flares from a rounded base to a
 * wide rim, which is what separates a bowl from a cup or a plate at 9 mm across.
 *
 * Drawn here rather than picked from the icon library because the library has no bowl (its
 * nearest glyph is a chess pawn), and parametric rather than pasted path data, like every other
 * shape in this app.
 */
function bowlRing(): CutRing {
  const rimX = 0.5, rimY = 0.22, waistX = 0.34, waistY = -0.1, floor = -0.28;
  const bend = (from: Pt, corner: Pt, to: Pt): Pt[] => {
    const out: Pt[] = [];
    for (let i = 1; i < 12; i++) {
      const t = i / 12;
      const u = 1 - t;
      out.push([u * u * from[0] + 2 * u * t * corner[0] + t * t * to[0], u * u * from[1] + 2 * u * t * corner[1] + t * t * to[1]]);
    }
    return out;
  };
  return [
    [-rimX, rimY],
    [-waistX, waistY],
    // One wide sweep for the belly, not two corner fillets: a dish is a curve, and at 10 mm
    // across a pair of filleted corners on a straight bottom reads as a plant pot.
    ...bend([-waistX, waistY], [0, floor - 0.14], [waistX, waistY]),
    [rimX, rimY],
  ];
}

/** The private-use character the dish is typed as. Well clear of 0xF0000, where the symbol
 *  picker starts handing out codes, so a customer's own inline symbols never collide with it. */
const BOWL_CHAR = String.fromCodePoint(0xf0f00);

/** The dish as an inline glyph — 88 % of the em, so about two thirds the cap height beside it.
 *
 *  Typed into the second line rather than placed as its own layer on purpose: that way ONE fit
 *  scales the name, the dishes and the words together, and the ornament cannot drift out of the
 *  line the moment the fit moves the block. */
const BOWL_SYMBOL: InlineSymbol = {
  id: 'feeding-bowl', label: 'Bowl', source: 'Vostok Labs', char: BOWL_CHAR,
  shapes: [[bowlRing()]] as Shapes, scale: 0.88, dx: 0, dy: -0.02, rotation: 0,
};

// ------------------------------------------------------------------ the mounting --

type Mount = 'screws2' | 'screws4' | 'keyhole' | 'none';
const mountOf = (v: Values): Mount => {
  const m = str(v, 'mount');
  return m === 'screws4' || m === 'keyhole' || m === 'none' ? m : 'screws2';
};

/** Where the screws want to be on a w × h part: in from the top corners, or all four. */
function mountPoints(w: number, h: number, inset: number, count: 2 | 4): Pt[] {
  const x = Math.max(1, w / 2 - inset);
  const y = Math.max(1, h / 2 - inset);
  return count === 2 ? [[-x, y], [x, y]] : [[-x, y], [x, y], [-x, -y], [x, -y]];
}

/**
 * The same point, moved in until the material can hold a hole of that size.
 *
 * `mountHoles` clamps against the straight edges of the bounding box and nothing else, so a
 * rounded corner ate the hole at the corner slider's own maximum — the "hole" stopped being a
 * closed island and opened into the outline, leaving a scallop bite with nothing for a screw to
 * seat against. Measuring the real outline instead fixes that case and every other one: a bone's
 * corners are empty air, and this walks the hole into the lobe.
 */
function seatInside(shapes: Shapes, p: Pt, clearance: number): Pt | null {
  const legal = (q: Pt) => insideUnion(shapes, q) && unionOutlineDistance(shapes, q) >= clearance;
  if (legal(p)) return p;
  const steps = 60;
  for (let i = 1; i <= steps; i++) {
    const t = 1 - i / steps;
    const q: Pt = [p[0] * t, p[1] * t];
    if (legal(q)) return q;
  }
  return null;
}

/** A keyhole hanger: the screw head goes through the round part, then the sign drops and the
 *  shank rides up the slot. Round below, slot above — the other way round and it falls off. */
function keyholeShapes(centre: Pt, dia: number): Shapes {
  const head = dia * 2;
  const slot = dia * 1.15;
  const run = dia * 1.8;
  return [
    [circleRing(centre[0], centre[1], head / 2, 32)],
    [placeShapes([[roundedRectRing(slot, run, slot / 2)]], centre[0], centre[1] + run / 2, 0)[0]![0]!],
  ];
}

export const petFeedingSign: TemplateDef = {
  id: 'pet-feeding-sign',
  name: 'Pet feeding sign',
  blurb: 'A bone-shaped sign for the bowl station: the name big, two dishes under it.',
  tags: ['sign', 'engrave + cut'],
  batch: { key: 'text', noun: 'sign' },
  fields: [
    { kind: 'text', key: 'text', label: 'Pet name', panel: 'right', section: 'Text', value: 'Biscuit', placeholder: 'Their name', maxLength: 18, symbols: true },
    { kind: 'text', key: 'line2', label: 'Under the name', panel: 'right', section: 'Text', value: 'Food · Water', placeholder: 'Optional', maxLength: 26 },
    { kind: 'font', key: 'font', label: 'Name font', panel: 'right', section: 'Font', value: 'luckiest-guy', recommended: READS_BIG_AND_SMALL },
    // Two roles, two faces (review finding 11): the name is the display line and the caption is a
    // label, and one picker for both meant "Food · Water" came out in the same fat rounded face as
    // "BISCUIT" at 45 % of its height, where its counters are the first thing to shut.
    {
      kind: 'font', key: 'line2Font', label: 'Caption font', panel: 'right', section: 'Font', value: 'alegreya-sans-sc', recommended: CAPTION_FACES,
      help: 'Pick the name’s own face here to match them.',
    },
    // The Tags shelf is where the bone lives, and it is why this template opens on a pet shape
    // instead of the library's plainest rounded rectangle. Keychain-scale silhouettes are left
    // out: they carry the second Heart and the second Hexagon, and a 35 mm disc is not a sign.
    // Corner radius stops at 45 % of this design's own short side (G25), not a flat 30 mm.
    ...shapeFields({ value: 'bone', categories: ['tags', 'coasters', 'shapes'], width: 200, height: 120, corner: 8, minWidth: 110, maxWidth: 400, minHeight: 65, maxHeight: 400, maxCorner: 54 }),
    { kind: 'number', key: 'size', label: 'Name size', section: 'Lettering', value: 26, min: 6, max: 80, step: 0.5, unit: 'mm', help: 'Shrinks with the caption line to keep them in proportion.' },
    { kind: 'number', key: 'line2Scale', label: 'Second line size', section: 'Lettering', value: 0.45, min: 0.25, max: 0.6, step: 0.05, format: (v) => `${Math.round(v * 100)}% of the name`, help: 'Also sets the size of the dishes beside it.' },
    { kind: 'toggle', key: 'bowls', label: 'Dishes', section: 'Lettering', value: true, help: 'Adds a small dish icon either side of the second line.' },
    // Nudged by the COMPOSITION, not by an offset: the name is the dominant line and it sits
    // above the caption, so centring the block puts the name's own centre about 6 % of the
    // sign's height above the geometric middle — which is the optical centre the research asks
    // for (`02-layout-typography.md` §3.3). A blind +5 mm on top of that would only take 6 mm
    // off the name, because a bone's waist is the ceiling. The bone is also mirror-symmetric
    // top to bottom, where the checklist waives the rule outright.
    { kind: 'position', key: 'offsetX', keyY: 'offsetY', label: 'Text position', section: 'Lettering', value: 0, valueY: 0, max: 100, step: 0.5, unit: 'mm', help: 'Moves the name and the line under it together.' },
    opField('Lettering'),
    ...letteringFields('Lettering'),
    {
      kind: 'select', key: 'mount', label: 'Hanging', section: 'Mounting', value: 'screws2',
      options: [{ value: 'screws2', label: 'Two screws' }, { value: 'screws4', label: 'Four screws' }, { value: 'keyhole', label: 'Keyhole' }, { value: 'none', label: 'None' }],
      help: 'A keyhole hides its screw behind the sign, unlike the others.',
    },
    { kind: 'number', key: 'screwDia', label: 'Screw hole', section: 'Mounting', value: 4, min: 2.5, max: 10, step: 0.5, unit: 'mm', help: 'The shank width, not the head, about 3 mm for a wood screw.', visibleWhen: (v) => mountOf(v) !== 'none' },
    { kind: 'number', key: 'screwInset', label: 'Hole inset', section: 'Mounting', value: 30, min: 6, max: 40, step: 0.5, unit: 'mm', help: 'Moves in further on its own to stay on solid material.', visibleWhen: (v) => mountOf(v) === 'screws2' || mountOf(v) === 'screws4' },
  ],
  async build(v) {
    const shapes = blankShapes(v, 'bone');
    const op = opOf(v);
    const warnings: string[] = [];
    const width = num(v, 'width');
    const height = num(v, 'height');
    const mount = mountOf(v);
    const dia = num(v, 'screwDia');

    // The holes are placed FIRST, because the lettering has to keep away from them: the old
    // template let "Hole inset" park a screw squarely on the B of the name with nothing to say
    // about it. `avoid` is the same mechanism that keeps a name off a football's laces.
    const holes: Shapes = [];
    // How far the lettering steps down to make room for a keyhole. One keyhole has to sit on the
    // sign's own centreline or it hangs crooked, so on a shape whose top-centre is narrow — a
    // bone's shaft — it lands where the name wants to be. `avoid` alone will not save it: the fit
    // abandons a dodge that costs more than half the size the shape allows and lets the overlap
    // happen instead, by design. Moving the block first makes the dodge cheap.
    let drop = 0;
    if (mount === 'keyhole') {
      // The clearance is measured from the keyhole's CENTRE, so it has to cover the slot's whole
      // run upwards (1.8 × the hole) plus a wall — otherwise the slot opens through the top edge
      // and the sign has nothing to hang on.
      const reach = dia * 1.8 + Math.max(3, dia);
      // Half of what the keyhole took out of the top: the block ends up centred in what is left.
      const seat = seatInside(shapes, [0, height / 2], reach);
      if (seat) { holes.push(...keyholeShapes(seat, dia)); drop = (reach + dia) / 2; }
      else warnings.push('There is no room for a keyhole that size — make the hole smaller or the sign bigger.');
    } else if (mount !== 'none') {
      const wanted = mountPoints(width, height, num(v, 'screwInset'), mount === 'screws4' ? 4 : 2);
      // A screw under load tears out through a thin wall, so the material round the hole is
      // sized from the hole, not from a constant: 1.5 × its diameter, never under 4 mm.
      for (const p of wanted) {
        const seat = seatInside(shapes, p, dia / 2 + Math.max(4, dia * 1.5));
        if (seat) holes.push([circleRing(seat[0], seat[1], dia / 2, 32)]);
      }
      if (holes.length < wanted.length) warnings.push('There is no room for a screw hole that size — make the hole smaller or the sign bigger.');
    }

    const marks = blankDetailLayers(v, op === 'score' ? { score: 'score' } : { engrave: 'engrave' });
    const avoid = [...marks.flatMap((l) => l.shapes), ...holes];

    const textCase = str(v, 'textCase');
    const size = num(v, 'size');
    const caption = applyCase(str(v, 'line2'), textCase);
    const rows = [
      { text: applyCase(str(v, 'text'), textCase), size },
      { text: bool(v, 'bowls') ? `${BOWL_CHAR} ${caption} ${BOWL_CHAR}`.trim() : caption, size: size * num(v, 'line2Scale'), gap: 0.5, font: str(v, 'line2Font') },
    ];
    const text = await fitStackedText(
      rows,
      {
        symbols: { ...readSymbols(v), ...(bool(v, 'bowls') ? { [BOWL_CHAR]: BOWL_SYMBOL } : {}) },
        font: str(v, 'font'),
        // `letteringFields` is a percentage of the letter height; `TextSpec` wants the fraction.
        letterSpacing: num(v, 'letterSpacing') / 100,
        x: num(v, 'offsetX'),
        y: num(v, 'offsetY') - drop,
      },
      op,
      shapes,
      noRing(),
      'design',
      'Text',
      // 6 mm of margin, not the house 4. The research scales the margin with the piece (3–4 % of
      // the short side, so 3.6–4.8 mm at 120) and this goes a little past the top of that band on
      // purpose: the shaft's edge is a curve, the name runs its full width, and a sign read from
      // across a kitchen wants the band to be visible, not merely safe.
      { inset: 6, home: blankTextBox(v, 'bone'), warnings, ...(avoid.length ? { avoid } : {}) },
    );

    // The net under `avoid`: when clearing a hole would have cost more than half the size the
    // sign allows, the fit keeps the size and lets them overlap rather than shrinking the name to
    // a speck — a deliberate choice, but the customer has to be told it happened.
    const ink = text.flatMap((l) => l.shapes);
    // Hole by hole, never the set: four holes at the corners share a bounding box that swallows
    // the whole sign, so testing the group is a warning on every four-screw build.
    if (holes.length && ink.length) {
      const b = bboxOf(ink);
      const hits = holes.some((island) => {
        const a = bboxOf([island]);
        return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
      });
      if (hits) warnings.push(`The ${mount === 'keyhole' ? 'keyhole sits' : 'screw holes sit'} on the lettering — move the text, or bring the holes in.`);
    }

    const layers: DesignLayer[] = [...marks, ...text];
    if (holes.length) layers.push({ id: 'mount', label: mount === 'keyhole' ? 'Keyhole' : 'Screw holes', shapes: holes, op: 'cut' });
    return { blank: { kind: 'shape', shapes }, keyring: noRing(), layers, ...(warnings.length ? { warnings } : {}) };
  },
  fileName: (v) => stem(str(v, 'text') || 'pet', 'feeding-sign'),
  exportNote: (v) => {
    const mount = mountOf(v);
    if (mount === 'none') return 'No holes on this one, stand it against the wall behind the bowls or use mounting tape.';
    if (mount === 'keyhole') return 'Drive the screw until its head stands 3 mm proud, then hang the sign on the keyhole.';
    return `${mount === 'screws4' ? 'Four' : 'Two'} screw holes at ${num(v, 'screwDia')} mm, mark them through the piece before drilling the wall.`;
  },
};
