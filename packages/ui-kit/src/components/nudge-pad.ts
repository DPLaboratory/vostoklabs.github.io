import { el } from '../dom';
import { dpad, type DpadHandle } from './dpad';
import { withAccess, type ValueRow } from './controls';

/**
 * A d-pad and the two numbers it drives, side by side.
 *
 * The pad and the fields are one control, not two that happen to sit together. Nudging is a
 * DIRECTION — "a bit to the left" — and the pad is the honest instrument for that; the exact
 * millimetres are what you read back, type into when you know the number, and what a saved
 * project stores. Splitting them across the panel meant pressing an arrow and watching a
 * number change somewhere else.
 *
 * The pad does not replace the fields, it DRIVES them: a press writes the clamped value into
 * the field and fires the field's own `input` event, so everything already listening to the
 * numbers hears a press exactly as it would hear a typed digit. That is the property that
 * lets a paid mode point the same pad at a different object without knowing the pad exists.
 *
 * Ported out of the keycap generator, where it was thirteen hand-written elements and a CSS
 * grid the kit already had a component for.
 */

export interface NudgeAxisOptions {
  /** DOM id for the number input. Apps with existing wiring keep their ids by passing them. */
  id?: string;
  /** Axis letter shown before the field. */
  label: string;
  value?: number;
  /** Symmetric limit: the field clamps to ±max. */
  max?: number;
  step?: number;
}

export interface NudgePadOptions {
  /** Millimetres (or whatever the unit is) per arrow press. Default 0.5. */
  step?: number;
  /** Unit shown after each field. Default 'mm'. */
  unit?: string;
  x: NudgeAxisOptions;
  y: NudgeAxisOptions;
  /** Fires whenever either number changes, from a press, a typed digit or `setValues`. */
  onChange?: (x: number, y: number) => void;
  /**
   * Take the arrow press yourself.
   *
   * Given, the pad does not touch the fields — it hands over the signed delta and the app
   * writes them. That is the shape an app wants when it clamps against limits the pad cannot
   * see (a legend may reach the edge of a 6.25u spacebar but not of a 1u cap), or when a
   * paid mode has the same pad pointed at a different object. Without it the pad and the app
   * both write, and the second write wins by accident.
   */
  onNudge?: (dx: number, dy: number) => void;
  /** The centre button. Defaults to setting both axes to zero. */
  onReset?: () => void;
}

export type NudgePadHandle = ValueRow<{ x: number; y: number }> & {
  /** Move the pad's limits when the thing being nudged changes size. */
  setRange(axis: 'x' | 'y', max: number): void;
  pad: DpadHandle;
};

const clamp = (v: number, max: number) => Math.min(max, Math.max(-max, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

function axisField(
  axis: NudgeAxisOptions,
  unit: string,
  onInput: () => void,
): { row: HTMLElement; input: HTMLInputElement } {
  const input = el('input', {
    className: 'vl-nudge__num',
    attrs: {
      type: 'number',
      step: String(axis.step ?? 0.1),
      ...(axis.id ? { id: axis.id } : {}),
      ...(axis.max != null ? { min: String(-axis.max), max: String(axis.max) } : {}),
      'aria-label': axis.label,
    },
  }) as HTMLInputElement;
  input.value = String(axis.value ?? 0);
  input.addEventListener('input', onInput);

  const label = el('label', { className: 'vl-nudge__axis', text: axis.label });
  if (axis.id) label.setAttribute('for', axis.id);

  return {
    row: el('div', { className: 'vl-nudge__val' }, [
      label,
      input,
      el('span', { className: 'vl-nudge__unit', text: unit }),
    ]),
    input,
  };
}

export function nudgePad(opts: NudgePadOptions): NudgePadHandle {
  const step = opts.step ?? 0.5;
  const unit = opts.unit ?? 'mm';
  const limits = { x: opts.x.max ?? Infinity, y: opts.y.max ?? Infinity };

  const emit = () => opts.onChange?.(read().x, read().y);

  const x = axisField(opts.x, unit, emit);
  const y = axisField(opts.y, unit, emit);

  const read = () => ({
    x: parseFloat(x.input.value) || 0,
    y: parseFloat(y.input.value) || 0,
  });

  /** Write one axis and announce it the way a typed digit would. */
  const write = (axis: 'x' | 'y', value: number) => {
    const input = axis === 'x' ? x.input : y.input;
    input.value = String(round1(clamp(value, limits[axis])));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const pad = dpad({
    rotate: false,
    compact: true,
    glyphs: 'chevrons',
    onMove: (dir) => {
      const dx = dir === 'left' ? -step : dir === 'right' ? step : 0;
      const dy = dir === 'down' ? -step : dir === 'up' ? step : 0;
      if (opts.onNudge) { opts.onNudge(dx, dy); return; }
      if (dx) write('x', read().x + dx);
      if (dy) write('y', read().y + dy);
    },
    onReset: () => {
      if (opts.onReset) { opts.onReset(); return; }
      write('x', 0);
      write('y', 0);
    },
  });

  const root = el('div', { className: 'vl-nudge' }, [
    pad.root,
    el('div', { className: 'vl-nudge__vals' }, [x.row, y.row]),
  ]) as unknown as NudgePadHandle;

  root.setValue = (value, notify) => {
    x.input.value = String(round1(clamp(value.x, limits.x)));
    y.input.value = String(round1(clamp(value.y, limits.y)));
    if (notify) emit();
  };
  root.setRange = (axis, max) => {
    limits[axis] = max;
    const input = axis === 'x' ? x.input : y.input;
    input.min = String(-max);
    input.max = String(max);
  };
  root.pad = pad;
  withAccess(root, read, [x.input, y.input]);
  return root;
}
