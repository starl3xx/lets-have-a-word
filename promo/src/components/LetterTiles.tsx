import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { COLORS, FONT, W } from '../theme';

type Variant = 'blue' | 'gold' | 'red';

const border = (v: Variant) =>
  v === 'gold' ? COLORS.wheelGold : v === 'red' ? COLORS.eliminatedRed : COLORS.tileBlue;
const glow = (v: Variant) =>
  v === 'gold'
    ? 'rgba(251, 191, 36, 0.55)'
    : v === 'red'
    ? 'rgba(239, 68, 68, 0.45)'
    : COLORS.tileGlow;

export const LetterTiles: React.FC<{
  word: string;
  /** local frame at which the staggered flip begins */
  startAt?: number;
  size?: number;
  gap?: number;
  variant?: Variant | Variant[];
  /** stagger between tiles, in frames */
  stagger?: number;
}> = ({ word, startAt = 0, size = 150, gap = 18, variant = 'blue', stagger = 5 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const letters = word.toUpperCase().split('');

  return (
    <div style={{ display: 'flex', gap }}>
      {letters.map((ch, i) => {
        const local = frame - startAt - i * stagger;
        const flip = spring({ frame: local, fps, config: { damping: 14, stiffness: 120, mass: 0.7 } });
        const rotateX = interpolate(flip, [0, 1], [92, 0]);
        const pop = interpolate(flip, [0, 0.7, 1], [0.6, 1.06, 1], { extrapolateRight: 'clamp' });
        const opacity = interpolate(local, [0, 4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        const v: Variant = Array.isArray(variant) ? variant[i] ?? 'blue' : variant;
        const b = border(v);
        return (
          <div
            key={i}
            style={{
              width: size,
              height: size,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: COLORS.white,
              border: `${Math.round(size * 0.06)}px solid ${b}`,
              borderRadius: Math.round(size * 0.09),
              boxShadow: `0 0 0 ${Math.round(size * 0.035)}px ${glow(v)}, 0 ${Math.round(
                size * 0.05
              )}px ${Math.round(size * 0.09)}px -2px rgba(0,0,0,0.18)`,
              fontFamily: FONT,
              fontWeight: W.fett,
              fontSize: size * 0.5,
              color: COLORS.ink,
              transform: `perspective(900px) rotateX(${rotateX}deg) scale(${pop})`,
              opacity,
            }}
          >
            {ch}
          </div>
        );
      })}
    </div>
  );
};
