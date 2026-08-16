import React from 'react';
import { Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { COLORS, FONT, W } from '../theme';
import { Tagline } from './Tagline';

// End card: app icon + wordmark + tagline + where to play.
export const CtaCard: React.FC<{ startAt?: number }> = ({ startAt = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - startAt;
  const iconSpring = spring({ frame: local, fps, config: { damping: 11, stiffness: 130, mass: 0.8 } });
  const iconScale = interpolate(iconSpring, [0, 1], [0.5, 1]);
  const iconRot = interpolate(iconSpring, [0, 1], [-12, 0]);

  const wordmarkLocal = local - 8;
  const wmSpring = spring({ frame: wordmarkLocal, fps, config: { damping: 16, stiffness: 110 } });
  const wmY = interpolate(wmSpring, [0, 1], [30, 0]);
  const wmOp = interpolate(wordmarkLocal, [0, 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const handleLocal = local - 26;
  const hOp = interpolate(handleLocal, [0, 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 30,
      }}
    >
      <Img
        src={staticFile('LHAW-icon.png')}
        style={{
          width: 200,
          height: 200,
          borderRadius: 42,
          boxShadow: '0 20px 48px -12px rgba(45,104,199,0.45)',
          transform: `scale(${iconScale}) rotate(${iconRot}deg)`,
        }}
      />
      <div
        style={{
          fontFamily: FONT,
          fontWeight: W.black,
          fontSize: 86,
          color: COLORS.ink,
          letterSpacing: '-0.02em',
          transform: `translateY(${wmY}px)`,
          opacity: wmOp,
          textAlign: 'center',
        }}
      >
        Let&rsquo;s Have A Word!
      </div>
      <div style={{ marginTop: 6 }}>
        <Tagline startAt={startAt + 14} size={62} />
      </div>
      <div
        style={{
          marginTop: 18,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          opacity: hOp,
          fontFamily: FONT,
        }}
      >
        <span
          style={{
            fontWeight: W.fett,
            fontSize: 40,
            color: COLORS.white,
            background: COLORS.brandBlue,
            padding: '14px 34px',
            borderRadius: 9999,
            boxShadow: '0 8px 22px -8px rgba(45,104,199,0.6)',
          }}
        >
          letshaveaword.fun
        </span>
        <span style={{ fontWeight: W.kraftig, fontSize: 38, color: COLORS.inkSoft }}>
          on Farcaster
        </span>
      </div>
    </div>
  );
};
