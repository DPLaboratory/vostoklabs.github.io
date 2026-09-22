import { readSymbols, type SymbolMap } from '../symbols/model';
// A business card cut from the material its maker sells: a decorative cut-through band down one
// third, a logo, and four engraved lines with a real hierarchy. Design:
// docs/briefs/laser-studio-templates/business-card.design.md.
//
// What a static SVG cannot do, and why this is a generator rather than a download:
//
//   THE BAND resizes its own cells and walls to the card it is on. A fixed vector cut at one
//   size comes out scrap-thin at another; here the tiling pitch is fixed, the WALL between cells
//   is fixed at 1.5 mm, and the cell is the tiling shape shrunk by the wall — so every wall is
//   1.5 mm at 25 % of an 85 mm card and at 35 % of a 90 mm one, and the count of cells changes
//   instead of their strength. The band is a `cut` layer with `stencil: false`: the cells are
//   MEANT to fall out, they are the pattern.
//
//   THE HIERARCHY is one number. `nameSize` is a cap height, and title / phone / third line are
//   0.6 and 0.45 of it, floored at 2.5 mm so the phone number — the line a stranger actually
//   needs — never shrinks into decoration. Then the whole lockup, logo included, is measured and
//   scaled by ONE factor to fit the column beside the band, so a long name shrinks the card's
//   type together rather than clipping one line.
//
//   THE RUN is a team. `batch: { key: 'name' }` builds one card per name on one sheet with the
//   title, phone and pattern typed once.
import { bboxOf, circleRing, placeShapes, polygonRing, roundPolygonRing, roundedRectRing, type Box, type Pt, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { applyCase, symbolLayer, textLayer } from '../engine/text';
import { sizeForCapHeight } from '../engine/metrics';
import type { DesignLayer, OpChoice } from '../engine/types';
import { stem } from './shared';
import { bool, num, str, type TemplateDef, type Values } from './types';

/** The three real business-card dimensions, mm. */
const SIZES: Record<string, [number, number]> = { '85x55': [85, 55], '89x51': [89, 51], '90x50': [90, 50] };
const DEFAULT_SIZE = '85x55';

/** Air between anything printed or cut and the card's edge (`05-premium-vs-cheap.md` §2's
 *  sourced 3–5 mm safe zone, at the generous end for a piece this small). */
const MARGIN = 4;
/** The band's own, tighter clearance from the text column — not a substitute for MARGIN. */
const GUTTER = 3;

/**
 * The material left standing between two cells of the band, mm, as drawn.
 *
 * The assignment's floor is 1 mm; this is that plus a kerf margin. At the worst bundled kerf
 * (0.40 mm) a wall this wide still finishes ≥ 1.1 mm after both flanking cuts eat into it; at
 * 3 mm ply's 0.18 mm it finishes ≥ 1.3 mm. Lighter than the general "isolated webs ≥ material
 * thickness" rule on purpose: no wall here is isolated — every one sits inside a mesh anchored
 * to solid card 4 mm clear of any edge a hand touches. Nothing joints to this band, so unlike
 * `slots.ts`'s `slotWidth` it needs no material to derive itself from.
 */
const WALL = 1.5;
/** No interior corner at zero radius (`05-premium-vs-cheap.md` checklist item 3). */
const FILLET = 0.5;

/** Hexagons: the TILING hexagon's vertex radius, mm. The open cell is this minus the wall. */
const HEX_A = 3;
/** Lattice: the square pitch of the diamond holes, mm. */
const LATTICE_PITCH = 5;
/** Circles: the hex-offset packing pitch, mm (the traditional perforated-panel layout). */
const CIRCLE_PITCH = 4.5;

/** The name : subtitle : tertiary ladder (`02-layout-typography.md` §3.1's sourced badge ratio). */
const TITLE_RATIO = 0.6;
const DETAIL_RATIO = 0.45;
/** The detail lines' floor, mm of cap: below this a phone number is decoration (§2). */
const DETAIL_FLOOR = 2.5;

/**
 * The cap height at which the name warns, mm.
 *
 * The design doc warns below 4 mm — which is the NAME HEIGHT SLIDER's own minimum, not a
 * legibility number, and the doc reached for it believing the fit would leave `k` at 1 for an
 * ordinary name. Measured, it does not: "MORGAN VALE" at the doc's own 6 mm default is 65 mm of
 * Montserrat in a 48.5 mm column, so every name past about thirteen capitals lands under 4 mm.
 * Warning there would fire on most real names while the card itself is fine.
 *
 * So the warning sits on the house's own legibility floor instead — 3 mm of capital, the figure
 * `00-context.md` §1.2 gives for engraved text and `shared.ts`'s `fitText` uses as `minCap`. The
 * doc's 4 mm keeps its real job: the DEFAULT build must clear it, and the node suite asserts
 * that it does — a default that shrinks its own name past the slider's floor is a bad default,
 * not a bad warning.
 */
const READABLE_CAP = 3;
/** The thinnest line that survives a burn (`00-context.md` §1.2). */
const MIN_STROKE = 0.3;
/** How far above true centre the block sits, as a share of the column's height — the optical
 *  centre is 44–48 % from the top, not 50 (`05-premium-vs-cheap.md` §2). */
const OPTICAL_LIFT = 0.04;

/**
 * What a name too long for its column says.
 *
 * NOT the design doc's "shorten it, lower Name height, or narrow the pattern band": the middle
 * clause is advice that cannot work. The name's height is `min(Name height, what the column
 * holds)`, so once the column binds — which is what this warning means — turning Name height
 * down changes nothing at all. The three things that DO change it are what it offers.
 */
const FIT_WARNING = 'This name is too long for the column beside the pattern — shorten it, narrow the band, or turn the pattern off.';
const EMPTY_WARNING = 'Type a name to see it on the card.';

/**
 * Faces that hold up at this card's floors, each built here at `nameSize = 4` / detail 2.5 mm
 * and looked at before it went on the list (G2).
 *
 * Montserrat is legible at 2.5 mm but the thinnest sans tested; Inter is visibly sturdier at the
 * same size; Archivo Black is the most legible of all and the confident choice under UPPERCASE.
 * Libre Baskerville is offered for the name's character rather than the floor. Alegreya Sans SC
 * renders true small-caps forms from lower-case input — pick the face and leave Capitalise at
 * "As typed". Lora was tested and dropped: its hairline serifs were already thinning at 4 mm.
 */
const READS_SMALL = ['montserrat', 'inter', 'archivo-black', 'manrope', 'libre-baskerville', 'alegreya-sans-sc'];

const hasPattern = (v: Values) => str(v, 'pattern') !== 'none';

// ------------------------------------------------------------------- the card and its band --

/** How far a point is inside a rounded rectangle's outline, mm. Negative outside. */
function insetDepth(p: Pt, w: number, h: number, r: number): number {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const dx = Math.abs(p[0]) - (w / 2 - rr);
  const dy = Math.abs(p[1]) - (h / 2 - rr);
  if (dx <= 0 && dy <= 0) return Math.min(w / 2 - Math.abs(p[0]), h / 2 - Math.abs(p[1]));
  return rr - Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
}

/** The rectangle the band tiles into: `bandWidth` wide, MARGIN clear of three card edges. */
function bandBox(w: number, h: number, bandWidth: number, side: string): Box {
  const outer = w / 2 - MARGIN;
  const [minX, maxX] = side === 'left' ? [-outer, -outer + bandWidth] : [outer - bandWidth, outer];
  return { minX, maxX, minY: -h / 2 + MARGIN, maxY: h / 2 - MARGIN };
}

/** Where the four lines start and end, mm — the band's width goes to the column when there is
 *  no band, so a card with the pattern off does not read as a template with a feature missing. */
function columnBox(w: number, h: number, bandWidth: number, side: string, pattern: string): Box {
  const inner = w / 2 - MARGIN;
  if (pattern === 'none') return { minX: -inner, maxX: inner, minY: -h / 2 + MARGIN, maxY: h / 2 - MARGIN };
  const band = bandBox(w, h, bandWidth, side);
  const [minX, maxX] = side === 'left' ? [band.maxX + GUTTER, inner] : [-inner, band.minX - GUTTER];
  return { minX, maxX, minY: -h / 2 + MARGIN, maxY: h / 2 - MARGIN };
}

interface TileSpec {
  /** Centre-to-centre spacing along each axis, mm. */
  pitchX: number;
  pitchY: number;
  /** How far an odd row is shifted along x, mm. 0 for a plain square grid. */
  shift: number;
  /** The cell's own bounding box, mm, before any fillet (the fillet only ever shrinks it). */
  cellW: number;
  cellH: number;
  ring(cx: number, cy: number): CutRing;
}

/**
 * The one grid walk all three constructions share.
 *
 * Rows are centred in the band and columns are anchored so that the WHOLE pattern — the shifted
 * rows included — is centred too, which is why the used width is the wider of the two row kinds
 * rather than either one. Per-row centring would be prettier and is a bug: two rows of the same
 * count would land on the same x, and a hex row directly above its neighbour leaves a 0.2 mm
 * wall instead of 1.5.
 *
 * A cell is kept only when every one of its vertices is at least MARGIN inside the card's real
 * outline, so a band beside a 6 mm corner radius gives its corner cell up rather than creeping
 * to 3.2 mm of the edge on the diagonal.
 */
function tileBand(band: Box, spec: TileSpec, inside: (p: Pt) => boolean): Shapes {
  const bw = band.maxX - band.minX;
  const bh = band.maxY - band.minY;
  const cols = Math.floor((bw - spec.cellW) / spec.pitchX) + 1;
  const rows = Math.floor((bh - spec.cellH) / spec.pitchY) + 1;
  if (cols < 1 || rows < 1) return [];
  const oddCols = spec.shift > 0 ? Math.max(0, Math.floor((bw - spec.cellW - spec.shift) / spec.pitchX) + 1) : cols;
  const usedW = Math.max(
    (cols - 1) * spec.pitchX + spec.cellW,
    oddCols > 0 ? spec.shift + (oddCols - 1) * spec.pitchX + spec.cellW : 0,
  );
  const usedH = (rows - 1) * spec.pitchY + spec.cellH;
  const x0 = band.minX + (bw - usedW) / 2 + spec.cellW / 2;
  const y0 = band.minY + (bh - usedH) / 2 + spec.cellH / 2;

  const out: Shapes = [];
  for (let j = 0; j < rows; j++) {
    const odd = spec.shift > 0 && j % 2 === 1;
    const n = odd ? oddCols : cols;
    for (let i = 0; i < n; i++) {
      const ring = spec.ring(x0 + (odd ? spec.shift : 0) + i * spec.pitchX, y0 + j * spec.pitchY);
      if (ring.every(inside)) out.push([ring]);
    }
  }
  return out;
}

const at = (ring: CutRing, cx: number, cy: number): CutRing => ring.map(([x, y]): Pt => [x + cx, y + cy]);

/**
 * The band's holes.
 *
 * Every construction is closed-form against `@vostok/laser`'s existing primitives — no traced
 * artwork, no new engine capability (`04-decorative-vocabulary.md` §3.1 / §3.8 / §9.1 all carry
 * a "pure geometry" verdict), with tiling numbers sized to a band 25 mm wide rather than the
 * source document's 100–300 mm panels.
 */
function patternCells(kind: string, band: Box, inside: (p: Pt) => boolean): Shapes {
  if (kind === 'hexagons') {
    // Pointy-top hexagons on the honeycomb lattice: Δx = √3·a, Δy = 1.5·a, odd rows shifted a
    // half pitch. Every neighbour — sideways and diagonal — is √3·a away, flat facing flat, so
    // shrinking the tiling hexagon's vertex radius by wall/√3 leaves exactly `WALL` everywhere.
    //
    // `polygonRing(w, h, 6)` fits the polygon to the BOX it is given, so a regular hexagon of
    // vertex radius r is asked for as √3·r wide by 2·r tall — not 2r × 2r, which would stretch
    // every cell 15 % sideways and weld it to its neighbour.
    const r = HEX_A - WALL / Math.sqrt(3);
    const cell = roundPolygonRing(polygonRing(Math.sqrt(3) * r, 2 * r, 6), FILLET);
    return tileBand(band, {
      pitchX: Math.sqrt(3) * HEX_A, pitchY: 1.5 * HEX_A, shift: (Math.sqrt(3) * HEX_A) / 2,
      cellW: Math.sqrt(3) * r, cellH: 2 * r, ring: (cx, cy) => at(cell, cx, cy),
    }, inside);
  }
  if (kind === 'lattice') {
    // A square grid of diamond HOLES, not the two clipped families of struts of §9.1: one
    // primitive instead of two, the same connected mesh, and provably safe — the closest
    // approach between two axis-aligned diamonds on pitch s is vertex to vertex, s − d.
    const d = LATTICE_PITCH - WALL;
    const cell = roundPolygonRing(polygonRing(d, d, 4), FILLET);
    return tileBand(band, {
      pitchX: LATTICE_PITCH, pitchY: LATTICE_PITCH, shift: 0,
      cellW: d, cellH: d, ring: (cx, cy) => at(cell, cx, cy),
    }, inside);
  }
  if (kind === 'circles') {
    // Hex-offset packing, the perforated-panel layout, at one fixed size rather than §3.8's
    // tonal gradient. Sideways and diagonal neighbours are both `c` apart, so one gap: c − d.
    const d = CIRCLE_PITCH - WALL;
    return tileBand(band, {
      pitchX: CIRCLE_PITCH, pitchY: (CIRCLE_PITCH * Math.sqrt(3)) / 2, shift: CIRCLE_PITCH / 2,
      cellW: d, cellH: d, ring: (cx, cy) => circleRing(cx, cy, d / 2, 24),
    }, inside);
  }
  return [];
}

// ---------------------------------------------------------------------------- the lettering --

const move = (layers: DesignLayer[], dx: number, dy: number): DesignLayer[] =>
  layers.map((l) => ({ ...l, shapes: placeShapes(l.shapes, dx, dy, 0) }));

interface Lockup {
  /** Left edge at x = 0, vertical centre at y = 0. */
  layers: DesignLayer[];
  width: number;
  height: number;
  /** The name's cap height as rebuilt, mm — 0 when there is no name. */
  nameCap: number;
}

/**
 * Logo, name, rule, title, phone and the third line as one block at scale `k`.
 *
 * Each line is built and MEASURED rather than trusted to its slider: cap height, a descender on
 * a "g" and an empty row all move a block that assumes. That is also why this does not go
 * through `stackedText` — the hierarchy needs each line's own box before anything is stacked,
 * and every line is flush LEFT rather than centred (`02-layout-typography.md` §3.4: a centred
 * detail block reads ragged on both edges). The gap above a row is `stackedText`'s own
 * convention, 0.45 × that row's size, so this block sits like every other stacked template's.
 */
async function buildLockup(v: Values, k: number, op: OpChoice, symbols: SymbolMap, floors = true): Promise<Lockup> {
  const font = str(v, 'font');
  const track = num(v, 'letterSpacing') / 100;
  const asked = num(v, 'nameSize');
  // The 2.5 mm clamp applies to the ratio AND to the shrink: a phone number is the one line a
  // stranger has to read, and the design's own floor is not a floor if `k` may walk it under.
  //
  // But a floor that outgrows the line above it turns the ladder upside down — a 29-character
  // name shrinks to 1.7 mm while the job title holds at 2.5, and the card's one large element is
  // its smallest. So each floor is capped by the line above: the hierarchy is the design, and it
  // survives every scale even where legibility cannot. (`floors: false` drops both — see
  // `build()`, where a floored detail line is what overflows the column.)
  const nameCap = asked * k;
  const hold = (cap: number, ceiling: number) => (floors ? Math.min(ceiling, Math.max(DETAIL_FLOOR, cap)) : cap);
  const titleCap = hold(TITLE_RATIO * asked * k, nameCap);
  const detailCap = hold(DETAIL_RATIO * asked * k, titleCap);
  const [nameEm, titleEm, detailEm] = await Promise.all([
    sizeForCapHeight(font, nameCap), sizeForCapHeight(font, titleCap), sizeForCapHeight(font, detailCap),
  ]);

  const rows: { layers: DesignLayer[]; box: Box; gap: number }[] = [];
  const push = (layers: DesignLayer[], gap: number) => {
    const shapes = layers.flatMap((l) => l.shapes);
    if (!shapes.length) return;
    rows.push({ layers, box: bboxOf(shapes), gap: rows.length ? gap : 0 });
  };
  const line = (text: string, size: number, id: string, label: string) =>
    text.trim() ? textLayer({ text, font, size, letterSpacing: track, symbols }, op, id, label) : Promise.resolve([]);

  const logo = str(v, 'logo');
  if (logo) push(await symbolLayer(logo, num(v, 'logoSize') * k, op, { symbols }, 'logo'), 0.45 * nameEm);

  const name = await line(applyCase(str(v, 'name'), str(v, 'textCase')), nameEm, 'name', 'Name');
  push(name, 0.45 * nameEm);

  // The rule is measured off the name it divides, never off the slider: 45 % of the longer
  // neighbour, a stroke a tenth of the smaller one's cap, a gap 0.6 of it above and below
  // (`02-layout-typography.md` §5.1). At hairline thickness a filled bar and a scored outline of
  // one read alike, so it takes the same op as the text and needs no open-path plumbing.
  let ruled = false;
  if (bool(v, 'rule') && name.length) {
    const nb = bboxOf(name.flatMap((l) => l.shapes));
    const width = 0.45 * (nb.maxX - nb.minX);
    const stroke = Math.max(MIN_STROKE, 0.1 * titleCap);
    if (width > stroke) {
      push([{ id: 'rule', label: 'Rule', shapes: [[roundedRectRing(width, stroke, stroke / 2, 4)]], op }], 0.6 * titleCap);
      ruled = true;
    }
  }

  push(await line(str(v, 'title'), titleEm, 'title', 'Title'), ruled ? 0.6 * titleCap : 0.45 * titleEm);
  push(await line(str(v, 'phone'), detailEm, 'phone', 'Phone'), 0.45 * detailEm);
  push(await line(str(v, 'line4'), detailEm, 'line4', 'Third line'), 0.45 * detailEm);
  if (!rows.length) return { layers: [], width: 0, height: 0, nameCap: 0 };

  const heights = rows.map((r) => r.box.maxY - r.box.minY);
  const height = heights.reduce((a, b) => a + b, 0) + rows.reduce((a, r) => a + r.gap, 0);
  const width = Math.max(...rows.map((r) => r.box.maxX - r.box.minX));
  const layers: DesignLayer[] = [];
  let top = height / 2;
  rows.forEach((r, i) => {
    top -= r.gap;
    const h = heights[i]!;
    layers.push(...move(r.layers, -r.box.minX, top - h / 2 - (r.box.minY + r.box.maxY) / 2));
    top -= h;
  });
  return { layers, width, height, nameCap: name.length ? nameCap : 0 };
}

// --------------------------------------------------------------------------------- the form --

export const businessCard: TemplateDef = {
  id: 'business-card',
  name: 'Business card',
  blurb: 'A wood or acrylic card with a cut pattern band, your logo and up to four lines — one, or a whole team’s list at once.',
  tags: ['card', 'engrave + cut'],
  batch: { key: 'name', noun: 'card' },
  exportNote: (v) => (hasPattern(v)
    ? 'The pattern’s cells cut right through and drop out of the bed, lift the card clear before moving the sheet.'
    : ''),
  fields: [
    // ---------------------------------------------------------- RIGHT: what you type --
    { kind: 'text', key: 'name', label: 'Name', panel: 'right', section: 'Text', value: 'Morgan Vale', placeholder: 'Your name', maxLength: 30 },
    { kind: 'text', key: 'title', label: 'Title', panel: 'right', section: 'Text', value: 'Senior Designer', placeholder: 'Job title', maxLength: 28 },
    // No symbol button on a phone number or a web address: an inline icon has no use there, and
    // the button is one more thing to read past.
    { kind: 'text', key: 'phone', label: 'Phone', panel: 'right', section: 'Text', value: '+1 555 0142', placeholder: 'Phone number', maxLength: 24, symbols: false },
    { kind: 'text', key: 'line4', label: 'Third line', panel: 'right', section: 'Text', value: 'morganvale.co', placeholder: 'Email, site or address', maxLength: 32, symbols: false },
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'montserrat', recommended: READS_SMALL },
    {
      kind: 'symbol', key: 'logo', label: 'Logo', panel: 'right', section: 'Logo', value: '',
      help: 'Optional, many cards work well with just the name.',
    },
    {
      kind: 'number', key: 'logoSize', label: 'Logo size', panel: 'right', section: 'Logo',
      value: 14, min: 12, max: 18, step: 0.5, unit: 'mm', visibleWhen: (v) => str(v, 'logo') !== '',
    },

    // ------------------------------------------------ LEFT: "Shape & size" (opens first) --
    {
      kind: 'select', key: 'cardSize', label: 'Card size', section: 'Shape & size', value: DEFAULT_SIZE,
      options: [
        { value: '85x55', label: '85 × 55 mm' },
        { value: '89x51', label: '89 × 51 mm (US)' },
        { value: '90x50', label: '90 × 50 mm' },
      ],
    },
    {
      kind: 'select', key: 'pattern', label: 'Pattern', section: 'Shape & size', value: 'hexagons',
      options: [
        { value: 'hexagons', label: 'Hexagons' },
        { value: 'lattice', label: 'Lattice' },
        { value: 'circles', label: 'Circles' },
        { value: 'none', label: 'None' },
      ],
      help: 'Cuts small shapes all the way through as a decorative band.',
    },
    {
      kind: 'select', key: 'patternSide', label: 'Pattern side', section: 'Shape & size', value: 'right',
      options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }],
      visibleWhen: hasPattern,
    },
    {
      kind: 'number', key: 'patternWidth', label: 'Pattern width', section: 'Shape & size',
      value: 30, min: 25, max: 35, step: 1, unit: '%', visibleWhen: hasPattern,
      help: 'The text column shrinks to fill whatever is left.',
    },
    {
      kind: 'number', key: 'corner', label: 'Corner radius', section: 'Shape & size',
      value: 3, min: 1, max: 6, step: 0.5, unit: 'mm',
    },

    // ------------------------------------------------------------------- LEFT: "Lettering" --
    {
      kind: 'number', key: 'nameSize', label: 'Name height', section: 'Lettering',
      value: 6, min: 4, max: 10, step: 0.5, unit: 'mm',
      help: 'Title, phone and the third line scale together with it.',
    },
    { kind: 'toggle', key: 'rule', label: 'Rule between name and details', section: 'Lettering', value: true },
    {
      kind: 'select', key: 'op', label: 'Letters are', section: 'Lettering', value: 'engrave',
      options: [{ value: 'engrave', label: 'Engrave' }, { value: 'score', label: 'Score' }],
      help: 'No cut option, letters this small would drop out as scrap.',
    },
    {
      kind: 'select', key: 'textCase', label: 'Capitalise the name', section: 'Lettering', value: 'upper', advanced: true,
      options: [
        { value: 'as-typed', label: 'As typed' }, { value: 'upper', label: 'UPPERCASE' },
        { value: 'lower', label: 'lowercase' }, { value: 'title', label: 'Title case' },
      ],
    },
    {
      kind: 'number', key: 'letterSpacing', label: 'Letter spacing', section: 'Lettering',
      value: 0, min: -10, max: 30, step: 1, unit: '%', advanced: true,
      help: 'Applies to every line, not just the name.',
    },
  ],

  async build(v) {
    const warnings: string[] = [];
    const [w, h] = SIZES[str(v, 'cardSize')] ?? SIZES[DEFAULT_SIZE]!;
    const corner = num(v, 'corner');
    const card: Shapes = [[roundedRectRing(w, h, corner, 12)]];

    const kind = str(v, 'pattern');
    const side = str(v, 'patternSide');
    const bandWidth = kind === 'none' ? 0 : (w * num(v, 'patternWidth')) / 100;
    const cells = patternCells(kind, bandBox(w, h, bandWidth, side), (p) => insetDepth(p, w, h, corner) >= MARGIN);

    const column = columnBox(w, h, bandWidth, side, kind);
    const columnW = column.maxX - column.minX;
    const usableH = column.maxY - column.minY;

    // One factor for the whole lockup, logo included, so a long name shrinks the card's type
    // together and never clips the one line — which is this design's headline claim, and the
    // reason the doc's "stop shrinking below k = 0.6" is NOT done here: stopping there puts a
    // 107 mm name on an 85 mm card and lets the plate clip it, which is the exact failure the
    // one-factor fit exists to prevent. The name landing under its 4 mm floor is what warns.
    const op = (str(v, 'op') || 'engrave') as OpChoice;
    const symbols = readSymbols(v);
    const fitOf = (b: { width: number; height: number }) =>
      b.width > 0 && b.height > 0 ? Math.min(1, columnW / b.width, usableH / b.height) : 1;

    const natural = await buildLockup(v, 1, op, symbols);
    const k = fitOf(natural);
    let block = k >= 0.999 ? natural : await buildLockup(v, k, op, symbols);
    // A detail line held UP by its own 2.5 mm floor can end up wider than the column — 32
    // characters of web address at the floor is 66 mm in a 48 mm column. The floor then gives
    // way rather than the laser clipping the line: unfloored, every size is exactly
    // proportional to `k`, so one more pass lands the block inside the column for certain.
    const over = fitOf(block);
    if (over < 0.999) block = await buildLockup(v, k * over, op, symbols, false);

    if (!str(v, 'name').trim()) warnings.push(EMPTY_WARNING);
    else if (block.nameCap < READABLE_CAP - 1e-6) warnings.push(FIT_WARNING);

    const layers: DesignLayer[] = [];
    if (cells.length) layers.push({ id: 'pattern', label: 'Pattern', shapes: cells, op: 'cut', stencil: false });
    layers.push(...move(block.layers, column.minX, OPTICAL_LIFT * usableH));

    return {
      blank: { kind: 'shape', shapes: card },
      // A business card is never hung from anything, and `keyringFrom(v)` with no keyring fields
      // on the form reports an ENABLED 0 mm hole — a bug here, not a feature (place-cards says
      // the same thing for the same reason).
      keyring: { enabled: false, mode: 'inside', side: 'left', along: 0.5, dia: 4, ring: 2, position: -1 },
      layers,
      ...(warnings.length ? { warnings } : {}),
    };
  },

  fileName: (v) => stem(str(v, 'name') || 'business-card', 'card'),
};
