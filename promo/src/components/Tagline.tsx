import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { COLORS, FONT, W } from '../theme';

// The two-tone signature lockup: "GUESS WORDS." (light blue) / "WIN CRYPTO." (deep blue)
export const Tagline: React.FC<{ startAt?: number; size?: number; stacked?: boolean }> = ({
  startAt = 0,
  size = 64,
  stacked = false,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const part = (i: number) => {
    const local = frame - startAt - i * 6;
    const s = spring({ frame: local, fps, config: { damping: 15, stiffness: 120 } });
    return {
      transform: `translateY(${interpolate(s, [0, 1], [22, 0])}px)`,
      opacity: interpolate(local, [0, 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
      display: 'inline-block',
    } as React.CSSProperties;
  };
  return (
    <div
      style={{
        fontFamily: FONT,
        fontWeight: W.fett,
        fontSize: size,
        display: 'flex',
        flexDirection: stacked ? 'column' : 'row',
        gap: stacked ? size * 0.1 : size * 0.28,
        alignItems: stacked ? 'center' : 'baseline',
        letterSpacing: '-0.01em',
      }}
    >
      <span style={{ ...part(0), color: COLORS.taglineBlue }}>GUESS WORDS.</span>
      <span style={{ ...part(1), color: COLORS.taglineDeep }}>WIN CRYPTO.</span>
    </div>
  );
};
