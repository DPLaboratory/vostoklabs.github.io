import '@vostok/ui-kit/styles.css';
import '@vostok/fonts/fonts.css';
import './style.css';

import { applyTheme, resolveTheme } from '@vostok/ui-kit';
import { MAKERLAB, initMakerlab } from 'virtual:makerlab';
import { templateById, type Values } from './templates';
import { createGallery } from './gallery';
import { createEditor } from './editor';

/*
  Laser Studio — a gallery of laser designs, each with a short form and a download.

  Two screens and a hash: `#/` is the gallery, `#/t/<template>` is that template's editor.
  Everything a design needs to say lives in src/templates/<id>.ts (a form schema and one
  build function); the engine, the preview, the form renderer and the export are shared.
  Plan and the reuse map: README.md.
*/

const app = document.getElementById('app')!;
applyTheme(resolveTheme('laser-studio-theme'), 'laser-studio-theme');

/* The MakerLab handshake, as early as it can go, and exactly ONCE — here rather than in the
   editor, which is built fresh for every template the user opens. `MAKERLAB` is the literal
   `false` in every other build, so the bundler drops this and the SDK import with it. Not
   awaited: the gallery and the editor work while it is in flight, and the export path checks
   `isReady()` for itself (and reconnects) at the moment it actually needs the host. */
if (MAKERLAB) {
  void initMakerlab({
    onDisconnect: () => console.warn('[laser-studio] MakerLab disconnected; the next export will reconnect.'),
  });
}

/** Values carried from one template to the next: the ones whose key the new one also has. */
let carried: Values = {};

function show(node: HTMLElement) {
  app.replaceChildren(node);
  window.scrollTo(0, 0);
}

function route() {
  const m = /^#\/t\/([\w-]+)/.exec(location.hash);
  const t = m ? templateById(m[1]!) : undefined;
  if (!t) {
    if (location.hash && location.hash !== '#/') history.replaceState(null, '', '#/');
    show(createGallery((picked) => { location.hash = `#/t/${picked.id}`; }));
    return;
  }
  show(createEditor({
    template: t,
    values: carried,
    onBack: () => { carried = {}; location.hash = '#/'; },
    onSwitch: (id, values) => { carried = { ...values }; location.hash = `#/t/${id}`; },
  }));
  carried = {};
}

window.addEventListener('hashchange', route);
route();
