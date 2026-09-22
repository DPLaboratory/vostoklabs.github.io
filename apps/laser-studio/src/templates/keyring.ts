// The keyring section most templates share, and the function that turns its values into the
// engine's spec. A template says `...keyringFields('outside')` and `keyring: keyringFrom(values)`.
//
// 2026-09-21: the control is Loop tab | None. There is no "Hole" — Ian, on a picture of a pet tag
// whose loop had been dragged into the bone's waist: "the hole for the keyring just doesnt work or
// doesnt make a sense in 99% of the time, remove it i guess, so we have only keyring, but make
// sure the keyring works perfectly". A design whose PRODUCT is a hole through the body cuts that
// hole itself, at its own hanging point — `hangHoleFields` + `hangingHoleCentre` below.
//
// 2026-09-22: …with ONE opt-in. Ian, on the matching keychains' bespoke "Hanging hole" toggle:
// "instead of hole lets have our usual keyring, just be default placed as a hole". A design whose
// product is a hole may pass `hole: true` and get "Hole" back in ITS control (Loop tab | Hole |
// None) — and may default to it. Nothing else changes: the shared default is still Loop tab |
// None, and no template gets the option by accident. The form writes `'hole'`, never the engine's
// old `'inside'`, so a project saved before 2026-09-21 still opens as a loop tab everywhere.
//
// Where the hole sits ALONG the edge is dragged on the preview (docs/briefs/
// laser-studio-preview-spec.md): the drag writes hidden values — `ringPos`, the exact fraction
// around the outline, plus `ringSide`/`ringAlong` so a saved file still reads as "left edge,
// 42 %" and older files load where they were. The loop's reach and a free nudge are settings,
// the way the name keychain has them.
import { blankById, buildBlank, edgePoint, type BlankParams, type Shapes } from '@vostok/laser';
import type { KeyringSpec } from '../engine/types';
import { holdInside, holeTrack } from '../engine/editorGeometry';
import { num, str, type Field, type Values } from './types';

/** The Ring control's tooltip. One sentence, because a tooltip is all it is (2026-09-21, Ian). */
export const RING_HELP = 'Grows a tab off the edge with a hole in it.';
/** …and the same sentence for the one design that also offers the hole (`hole: true`). */
export const RING_HOLE_HELP = 'A tab grown off the edge, or a hole through it.';

/**
 * What the shared Ring control may be set to.
 *
 * `'inside'` — a hole the user punched through the body and dragged around — is GONE from the
 * control (Ian, 2026-09-21: "the hole for the keyring just doesn't work or doesn't make sense
 * 99% of the time, remove it, so we have only keyring, but make sure the keyring works
 * perfectly"). It survives here only as a deprecated alias so that a template still passing it,
 * and every project file saved before tonight, opens as a loop tab instead of as a mode with no
 * option to select. Where a hole through the body IS the product — a pet disc, an ornament's
 * cap — the template cuts that hole into its OWN geometry at its own hanging point (see
 * `hangingHoleCentre` below); it is never this control.
 *
 * `'hole'` is the 2026-09-22 opt-in and is NOT that alias: it is a value only a form that offers
 * the option can hold (`keyringFields(…, { hole: true })`), and only that template's own saves
 * carry it. `keyringFrom` maps it to the engine's `'inside'`; everything else still maps to
 * `'outside'`, so no other design can acquire a punched hole from an old file or a stray value.
 */
export type RingMode = 'outside' | 'hole' | 'none' | 'inside';

/** The value the select holds, given what a template asked for and whether it offers the hole.
 *  No form ever shows a select whose value is not one of its options — which is what a bare
 *  `'inside'` (or a `'hole'` on a template that did not opt in) would be. */
const ringValue = (mode: RingMode, hole: boolean): string =>
  mode === 'inside' ? (hole ? 'hole' : 'outside') : mode === 'hole' && !hole ? 'outside' : mode;

