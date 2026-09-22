import { readSymbols } from '../symbols/model';
// A shape from the library filled with a repeating pattern — punched through as holes,
// engraved as a fill, or scored as lines — with a clear disc in the middle for a monogram.
//
// The pattern engine is `@vostok/patterns` (packages/patterns/README.md); this template is its
// first home in the studio and the form later pattern templates copy. The template's own job
// is small: build the REGION the pattern may fill — the piece, less the clear centre and less
// the ring's border of material — and turn the fill's answer into layers. Everything that
// keeps the piece in one piece (holes dropped at the edge, the web between holes, lines
// clipped to the material, hinge slits kept off the edge) is the engine's.
//
// The picker is the gallery (`src/patternGallery.ts`) — one `pattern` field, one card of the
// chosen pattern, and Pattern Monster's own wall of cards behind "Choose pattern…". The knobs
// beside it are the site's, in the site's words: Zoom, Stroke, Horizontal/Vertical spacing.
// The tile geometry loads only when a `pm-` tile is actually built or shown, so a customer who
// stays with the procedural patterns never pays for it.
import { circleRing, type Shapes } from '@vostok/laser';
import { fillShape, patternById, type PatternDef, type PatternOp } from '@vostok/patterns';
import libraryIndex from '@vostok/patterns/library-index';
import { finalHoleCentre } from '../engine/editorGeometry';
import { textLayer } from '../engine/text';
import type { DesignLayer } from '../engine/types';
import { keyringFields, keyringFrom } from './keyring';
import { blankShapes, opField, opOf, shapeFields, shortSideOf, stem } from './shared';
import { bool, num, str, type TemplateDef, type Values } from './types';

/** Asanoha — the hemp leaf. A scored one is what the gallery card shows. */
const DEFAULT_PATTERN = 'pm-japanese-pattern-4';
/** What a pattern falls back to when an id names nothing the engine knows. */
const FALLBACK_PATTERN = 'honeycomb';
/** A coaster: the size the gallery card is built at. */
const SIZE = 90;

/** Faces that read as a monogram engraved at 20 mm: bold, even strokes, no hairlines. */
const MONOGRAM_FACES = ['bebas-neue', 'anton', 'righteous', 'titan-one', 'montserrat'];

const OP_WORD: Record<PatternOp, string> = { cut: 'cut out', engrave: 'engraved', score: 'scored' };

/* What each library tile is and what it allows, without its geometry: the package keeps a
   small index (ids, names, modes, ranges, tags) beside the data for exactly this, so the form
   knows whether to show a Stroke or a Spacing slider before a byte of path data has loaded. */
interface TileMeta {
  mode: 'stroke' | 'stroke-join' | 'fill';
  maxSpacing: [number, number];
}
const TILE_META = new Map<string, TileMeta>(
  (libraryIndex as unknown as { tiles: { id: string; mode: string; maxSpacing: number[] }[] }).tiles.map((t) => [
    `pm-${t.id}`,
    { mode: t.mode === 'fill' ? 'fill' : t.mode === 'stroke-join' ? 'stroke-join' : 'stroke', maxSpacing: [t.maxSpacing[0] ?? 0, t.maxSpacing[1] ?? 0] },
  ] as const),
);
/** The widest spacing any tile in the library allows — the slider's end stop. What a given
 *  tile allows is narrower, and `build()` clamps to it. */
const MAX_SPACING = Math.max(...[...TILE_META.values()].flatMap((t) => t.maxSpacing));
/** 0 for a procedural pattern, which has no spacing of its own. */
const spacingRoom = (id: string, axis: 0 | 1): number => TILE_META.get(id)?.maxSpacing[axis] ?? 0;
/** A tile drawn as lines: the only kind with a stroke to set. */
const isStrokeTile = (id: string): boolean => (TILE_META.get(id)?.mode ?? 'fill') !== 'fill';

let libraryLoaded: Promise<PatternDef[]> | null = null;
async function libraryPattern(id: string): Promise<PatternDef | undefined> {
  libraryLoaded ??= import('@vostok/patterns/library').then((m) => m.LIBRARY);
  const lib = await libraryLoaded;
  return lib.find((d) => d.id === id) ?? lib[0];
}

