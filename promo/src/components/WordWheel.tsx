import React from 'react';
import { useCurrentFrame, interpolate, Easing } from 'remotion';
import { COLORS, FONT, W } from '../theme';

// Vertical 3D carousel of guesses that spins fast then decelerates to land the
// gold winning word at center — the app's signature "wheel of wrong guesses".

export const WordWheel: React.FC<{
  words: string[];
  winnerIndex: number;
  startAt?: number;
  duration?: number; // frames the spin takes
  rowHeight?: number;
  spinRows?: number; // how many words scroll past before landing
  fontSize?: number;
  showBand?: boolean;
}> = ({
  words,
  winnerIndex,
  startAt = 0,
  duration = 70,
  rowHeight = 132,
  spinRows = 26,
  fontSize = 92,
  showBand = true,
}) => {
  const frame = useCurrentFrame();
  const local = frame - startAt;
  const progress = interpolate(local, [0, duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    // fast launch, long glide, tiny settle — slot-machine feel
    easing: Easing.bezier(0.12, 0.7, 0.12, 1),
  });

  // Center index travels from (winner - spinRows) up to exactly winner.
  const rawCenter = interpolate(progress, [0, 1], [winnerIndex - spinRows, winnerIndex]);
  // Subtle settle overshoot as it locks in (last 12% of the spin).
  const settle = interpolate(local, [duration - 8, duration - 2, duration + 4], [0, -0.14, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const center = rawCenter + settle;

  const landed = local >= duration;
  const WINDOW = 5;
  const lo = Math.floor(center) - WINDOW;
  const hi = Math.ceil(center) + WINDOW;

  const rows: React.ReactNode[] = [];
  for (let j = lo; j <= hi; j++) {
    if (j < 0 || j >= words.length) continue;
    const dist = j - center;
    const ad = Math.abs(dist);
    const scale = interpolate(ad, [0, 3], [1.5, 0.82], { extrapolateRight: 'clamp' });
    const opacity = interpolate(ad, [0, 1, 4.5], [1, 0.62, 0.08], { extrapolateRight: 'clamp' });
    const ls = interpolate(ad, [0, 3], [0.22, 0.05], { extrapolateRight: 'clamp' });
    const blur = interpolate(ad, [0.5, 4], [0, 3], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const y = dist * rowHeight;

    const isWinner = j === winnerIndex;
    // Deterministic red/grey pattern for the "wrong guesses" so it looks lived-in.
    const wrong = (j * 7 + 3) % 5 !== 0;
    const color = isWinner ? COLORS.wheelGold : wrong ? COLORS.wheelWrong : COLORS.wheelNeutral;
    const winnerSettled = isWinner && landed;

    rows.push(
      <div
        key={j}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          textAlign: 'center',
          transform: `translateY(${y}px) translateY(-50%) scale(${scale})`,
          opacity,
          color,
          fontFamily: FONT,
          fontWeight: isWinner ? W.black : W.fett,
          fontSize,
          letterSpacing: `${ls}em`,
          filter: blur > 0.2 ? `blur(${blur}px)` : undefined,
          textShadow: winnerSettled ? '0 0 26px rgba(251,191,36,0.65)' : undefined,
          whiteSpace: 'nowrap',
          willChange: 'transform',
        }}
      >
        {words[j].toUpperCase()}
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {showBand && (
        <div
          style={{
            position: 'absolute',
            left: '6%',
            right: '6%',
            top: '50%',
            height: rowHeight * 1.18,
            transform: 'translateY(-50%)',
            borderRadius: 28,
            background: landed ? 'rgba(251,191,36,0.10)' : 'rgba(255,255,255,0.34)',
            boxShadow: landed
              ? 'inset 0 0 0 2px rgba(251,191,36,0.45)'
              : 'inset 0 0 0 1.5px rgba(255,255,255,0.6)',
            transition: 'background 0.2s',
          }}
        />
      )}
      {rows}
      {/* top/bottom fade so words dissolve at the edges */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'linear-gradient(to bottom, rgba(231,224,250,0.95) 0%, rgba(231,224,250,0) 26%, rgba(231,224,250,0) 74%, rgba(231,224,250,0.95) 100%)',
        }}
      />
    </div>
  );
};