export function keyringFields(
  mode: RingMode = 'outside',
  /** A jump ring is 2 mm, a split ring 5 mm, a ribbon 3 mm — the design knows which. `side` and
   *  `along` (0–100 %) say where on the outline the ring rests before any drag: a swing tag
   *  hangs from top-centre, a bar keychain from its left end.
   *
   *  `ringNote` REPLACES the Ring control's tooltip with this design's own sentence — one
   *  short sentence, because a tooltip is all it is now.
   *
   *  `nudge` is how far the pad may move the ring, mm. The house rule is the part's own size
   *  (`03-cross-cutting.md` G25): the shipped 250 mm let a 60 mm tag grow a 247 mm cantilever
   *  bridged by one thin arm, reported as a structurally sound single island. A design that knows
   *  how big it is passes half its own longest side, so the ring can reach any point ON the part
   *  and nowhere else.
   *
   *  `maxDia` is the biggest hole this design's hardware could want, mm. The shared 12 mm is a
   *  padlock shackle; on a 25 mm pet tag or a charm it is a hole the part cannot survive, and
   *  a slider whose top end breaks the piece is not a range (G25).
   *
   *  `maxRing` is the same rule for the BORDER, and the same reason: the disc the lettering has
   *  to keep off is `dia/2 + ring`, so the shared 8 mm is a border on a luggage tag and a hole
   *  through the initial on a 22 mm one. Two templates were already patching the field after the
   *  fact with a `.map()`; this is that, by signature.
   *
   *  `hole` puts "Hole" back into THIS design's control — a hole punched through the body at the
   *  same place the tab would have been grown, dragged the same way and held in material the same
   *  way. For a design whose product IS the hole (two tags that hang side by side on one ring),
   *  and nowhere else: absent, the control is Loop tab | None as it has been since 2026-09-21. */
  opts: { section?: string; dia?: number; ring?: number; side?: 'left' | 'top' | 'right' | 'bottom'; along?: number; ringNote?: string; nudge?: number; maxDia?: number; maxRing?: number; hole?: boolean } = {},
): Field[] {
  const section = opts.section ?? 'Keyring';
  const hole = opts.hole === true;
  const shown = (v: Values) => str(v, 'ringMode') !== 'none';
  return [
    {
      // Loop tab or nothing — plus Hole where the design opted in. A saved 'inside' opens as
      // 'outside' (`keyringFrom`), and a template that still passes it gets the same, so no form
      // ever shows a select whose value is not one of its options.
      kind: 'select', key: 'ringMode', label: 'Ring', section, value: ringValue(mode, hole),
      help: opts.ringNote ?? (hole ? RING_HOLE_HELP : RING_HELP),
      options: [
        { value: 'outside', label: 'Loop tab' },
        ...(hole ? [{ value: 'hole', label: 'Hole' }] : []),
        { value: 'none', label: 'None' },
      ],
    },
    { kind: 'number', key: 'holeDia', label: 'Hole diameter', section, value: opts.dia ?? 4, min: 1.5, max: opts.maxDia ?? 12, step: 0.5, unit: 'mm', help: '4 mm for a jump ring, 5 mm for a split ring.', visibleWhen: shown },
    // On a loop tab this is the WALL: the material the tab carries round its hole, so the tab is
    // `dia + 2 × ring` across. It also sets how far the lug stands proud of the edge at rest and
    // the disc the lettering has to keep off.
    { kind: 'number', key: 'holeRing', label: 'Hole border', section, value: opts.ring ?? 2.5, min: 1, max: opts.maxRing ?? 8, step: 0.5, unit: 'mm', help: 'Material left around the hole.', visibleWhen: shown },
    { kind: 'position', key: 'ringDx', keyY: 'ringDy', label: 'Move the ring', section, value: 0, valueY: 0, max: opts.nudge ?? 250, step: 0.5, unit: 'mm', visibleWhen: shown },
    { kind: 'select', key: 'ringSide', label: 'Side', section, value: opts.side ?? 'left', hidden: true, options: [{ value: 'left', label: 'Left' }, { value: 'top', label: 'Top' }, { value: 'right', label: 'Right' }, { value: 'bottom', label: 'Bottom' }] },
    { kind: 'number', key: 'ringAlong', label: 'Position on that side', section, value: opts.along ?? 50, min: 0, max: 100, step: 1, unit: '%', hidden: true },
    { kind: 'number', key: 'ringPos', label: 'Position around the outline', section, value: -1, min: -1, max: 1, step: 0.001, hidden: true },
  ];
}

