// Brand palette — lifted directly from the app's OG share image + tailwind config
// so the video reads as native to Let's Have A Word.
import { FONT_FAMILY } from './fonts';

export const COLORS = {
  // Background radial gradient (soft lavender) — center -> edge
  bgInner: '#efe9ff',
  bgMid: '#e5ddfb',
  bgOuter: '#dbd2f7',

  ink: '#111827', // near-black headline text
  inkSoft: '#6b7280', // muted grey sublabels
  white: '#ffffff',

  brandBlue: '#2D68C7',
  tileBlue: '#3b82f6', // letter-tile border
  tileGlow: 'rgba(147, 197, 253, 0.55)',
  taglineBlue: '#459df8', // "GUESS WORDS."
  taglineDeep: '#386ac3', // "WIN CRYPTO."

  accentPurple: '#7c3aed',

  ethGreen: '#16a34a', // prize amount
  eliminatedRed: '#ef4444',

  wheelWrong: '#dc2626', // wrong guesses on the wheel
  wheelGold: '#fbbf24', // the winning word
  wheelNeutral: '#bbbbbb', // un-guessed words
} as const;

export const FONT = FONT_FAMILY;

// Söhne weight map (German naming -> numeric)
export const W = {
  light: 300,
  book: 400,
  kraftig: 500,
  halbfett: 600,
  bold: 700,
  fett: 800,
  black: 900,
} as const;
