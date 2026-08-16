import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { COLORS, FONT, W } from '../theme';

// A headline that rises and fades in with a spring; optionally staggers per word.
export const KineticText: React.FC<{
  text: string;
  startAt?: number;
  size?: number;
  weight?: number;
  color?: string;
  perWord?: boolean;
  stagger?: number;
  lineHeight?: number;
  letterSpacing?: string;
  align?: 'center' | 'left';
  maxWidth?: number;
  outAt?: number; // local frame to start fading out
}> = ({
  text,
  startAt = 0,
  size = 92,
  weight = W.black,
  color = COLORS.ink,
  perWord = false,
  stagger = 4,
  lineHeight = 1.02,
  letterSpacing = '-0.01em',
  align = 'center',
  maxWidth,
  outAt,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeOut = outAt != null ? interpolate(frame, [outAt, outAt + 10], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  }) : 1;

  const renderUnit = (content: string, idx: number) => {
    const local = frame - startAt - idx * stagger;
    const s = spring({ frame: local, fps, config: { damping: 16, stiffness: 110, mass: 0.8 } });
    const y = interpolate(s, [0, 1], [38, 0]);
    const op = interpolate(local, [0, 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    return (
      <span
        key={idx}
        style={{
          display: 'inline-block',
          transform: `translateY(${y}px)`,
          opacity: op,
          marginRight: perWord ? '0.28em' : undefined,
        }}
      >
        {content}
      </span>
    );
  };

  const units = perWord ? text.split(' ') : [text];

  return (
    <div
      style={{
        fontFamily: FONT,
        fontWeight: weight,
        fontSize: size,
        color,
        lineHeight,
        letterSpacing,
        textAlign: align,
        maxWidth,
        opacity: fadeOut,
      }}
    >
      {units.map((u, i) => renderUnit(u, i))}
    </div>
  );
};
