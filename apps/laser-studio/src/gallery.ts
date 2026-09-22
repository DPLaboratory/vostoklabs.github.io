// The front door: every template as a card, drawn from its own default build, in groups under
// plain headings — Keychains, Tags, Ornaments… — so the page reads as a catalogue rather than a
// grid of whatever was registered last (Ian, 2026-09-21: "the main menu grid seems very ad hoc").
// Click a card and the editor opens on it.
import { galleryCard, galleryGrid, segmentedControl, themeToggleButton, topbarLinks, el } from '@vostok/ui-kit';
import { BRAND } from '@vostok/brand';
import { MAKERLAB } from 'virtual:makerlab';
import { TEMPLATES, type TemplateDef } from './templates';
import { thumbSvg } from './preview';
import { thumbnailFor } from './thumbs';

/** The groups, in the order they are shown, each the customer's word for the object and the
 *  first tags it collects (design guidelines §2.3). A tag no group names gets a group of its own
 *  at the end, so a new category is never lost — only unsorted. */
const GROUPS: { key: string; title: string; tags: string[] }[] = [
  { key: 'keychain', title: 'Keychains & charms', tags: ['keychain'] },
  { key: 'tag', title: 'Tags', tags: ['tag'] },
  { key: 'ornament', title: 'Ornaments', tags: ['ornament'] },
  { key: 'sign', title: 'Signs & stands', tags: ['sign'] },
  { key: 'party', title: 'Party & weddings', tags: ['party'] },
  { key: 'home', title: 'Home & office', tags: ['home', 'card'] },
  { key: 'games', title: 'Toys & games', tags: ['kids', 'games'] },
];

const titleOf = (key: string) => GROUPS.find((g) => g.key === key)?.title ?? key.charAt(0).toUpperCase() + key.slice(1);
const groupKeyOf = (tag: string) => GROUPS.find((g) => g.tags.includes(tag))?.key ?? tag;

export function createGallery(onPick: (t: TemplateDef) => void): HTMLElement {
  // A card is the picture, the name and one line. The tags it used to wear said what the
  // heading now says.
  const cardOf = (t: TemplateDef) => {
    const card = galleryCard({ name: t.name, blurb: t.blurb, onClick: () => onPick(t) });
    card.setAttribute('data-template', t.id);
    card.setAttribute('data-category', t.tags[0] ?? '');
    void thumbnailFor(t).then((out) => { if (out) card.setThumb(thumbSvg(out, 0.15)); });
    return card;
  };

  const keys = [...GROUPS.map((g) => g.key), ...new Set(TEMPLATES.map((t) => groupKeyOf(t.tags[0] ?? '')))].filter((k, i, all) => k && all.indexOf(k) === i);
  const groups = keys
    .map((key) => ({ key, templates: TEMPLATES.filter((t) => groupKeyOf(t.tags[0] ?? '') === key) }))
    .filter((g) => g.templates.length)
    .map(({ key, templates }) => {
      const node = el('section', { className: 'ls-gallery__group' }, [
        el('h2', { className: 'ls-gallery__group-title' }, [
          document.createTextNode(titleOf(key)),
          el('span', { className: 'ls-gallery__count', text: String(templates.length) }),
        ]),
        galleryGrid({ cards: templates.map(cardOf), minPx: 230 }),
      ]);
      node.setAttribute('data-group', key);
      return { key, node };
    });

  // The chips show one group or all of them; they read the same keys the headings do.
  const filter = segmentedControl<string>({
    options: [{ value: 'all', label: 'All' }, ...groups.map((g) => ({ value: g.key, label: titleOf(g.key) }))],
    value: 'all',
    onChange: (key) => { for (const g of groups) g.node.classList.toggle('hidden', key !== 'all' && g.key !== key); },
  });
  filter.classList.add('ls-gallery__filter');

  const header = el('header', { className: 'ls-gallery__header' }, [
    el('div', {}, [
      el('h1', { className: 'vl-app-title', text: 'Laser Studio' }),
      el('p', {
        className: 'vl-app-subtitle',
        text: MAKERLAB
          ? 'Pick a design, type your text, send the cut file to MakerLab.'
          : 'Pick a design, type your text, download the cut file.',
      }),
    ]),
  ]);

  // The theme switch is the topbar's own, in the topbar's style — not a stray button in the
  // page header.
  //
  // Inside MakerLab the topbar's other four buttons (GitHub, the commercial licence, Boost,
  // Ko-fi) are all `target="_blank"`, which the host's sandbox kills — they would render as
  // four buttons that do nothing. MakerWorld draws its own chrome anyway. So the bar goes, and
  // the one control that is still ours and still works stays: the theme toggle, which the
  // editor keeps in its footer either way.
  const topbar = MAKERLAB
    ? el('header', { className: 'vl-topbar' }, [
        el('div', { className: 'vl-topbar-group' }),
        el('div', { className: 'vl-topbar-group' }, [
          themeToggleButton({ storageKey: 'laser-studio-theme', className: 'vl-topbar-btn vl-topbar-btn--theme' }),
        ]),
      ])
    : topbarLinks({ githubUrl: BRAND.urls.github, themeToggle: true, themeStorageKey: 'laser-studio-theme' });

  return el('div', { className: 'ls-gallery' }, [
    topbar,
    el('div', { className: 'ls-gallery__page' }, [header, filter, ...groups.map((g) => g.node)]),
  ]);
}
