// One template, one screen, in the house three columns: the settings on the left in named
// categories (the font among them), the part in the middle, what you TYPE on the right with the
// download under it — the shape every shipped generator has, so nothing here has to be learnt
// twice. The header is the template's name and nothing else; nothing is printed under the
// Download button (Ian, 2026-09-21: "so much unnecessary text").
import {
  appShell,
  ICONS,
  topbarLinks,
  generatorHeader,
  sidebarFooter,
  stageStatus,
  button,
  panelCredit,
  toast,
  dialog,
  openLicenseModal,
  licenseReminderToast,
  el,
} from '@vostok/ui-kit';
import { BRAND } from '@vostok/brand';
import {
  MAKERLAB,
  initMakerlab,
  isEmbedded as mlEmbedded,
  isReady as mlReady,
  can as mlCan,
  sdkExport,
  sdkToast,
} from 'virtual:makerlab';
import { BLANK_COVER, coverDataUrl, cutExport, cutZip, readmeText } from './export/makerlabArtifacts';
import { build } from './engine/engine';
import { mergeBatch, sheetOf, sheetsClause } from './engine/batch';
import type { BuildInput, BuildOutput, KeyringSpec } from './engine/types';
import { coerceValues, defaultsOf, type TemplateDef, type Values } from './templates';
import { lines, str } from './templates/types';
import { keyringFrom } from './templates/keyring';
import { renderForm } from './form';
import { createPreview } from './preview';
import { buildLaserStudioSvg, downloadLaserStudioSvg } from './export/laserSvg';
import { fmtSize, onUnitChange } from './units';
import { CHANGELOG } from './changelog';

export interface EditorOptions {
  template: TemplateDef;
  values?: Values;
  onBack(): void;
  /** Open another template (a loaded project names one). */
  onSwitch(id: string, carry: Values): void;
}

let downloads = 0;

/** How long to wait for the host before the UI admits it does not know. The SDK's own
 *  `export()` never gives up; see `sendToMakerlab`. */
const EXPORT_TIMEOUT_MS = 60_000;
/** A sentinel with its own identity, so a real `ExportResult` can never be mistaken for it. */
const TIMED_OUT = Symbol('makerlab-export-timeout');

/** The licence, in one line, for the artifact's description and the README inside the zip.
 *  The URL comes from @vostok/brand and is never written out here (invariant #4). */
const LICENSE_NOTE = `Free for personal use; selling what you make from it requires a commercial license: ${BRAND.urls.mwCommercial}`;

