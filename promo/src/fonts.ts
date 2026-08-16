import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

// Söhne — the app's brand typeface. We register the weights used in the promo.
// loadFont returns a promise; Remotion's <Composition> render waits on font loads
// triggered before the first frame, so register at module scope.
export const FONT_FAMILY = 'Soehne';

const WEIGHTS: { file: string; weight: string }[] = [
  { file: 'soehne-leicht.woff2', weight: '300' },
  { file: 'soehne-buch.woff2', weight: '400' },
  { file: 'soehne-kraftig.woff2', weight: '500' },
  { file: 'soehne-halbfett.woff2', weight: '600' },
  { file: 'soehne-dreiviertelfett.woff2', weight: '700' },
  { file: 'soehne-fett.woff2', weight: '800' },
  { file: 'soehne-extrafett.woff2', weight: '900' },
];

export const fontsReady = Promise.all(
  WEIGHTS.map(({ file, weight }) =>
    loadFont({
      family: FONT_FAMILY,
      url: staticFile(`fonts/${file}`),
      weight,
      format: 'woff2',
    })
  )
);