export const patternFill: TemplateDef = {
  id: 'pattern-fill',
  name: 'Pattern fill',
  blurb: 'Any shape filled with a repeating pattern — honeycomb, asanoha, living hinge — cut out, engraved or scored, with room for a monogram.',
  tags: ['home', 'engrave + score + cut'],
  fields: [
    { kind: 'text', key: 'text', label: 'Monogram', panel: 'right', section: 'Text', value: 'M', placeholder: 'Optional — a letter or two', maxLength: 4, symbols: true },
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'bebas-neue', recommended: MONOGRAM_FACES },
    ...shapeFields({ value: 'coaster-round', categories: ['coasters', 'shapes', 'tags', 'keychains'], width: SIZE, height: SIZE, corner: 6, minWidth: 20, maxWidth: 300, maxHeight: 300 }),
    {
      kind: 'pattern', key: 'pattern', label: 'Pattern', section: 'Pattern', value: DEFAULT_PATTERN,
      help: 'Line patterns score, filled patterns can engrave or cut.',
    },
    { kind: 'number', key: 'patternScale', label: 'Zoom', section: 'Pattern', value: 100, min: 40, max: 300, step: 5, unit: '%' },
    {
      kind: 'number', key: 'patternStroke', label: 'Stroke', section: 'Pattern', value: 1, min: 0.5, max: 6, step: 0.5,
      help: 'How wide the line is burnt into the material.',
      visibleWhen: (v) => isStrokeTile(str(v, 'pattern')) && str(v, 'patternOp') === 'engrave',
    },
    {
      kind: 'number', key: 'patternSpacingX', label: 'Horizontal spacing', section: 'Pattern', value: 0, min: 0, max: MAX_SPACING, step: 0.5,
      visibleWhen: (v) => spacingRoom(str(v, 'pattern'), 0) > 0,
    },
    {
      kind: 'number', key: 'patternSpacingY', label: 'Vertical spacing', section: 'Pattern', value: 0, min: 0, max: MAX_SPACING, step: 0.5,
      visibleWhen: (v) => spacingRoom(str(v, 'pattern'), 1) > 0,
    },
    { kind: 'number', key: 'patternAngle', label: 'Angle', section: 'Pattern', value: 0, min: 0, max: 180, step: 5, unit: '°' },
    { kind: 'position', key: 'patternX', keyY: 'patternY', label: 'Position', section: 'Pattern', value: 0, valueY: 0, max: 30, step: 0.5, unit: 'mm', advanced: true },
    {
      kind: 'select', key: 'patternOp', label: 'Make it', section: 'Pattern', value: 'score',
      options: [{ value: 'cut', label: 'Cut out' }, { value: 'engrave', label: 'Engrave' }, { value: 'score', label: 'Score' }],
      help: 'Line patterns can only be scored or engraved, not cut.',
    },
    {
      kind: 'number', key: 'web', label: 'Web', section: 'Pattern', value: 2, min: 1, max: 8, step: 0.1, unit: 'mm',
      help: 'The least material kept between two holes or an edge.',
      visibleWhen: (v) => str(v, 'patternOp') === 'cut',
    },
    { kind: 'number', key: 'margin', label: 'Edge margin', section: 'Pattern', value: 4, min: 0, max: 30, step: 0.5, unit: 'mm' },
    { kind: 'toggle', key: 'clearCentre', label: 'Clear centre', section: 'Centre', value: true },
    { kind: 'number', key: 'clearRadius', label: 'Clear radius', section: 'Centre', value: 17, min: 3, max: 120, step: 0.5, unit: 'mm', visibleWhen: (v) => bool(v, 'clearCentre') },
    { kind: 'number', key: 'size', label: 'Monogram size', section: 'Centre', value: 20, min: 4, max: 120, step: 0.5, unit: 'mm', visibleWhen: (v) => str(v, 'text').trim() !== '' },
    opField('Centre', 'engrave', 'Monogram'),
    ...keyringFields('none', { section: 'Ring', nudge: SIZE / 2 }),
  ],
  async build(v) {
    const shapes = blankShapes(v, 'coaster-round');
    const chosen = str(v, 'pattern');
    const def = (chosen.startsWith('pm-') ? await libraryPattern(chosen) : patternById(chosen)) ?? patternById(FALLBACK_PATTERN)!;
    const warnings: string[] = [];
    let op = str(v, 'patternOp') as PatternOp;
    if (!def.ops.includes(op)) {
      const fallback = def.ops[0]!;
      warnings.push(`${def.name} cannot be ${OP_WORD[op]} — it is ${OP_WORD[fallback]} instead.`);
      op = fallback;
    }
    const keyring = keyringFrom(v);
    const margin = num(v, 'margin');
    const web = num(v, 'web');

    // The region the pattern may fill: the piece, less a disc for the monogram, less the ring's
    // border. Each reserve is a hole in the piece's island — the fill reads the region even-odd,
    // so a reserve has to stay inside the outline: the clear disc is shrunk to fit, and the
    // ring's disc is inside by construction (`finalHoleCentre` holds a hole in its border).
    const region: Shapes = shapes.map((island) => [...island]);
    const outer = region.reduce((best, island) => (islandArea(island) > islandArea(best) ? island : best), region[0] ?? []);
    if (bool(v, 'clearCentre')) {
      const roomFor = shortSideOf(shapes) / 2 - margin - 1;
      let r = num(v, 'clearRadius');
      if (r > roomFor) {
        r = Math.max(2, roomFor);
        warnings.push('The clear centre was shrunk to stay inside the piece.');
      }
      outer.push(circleRing(0, 0, r, 64));
    }
    if (keyring.enabled && keyring.mode === 'inside') {
      const { centre } = finalHoleCentre(shapes, keyring);
      outer.push(circleRing(centre[0], centre[1], keyring.dia / 2 + keyring.ring - 0.05, 48));
    }

    const fill = fillShape(region, def, {
      op,
      // The library's own three knobs, in the site's words. A procedural pattern declares none
      // of these keys, so `resolveParams` drops them — one params object serves both halves.
      params: {
        stroke: num(v, 'patternStroke'),
        spacingX: Math.min(num(v, 'patternSpacingX'), spacingRoom(chosen, 0)),
        spacingY: Math.min(num(v, 'patternSpacingY'), spacingRoom(chosen, 1)),
      },
      scale: num(v, 'patternScale') / 100,
      angle: num(v, 'patternAngle'),
      dx: num(v, 'patternX'),
      dy: num(v, 'patternY'),
      web,
      inset: op === 'cut' ? Math.max(margin, web) : margin,
      // The engine's cut layer takes closed shapes, so a hinge's slits come back as 0.25 mm
      // slots — one kerf wide, which the laser cuts as a single pass either side.
      ...(op === 'cut' ? { slitWidth: 0.25 } : {}),
    });
    warnings.push(...fill.warnings);

    const layers: DesignLayer[] = [];
    if (op === 'cut') {
      layers.push({ id: 'pattern', label: def.name, shapes: fill.shapes, op: 'cut', stencil: false });
    } else if (op === 'engrave') {
      if (fill.shapes.length) layers.push({ id: 'pattern', label: def.name, shapes: fill.shapes, op: 'engrave' });
      // A pattern of lines has nothing to fill: its lines are scored, in the score colour, and
      // the export note says so.
      if (fill.paths.length) layers.push({ id: 'pattern-lines', label: `${def.name} lines`, shapes: [], op: 'score', paths: fill.paths });
    } else {
      layers.push({ id: 'pattern', label: def.name, shapes: fill.shapes, op: 'score', paths: fill.paths });
    }

    const text = str(v, 'text').trim();
    if (text) layers.push(...(await textLayer({ text, font: str(v, 'font'), size: num(v, 'size'), symbols: readSymbols(v) }, opOf(v), 'text', 'Monogram')));

    const count = op === 'cut' ? `${fill.shapes.length + fill.paths.length} holes` : op === 'score' ? `${Math.round(fill.stats.lineLength)} mm of line` : `${fill.shapes.length} shapes`;
    return { blank: { kind: 'shape', shapes }, keyring, layers, warnings, status: `${def.name} · ${count}` };
  },
  fileName: (v) => stem(str(v, 'pattern') || 'pattern', str(v, 'text') || 'pattern'),
  exportNote: 'Cut the pattern holes before the outline, so the piece can’t shift.',
};

/** For tests and scripts: the values that pick one pattern by id. One key now — the gallery
 *  replaced the family dropdown and its per-family keys. */
export function pickPattern(id: string): Values {
  return { pattern: id };
}

function islandArea(island: Shapes[number]): number {
  const ring = island[0];
  if (!ring) return 0;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return Math.abs(a / 2);
}
