/**
 * GET /api/wordmarks/image/<id>.png — the Wordmark tile, 1000x1000.
 *
 * Treatment B with the plinth: coloured ground, white disc with its ring, the
 * glyph, the achievement name, and a band across the base carrying the W mark
 * and the game's name. Drawn from WORDMARK_DEFINITIONS and WORDMARK_COLORS, so
 * the token art and the in-app Wordmark cannot drift apart.
 *
 * THE EMOJI IS NOT A SYSTEM EMOJI. Satori's `emoji: 'twemoji'` resolves each
 * glyph to a Twemoji SVG, which matters more here than anywhere else in the
 * app: an image the contract points at must look the same to everyone, and
 * Apple's trophy and Google's trophy are different drawings. It is also a real
 * vector, so it stays crisp at 1000px where a system emoji is a bitmap.
 *
 * Reuses the Soehne TTFs already loaded for /api/og/share, so the art is set in
 * the game's own typeface and no new font asset is added.
 */

import { ImageResponse } from '@vercel/og';
import type { NextApiRequest, NextApiResponse } from 'next';
import { readFileSync } from 'fs';
import { join } from 'path';
import { WORDMARK_DEFINITIONS } from '../../../../src/lib/wordmarks';
import { wordmarkTypeForTokenId } from '../../../../src/lib/wordmark-tokens';

const soehneFett = readFileSync(join(process.cwd(), 'public/fonts/soehne-fett.ttf'));
const soehneHalbfett = readFileSync(join(process.cwd(), 'public/fonts/soehne-halbfett.ttf'));

const S = 1000;

/**
 * The five stops each tile is built from, per colour family.
 *
 * Written out rather than imported from components/wordmark-display.ts, which
 * carries Tailwind class strings for the app and only two of the five values.
 * These are the literal hexes of the Tailwind ramps the classes resolve to.
 */
const RAMPS: Record<string, [string, string, string, string, string]> = {
  //          50         100        200        300        700/800 ink
  purple:  ['#faf5ff', '#f3e8ff', '#e9d5ff', '#d8b4fe', '#7e22ce'],
  cyan:    ['#ecfeff', '#cffafe', '#a5f3fc', '#67e8f9', '#0e7490'],
  amber:   ['#fffbeb', '#fef3c7', '#fde68a', '#fcd34d', '#b45309'],
  indigo:  ['#eef2ff', '#e0e7ff', '#c7d2fe', '#a5b4fc', '#4338ca'],
  rose:    ['#fff1f2', '#ffe4e6', '#fecdd3', '#fda4af', '#be123c'],
  emerald: ['#ecfdf5', '#d1fae5', '#a7f3d0', '#6ee7b7', '#047857'],
  sky:     ['#f0f9ff', '#e0f2fe', '#bae6fd', '#7dd3fc', '#0369a1'],
  orange:  ['#fff7ed', '#ffedd5', '#fed7aa', '#fdba74', '#c2410c'],
  red:     ['#fef2f2', '#fee2e2', '#fecaca', '#fca5a5', '#b91c1c'],
  violet:  ['#f5f3ff', '#ede9fe', '#ddd6fe', '#c4b5fd', '#6d28d9'],
  pink:    ['#fdf2f8', '#fce7f3', '#fbcfe8', '#f9a8d4', '#be185d'],
  teal:    ['#f0fdfa', '#ccfbf1', '#99f6e4', '#5eead4', '#0f766e'],
};

const FALLBACK: [string, string, string, string, string] =
  ['#f9fafb', '#f3f4f6', '#e5e7eb', '#d1d5db', '#374151'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const raw = String(req.query.id ?? '').replace(/\.png$/i, '');
  const type = wordmarkTypeForTokenId(Number(raw));

  if (!type) {
    return res.status(404).json({ error: 'No such Wordmark' });
  }

  const def = WORDMARK_DEFINITIONS[type];
  const [c50, c100, c200, c300, ink] = RAMPS[def.color] ?? FALLBACK;

  const PLINTH = Math.round(S * 0.17);

  const image = new ImageResponse(
    (
      <div
        style={{
          width: S,
          height: S,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          // Reserve the band rather than overlaying it. Overlaying is what put
          // the disc and the name behind the plinth in the first mockup.
          paddingBottom: PLINTH,
          background: `linear-gradient(160deg, ${c50} 0%, ${c100} 46%, ${c200} 100%)`,
          position: 'relative',
          fontFamily: 'Soehne',
        }}
      >
        <div
          style={{
            width: S * 0.5,
            height: S * 0.5,
            borderRadius: S,
            background: '#ffffff',
            border: `${Math.round(S * 0.015)}px solid ${c300}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: S * 0.045,
          }}
        >
          <span style={{ fontSize: S * 0.25, lineHeight: 1 }}>{def.emoji}</span>
        </div>

        <span
          style={{
            fontSize: S * 0.068,
            fontWeight: 700,
            color: ink,
            textAlign: 'center',
            padding: `0 ${S * 0.06}px`,
          }}
        >
          {def.name}
        </span>

        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: PLINTH,
            background: ink,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: S * 0.08,
              height: S * 0.08,
              borderRadius: S * 0.018,
              background: c50,
              color: ink,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: S * 0.052,
              fontWeight: 700,
              marginRight: S * 0.024,
            }}
          >
            W
          </div>
          {/* Tracking is applied to the words only. Letter-spacing puts a
              trailing space after every character including the D, which parks
              the exclamation a full space away and reads as a stray mark. */}
          <span
            style={{
              fontSize: S * 0.05,
              fontWeight: 700,
              color: '#ffffff',
              letterSpacing: S * 0.05 * 0.035,
            }}
          >
            LET’S HAVE A WORD
          </span>
          <span style={{ fontSize: S * 0.05, fontWeight: 700, color: '#ffffff' }}>!</span>
        </div>
      </div>
    ),
    {
      width: S,
      height: S,
      fonts: [
        { name: 'Soehne', data: soehneFett, weight: 700, style: 'normal' },
        { name: 'Soehne', data: soehneHalbfett, weight: 600, style: 'normal' },
      ],
      // Consistent across every platform, and a real vector at this size.
      emoji: 'twemoji',
    }
  );

  const body = Buffer.from(await image.arrayBuffer());
  res.setHeader('Content-Type', 'image/png');
  // An id's artwork never changes, so this is safe to cache hard.
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, immutable');
  return res.status(200).send(body);
}
