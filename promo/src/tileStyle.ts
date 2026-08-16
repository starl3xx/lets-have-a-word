import React from 'react';
import { COLORS, FONT, W } from './theme';

export type TileVariant = 'blue' | 'gold' | 'red';

export const tileBorder = (v: TileVariant) =>
  v === 'gold' ? COLORS.wheelGold : v === 'red' ? COLORS.eliminatedRed : COLORS.tileBlue;
export const tileText = (v: TileVariant) =>
  v === 'gold' ? '#a16207' : v === 'red' ? COLORS.eliminatedRed : COLORS.ink;
export const tileGlow = (v: TileVariant) =>
  v === 'gold'
    ? 'rgba(251,191,36,0.6)'
    : v === 'red'
    ? 'rgba(239,68,68,0.45)'
    : COLORS.tileGlow;

// The signature LHAW letter-tile box (white fill, thick colored border, soft glow).
export function tileBox(size: number, v: TileVariant): React.CSSProperties {
  return {
    width: size,
    height: size,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    border: `${Math.round(size * 0.06)}px solid ${tileBorder(v)}`,
    borderRadius: Math.round(size * 0.09),
    boxShadow: `0 0 0 ${Math.round(size * 0.035)}px ${tileGlow(v)}, 0 ${Math.round(
      size * 0.05
    )}px ${Math.round(size * 0.09)}px -2px rgba(0,0,0,0.18)`,
    fontFamily: FONT,
    fontWeight: W.fett,
    fontSize: size * 0.5,
    color: tileText(v),
  };
}