export function createEditor(opts: EditorOptions): HTMLElement {
  const t = opts.template;
  const values: Values = opts.values ? coerceValues(t, opts.values) : defaultsOf(t);
  let output: BuildOutput | null = null;
  const hasKeyring = t.fields.some((f) => f.key === 'ringMode');
  const keyring = (): KeyringSpec | null => (hasKeyring ? keyringFrom(values) : null);

  const status = stageStatus('Starting the geometry engine…');
  const stageHost = el('div', { className: 'ls-stage' });
  const preview = createPreview(stageHost, {
    onHoleLive: (text) => status.set(text, 'idle'),
    onHoleCommit: (hole) => {
      values.ringDx = +hole.dx.toFixed(2);
      values.ringDy = +hole.dy.toFixed(2);
      form.sync();
      rebuild(true);
    },
  });
  preview.root.append(status.root);

  // -- the file's one line ------------------------------------------------------------------
  // Shown in the Export Preview's legend and nowhere else. Blue is the one colour a beginner
  // gets wrong — a score left set to Cut drops the piece out of the sheet in bits — so a build
  // that scores says so there, after the template's own sentence when it has one. A template
  // whose sentence depends on its settings gives a function; it is resolved on every describe.
  const SCORE_NOTE = 'Set the blue lines to Score, not Cut, in your laser software.';
  const ownNote = () => (typeof t.exportNote === 'function' ? t.exportNote(values) : t.exportNote) ?? '';
  const fileNoteFor = (scores: boolean) => [ownNote(), scores ? SCORE_NOTE : ''].filter(Boolean).join(' ');

  function describe(out: BuildOutput) {
    const ops = Array.from(new Set(out.objects.map((o) => o.op)));
    preview.setNote(fileNoteFor(ops.includes('score')));
    if (!out.objects.length) { status.set('Nothing to cut yet — type something.', 'warn'); return; }
    const warn = out.warnings[0] ?? '';
    // The template's own clause ("24 cards · 2 sheets") beats the generic piece count; a run laid
    // on sheets says how many unless the clause already did.
    const pieces = out.status ? ` · ${out.status}` : out.parts.length > 1 ? ` · ${out.parts.length} pieces` : '';
    status.set(`${fmtSize(out.bbox.maxX - out.bbox.minX, out.bbox.maxY - out.bbox.minY)}${pieces}${sheetsClause(out)} · ${ops.join(' + ')}${warn ? ` · ${warn}` : ''}`, warn ? 'warn' : 'idle');
  }
  const stopUnits = onUnitChange(() => { if (output) describe(output); });

  // -- rebuild: coalesce a burst of edits, drop stale results ----------------------------
  /**
   * What to build: the design once, or — in Batch — once per name, merged into one run laid out
   * on the chosen sheet. Every setting reaches every copy because every copy is built from the
   * same values with one text field swapped; that includes the keyring drag, which writes
   * `ringDx`/`ringDy`.
   */
  async function buildInput(): Promise<BuildInput> {
    const b = t.batch;
    if (!b || values.__batch !== true) return t.build(values);
    const names = lines(values, '__batchLines');
    if (!names.length) return t.build(values);
    const inputs = await Promise.all(names.map((n) => t.build({ ...values, [b.key]: n })));
    return mergeBatch(inputs, names, sheetOf(str(values, '__sheet')), b.noun);
  }

  let timer = 0;
  let serial = 0;
  function rebuild(immediate = false) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const mine = ++serial;
      status.set('Building…', 'busy');
      try {
        const input = await buildInput();
        const out = await build(input);
        if (mine !== serial) return;
        output = out;
        // No Ring control (a design with its own fixed hole — pet tag, matching keychains) →
        // no drag handle: a drag would write ringDx/ringDy the form does not declare and snap
        // back (packet M, 2026-09-21).
        preview.render(out, hasKeyring ? keyring() : null);
        describe(out);
      } catch (err) {
        if (mine !== serial) return;
        status.set(`Could not build it: ${(err as Error).message}`, 'error');
        console.error(err);
      }
    }, immediate ? 0 : 120);
  }

  // -- the form ---------------------------------------------------------------------------
  const form = renderForm({
    fields: t.fields,
    values,
    ...(t.batch ? { batch: t.batch } : {}),
    onChange: (key) => {
      // A new ring mode or size changes the track the hole sits on: let the side/along echo
      // place it again rather than an exact fraction of the old outline.
      if (key === 'ringMode' || key === 'holeDia' || key === 'holeRing') values.ringPos = -1;
      rebuild();
    },
  });
  /** Everything this editor subscribed to, dropped in one place — a form still listening to the
   *  unit switch after the gallery is back re-formats controls nobody can see. */
  const leave = () => { stopUnits(); form.dispose(); };
  const back = button({ label: 'All templates', icon: ICONS.arrowLeft, emphasis: 'ghost', title: 'Back to the gallery', onClick: () => { leave(); opts.onBack(); } });
  const reset = button({
    label: 'Reset this design', icon: ICONS.rotateLeft, emphasis: 'ghost',
    onClick: () => { Object.assign(values, defaultsOf(t)); form.sync(); rebuild(true); },
  });

  // -- export / save / load / help / theme, the standard footer ---------------------------

  /** Hand the zip to MakerLab and say what happened. Resolves true on success.
   *
   *  `sdk.export` has no timeout of its own — the developer guide says so outright: it waits
   *  for the host for ever. The kit's export panel re-enables its button in a `finally`, so a
   *  host that never answers would leave it greyed with a spinner on it and nothing but a
   *  reload to fix. Hence the race: at a minute the UI comes back and says honestly that it
   *  does not know. The original promise is still listened to, because the host may simply be
   *  slow — "Export ready" in its log is a wait for the user to press ITS Download button, not
   *  a hang — and a late success should be reported rather than contradicted. */
  async function sendToMakerlab(options: Parameters<typeof sdkExport>[0]): Promise<boolean> {
    status.set('Sending to MakerLab…', 'busy');
    const pending = sdkExport(options);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), EXPORT_TIMEOUT_MS);
    });
    const res = await Promise.race([pending, timedOut]);
    clearTimeout(timer);

    if (res === TIMED_OUT) {
      void pending.then(
        (late) => {
          if (late.success) {
            status.set('Sent the cut file to MakerLab', 'idle');
            toast('MakerLab answered after all: the cut file is sent.', { kind: 'ok' });
          } else {
            status.set(`Export failed: ${late.errorMessage ?? late.errorCode}`, 'error');
          }
        },
        (err: unknown) => status.set(`Export failed: ${(err as Error).message}`, 'error'),
      );
      const msg = 'MakerLab has not answered. Check MakerLab’s own export window, or reload the MakerWorld page and try again.';
      status.set(msg, 'error');
      toast(msg, { kind: 'error' });
      return false;
    }

    if (res.success) {
      status.set('Sent the cut file to MakerLab', 'idle');
      void sdkToast({ message: 'Exported the cut file', type: 'success' });
      return true;
    }
    const why = res.errorMessage ?? res.errorCode;
    status.set(`Export failed: ${why}`, 'error');
    void sdkToast({ message: 'Export failed', type: 'error' });
    toast(`Export failed: ${why}`, { kind: 'error' });
    return false;
  }

  const footer = sidebarFooter({
    // Inside the host the label starts with "Export", which the kit passes through untouched:
    // nothing is downloaded in the embed, the file goes to MakerLab.
    formats: [{ id: 'svg', label: MAKERLAB ? 'Export cut file' : 'SVG' }],
    onExport: async (format) => {
      if (format !== 'svg') throw new Error('Unknown format: ' + format);
      if (!output || !output.objects.length) return toast('Nothing to export yet — type something first.', { kind: 'warn' });
      const stem = (t.fileName?.(values) ?? t.id).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || t.id;

      if (MAKERLAB) {
        /* Embedded, but the host may not be answering.

           No download fallback: the sandbox is `allowDownloads: false`, so it would vanish with
           no error at all. No licence modal either — that is the other half of what this path
           was found doing elsewhere: a subscription pitch through a `target="_blank"` link the
           sandbox kills, on top of an export that silently never happened.

           One reconnect first. `initMakerlab` tears down the old SDK and runs the handshake
           again, which costs a moment and can only help — the handshake is the thing that was
           lost. The message it falls back to names the whole MakerWorld page on purpose:
           reloading only this panel re-runs the app inside a frame the host has stopped talking
           to, which is a loop. */
        if (!(mlReady() && mlCan('export'))) {
          if (mlEmbedded()) {
            status.set('Reconnecting to MakerLab…', 'busy');
            await initMakerlab();
          }
          if (!(mlReady() && mlCan('export'))) {
            const msg = 'Not connected to MakerLab, so the file cannot be sent. Reload the whole MakerWorld page, not just this panel, and try again.';
            status.set(msg, 'error');
            toast(msg, { kind: 'error' });
            return;
          }
        }

        const svg = buildLaserStudioSvg(output, import.meta.env.VITE_BUILD_ID);
        const scores = output.objects.some((o) => o.op === 'score');
        const buffer = cutZip({
          svg,
          svgName: `${stem}.svg`,
          readme: readmeText({
            design: t.name,
            fileName: `${stem}.svg`,
            note: fileNoteFor(scores),
            licence: LICENSE_NOTE,
            buildId: import.meta.env.VITE_BUILD_ID,
          }),
        });
        const sent = await sendToMakerlab(
          cutExport({
            fileName: `${stem}.zip`,
            buffer,
            coverImage: await coverDataUrl(svg).catch(() => BLANK_COVER),
            description: `${t.name}: the cut file as an SVG in millimetres, with a README of what each colour does. ${LICENSE_NOTE}`,
          }),
        );
        // The licence has to be SAID somewhere, and in the embed it cannot be a modal with a
        // link in it. It rides in the artifact's description, in the README inside the zip, and
        // here in words.
        if (sent) {
          toast(
            `Sent ${stem}.zip to MakerLab: the SVG and a sheet explaining its colours. `
              + 'Free for personal use; selling what you cut needs a commercial licence.',
            { kind: 'ok' },
          );
        }
        return;
      }

      downloadLaserStudioSvg(output, `${stem}.svg`, import.meta.env.VITE_BUILD_ID);
      downloads += 1;
      if (downloads === 1) openLicenseModal();
      else licenseReminderToast();
    },
    // Inside the host there is nowhere for a downloaded .json to go (`allowDownloads: false`),
    // and MakerWorld keeps the user's work itself, so the kit hides Save and Open there.
    hostOwnsProjects: MAKERLAB,
    onSave: () => downloadJSON(`${t.id}.laser-studio.json`, { template: t.id, values }),
    onLoad: (file?: File) =>
      file && loadJSON(file, (data) => {
        const d = data as { template?: string; values?: Values };
        if (d.template && d.template !== t.id) { leave(); opts.onSwitch(d.template, d.values ?? {}); return; }
        Object.assign(values, coerceValues(t, d.values));
        form.sync();
        rebuild(true);
        toast('Project loaded', { kind: 'ok' });
      }),
    onHelp: () =>
      dialog({
        title: 'Laser Studio help',
        content: el('div', {}, [
          el('p', { text: 'Type on the right. The categories on the left hold every setting, the font included; hover a "?" for what a control decides.' }),
          el('p', { text: '3D Preview shows the piece put together; drag to orbit. Export Preview is the file itself: red lines cut, blue lines score, black fills engrave.' }),
          el('p', {
            text: MAKERLAB
              // No Save/Open in the embed, and nothing is downloaded there — so the sentence
              // that describes them would be describing buttons that are not on screen.
              ? 'Drag the dashed ring on the preview to move the hole; arrow keys nudge it. Export cut file sends the SVG to MakerLab, in millimetres, zipped with a sheet saying what each colour does.'
              : 'Drag the dashed ring on the preview to move the hole; arrow keys nudge it. Download SVG saves millimetres, ready for LightBurn, xTool or Bambu Suite. Save keeps your settings as a small file you can load again.',
          }),
        ]),
        actions: [{ label: 'Got it', primary: true }],
      }),
    themeStorageKey: 'laser-studio-theme',
  });

  // The name alone. The blurb is on the gallery card, where it helps choose; here it was one
  // of three lines of copy above the first control.
  const header = generatorHeader({ title: t.name, hideCredit: true });

  const shell = appShell({
    // MakerWorld provides its own chrome, and the sandbox kills a `target="_blank"` anyway —
    // an outbound link in the embed is a dead button, not a link (invariant #7).
    topbar: MAKERLAB ? undefined : topbarLinks({ githubUrl: BRAND.urls.github, themeToggle: false }),
    left: {
      header: [back, header],
      scroll: [form.left],
      footer: [reset],
      // In the embed the byline is text, not a link: the sandbox opens no `target="_blank"`,
      // so the one outbound link left in this app would be a control that does nothing.
      credit: panelCredit({ title: 'Laser Studio', hostOwnsLinks: MAKERLAB, updates: { entries: CHANGELOG, title: 'Updates' } }),
    },
    stage: [stageHost],
    right: {
      scroll: [form.right],
      footer: [footer],
    },
  });
  shell.root.classList.add('ls-editor');
  rebuild(true);
  return shell.root;
}

function downloadJSON(name: string, data: unknown) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function loadJSON(file: File, apply: (data: unknown) => void) {
  const r = new FileReader();
  r.onload = () => {
    try { apply(JSON.parse(r.result as string)); } catch { toast('Invalid project file', { kind: 'error' }); }
  };
  r.readAsText(file);
}
