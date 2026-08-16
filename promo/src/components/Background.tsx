import React from 'react';
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion';
import { COLORS, FONT, W } from '../theme';

// Faint scattered letters that slowly drift — echoes the app's OG share image,
// but with a gentle parallax so the background feels alive ("kinetic").
const SCATTER: { ch: string; x: number; y: number; size: number; op: number; drift: number }[] = [
  { ch: 'W', x: 4, y: 6, size: 150, op: 0.05, drift: 1 },
  { ch: 'H', x: 84, y: 12, size: 128, op: 0.04, drift: -1 },
  { ch: 'A', x: 9, y: 80, size: 168, op: 0.045, drift: 1.4 },
  { ch: 'R', x: 70, y: 70, size: 120, op: 0.04, drift: -1.2 },
  { ch: 'D', x: 88, y: 86, size: 140, op: 0.05, drift: 1 },
  { ch: 'G', x: 30, y: 4, size: 100, op: 0.035, drift: -0.8 },
  { ch: 'E', x: 60, y: 90, size: 108, op: 0.035, drift: 1.1 },
  { ch: 'S', x: 78, y: 26, size: 120, op: 0.04, drift: -1 },
  { ch: 'O', x: 16, y: 36, size: 96, op: 0.03, drift: 0.9 },
  { ch: 'N', x: 92, y: 50, size: 92, op: 0.03, drift: -0.7 },
  { ch: 'P', x: 50, y: 16, size: 112, op: 0.035, drift: 0.8 },
  { ch: 'C', x: 40, y: 52, size: 88, op: 0.03, drift: -0.9 },
  { ch: 'T', x: 22, y: 60, size: 100, op: 0.03, drift: 1 },
];

export const Background: React.FC<{ vignette?: boolean }> = ({ vignette = true }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at 50% 45%, ${COLORS.bgInner} 0%, ${COLORS.bgMid} 52%, ${COLORS.bgOuter} 100%)`,
        overflow: 'hidden',
      }}
    >
      {SCATTER.map((s, i) => {
        const dy = Math.sin((frame + i * 40) / 60) * 8 * s.drift;
        const dx = Math.cos((frame + i * 55) / 80) * 6 * s.drift;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${s.x}%`,
              top: `${s.y}%`,
              transform: `translate(${dx}px, ${dy}px)`,
              fontFamily: FONT,
              fontWeight: W.fett,
              fontSize: s.size,
              color: COLORS.ink,
              opacity: s.op,
              userSelect: 'none',
            }}
          >
            {s.ch}
          </div>
        );
      })}
      {vignette && (
        <AbsoluteFill
          style={{
            boxShadow: 'inset 0 0 220px 60px rgba(124, 58, 237, 0.10)',
            pointerEvents: 'none',
          }}
        />
      )}
    </AbsoluteFill>
  );
};