export function keyringFrom(v: Values): KeyringSpec {
  const mode = str(v, 'ringMode');
  const pos = num(v, 'ringPos');
  return {
    enabled: mode !== 'none',
    // Any saved 'inside' becomes a loop tab: the option is gone, and a project saved before
    // 2026-09-21 has to open. `'hole'` is the other way round — the one value a design that opted
    // in writes, and the engine's word for a hole punched through the part is `'inside'`, so this
    // is where the two vocabularies meet. Everything else is a tab.
    mode: mode === 'hole' ? 'inside' : 'outside',
    side: (['left', 'top', 'right', 'bottom'].includes(str(v, 'ringSide')) ? str(v, 'ringSide') : 'left') as KeyringSpec['side'],
    along: num(v, 'ringAlong') / 100,
    dia: num(v, 'holeDia'),
    ring: num(v, 'holeRing'),
    position: Number.isFinite(pos) && pos >= 0 ? pos : -1,
    dx: num(v, 'ringDx'),
    dy: num(v, 'ringDy'),
  };
}

/** A keyring spec that builds nothing — for a design that hangs from a hole of its own. */
export const NO_KEYRING: KeyringSpec = { enabled: false, mode: 'outside', side: 'top', along: 0.5, dia: 4, ring: 2.5, position: -1, dx: 0, dy: 0 };

/** The two controls a design's OWN hanging hole needs: on/off and how big. Its POSITION is not a
 *  control — the shape decides where it hangs from (Ian, 2026-09-21). */
export function hangHoleFields(section: string, opts: { dia?: number; maxDia?: number; label?: string } = {}): Field[] {
  return [
    { kind: 'toggle', key: 'hangHole', label: opts.label ?? 'Hanging hole', section, value: true, help: 'Cut where the shape naturally hangs from.' },
    {
      kind: 'number', key: 'holeDia', label: 'Hole diameter', section, value: opts.dia ?? 5, min: 2, max: opts.maxDia ?? 8, step: 0.5, unit: 'mm',
      help: '5 mm for a split ring, 3 mm for a ribbon.',
      visibleWhen: (v) => v.hangHole !== false,
    },
  ];
}

/**
 * Where a shape hangs from, in its own frame: the blank's declared `holeAt` (a bone's upper-left
 * lobe, a star's top arm, a house's roof boss), else the top-centre of its real outline. Held
 * inside the part with `ring` mm of material all round, so a hole on a shape whose hanging point
 * is too thin for it moves to the nearest place that survives rather than breaking the edge.
 */
export function hangingHoleCentre(v: Values, fallbackBlank: string, shapes: Shapes, dia: number, ring: number): [number, number] {
  const def = blankById(str(v, 'blank')) ?? blankById(fallbackBlank)!;
  // The same mapping `shared.ts`'s (private) `blankParamsOf` makes — with the hole's own
  // diameter, because a blank's `holeAt` sizes its inset from it.
  const p: BlankParams = { ...def.defaults, width: num(v, 'width'), height: num(v, 'height'), corner: num(v, 'corner'), holeDia: dia, holeSide: 'none', pair: false };
  const at = def.holeAt?.(p) ?? edgePoint(buildBlank(def, p), 'top', 0.5);
  // The candidates `holdInside` falls back to are the inward track a punched hole rides, so a
  // hanging point the shape is too thin for lands somewhere the part survives.
  const k = { mode: 'inside' as const, side: 'top' as const, along: 0.5, dia, ring };
  return holdInside(shapes, at as [number, number], dia / 2 + ring, holeTrack(shapes, k));
}
