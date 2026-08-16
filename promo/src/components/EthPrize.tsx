import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from 'remotion';
import { COLORS, FONT, W } from '../theme';

// A green ETH prize amount that counts up — the payoff moment.
export const EthPrize: React.FC<{
  to: number;
  from?: number;
  startAt?: number;
  countFrames?: number;
  size?: number;
  label?: string;
}> = ({ to, from = 0, startAt = 0, countFrames = 28, size = 130, label = 'prize pool' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - startAt;
  const pop = spring({ frame: local, fps, config: { damping: 12, stiffness: 140, mass: 0.7 } });
  const scale = interpolate(pop, [0, 1], [0.7, 1]);
  const opacity = interpolate(local, [0, 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const t = interpolate(local, [0, countFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const value = (from + (to - from) * t).toFixed(4);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        transform: `scale(${scale})`,
        opacity,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: size * 0.12 }}>
        <span style={{ fontFamily: FONT, fontWeight: W.black, fontSize: size, color: COLORS.ethGreen, lineHeight: 1 }}>
          {value}
        </span>
        <span style={{ fontFamily: FONT, fontWeight: W.fett, fontSize: size * 0.5, color: COLORS.ethGreen, lineHeight: 1 }}>
          ETH
        </span>
      </div>
      <span style={{ fontFamily: FONT, fontWeight: W.book, fontSize: size * 0.32, color: COLORS.inkSoft, marginTop: size * 0.08 }}>
        {label}
      </span>
    </div>
  );
};
