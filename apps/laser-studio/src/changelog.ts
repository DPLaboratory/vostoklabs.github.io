import type { ChangelogEntry } from '@vostok/ui-kit';

/*
  The update timeline behind the sidebar's Updates button. Say what changed for the person
  holding the part, not what changed in the source, and only what SHIPPED.
*/
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-09-22',
    title: 'Laser Studio is live',
    changes: [
      { kind: 'added', text: 'Forty-two designs, on the Vostok Labs site — keychains, pet and luggage tags, ornaments, QR stands, coasters, cake toppers, signs and pattern fills.' },
      { kind: 'added', text: 'A MakerWorld version, where the cut file goes straight to MakerLab instead of your downloads folder.' },
    ],
  },
  {
    date: '2026-09-21',
    title: 'Five QR display stands',
    changes: [
      { kind: 'added', text: 'One QR display stand template with leaning plaque, curved foot, sign-in plaque, double QR and rounded-corner styles.' },
      { kind: 'added', text: 'Personalize the lettering, QR symbols and logo; export matching base parts and separate QR plaques for layered styles.' },
    ],
  },
  {
    date: '2026-09-20',
    title: 'Editable symbols and a quieter workspace',
    changes: [
      { kind: 'added', text: 'A visual symbol library with monochrome emoji, filled icons, search and your own SVG imports.' },
      { kind: 'added', text: 'Drag symbols within your text. Select one to resize, offset, rotate, replace or remove it; project saves keep its geometry.' },
      { kind: 'added', text: '2D Design, an orbitable 3D material preview, and a dedicated Export Preview with operation colors.' },
      { kind: 'changed', text: 'Compact symbol actions and contextual settings keep the text visible and the workspace quieter.' },
    ],
  },
  {
    date: '2026-09-19',
    title: 'First version',
    changes: [
      { kind: 'added', text: 'A gallery of laser designs. Pick one, type your text, download the SVG — red cuts, blue scores, black engraves.' },
      { kind: 'added', text: 'Name keychain, name tag, symbol charm and connected text to start with; every font in the library, every symbol.' },
    ],
  },
];

