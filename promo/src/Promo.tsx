import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  Easing,
} from 'remotion';
import { COLORS, FONT, W } from './theme';
import { Background } from './components/Background';
import { LetterTiles } from './components/LetterTiles';
import { WordWheel } from './components/WordWheel';
import { EthPrize } from './components/EthPrize';
import { StatPill } from './components/StatPill';
import { Tagline } from './components/Tagline';
import { tileBox, TileVariant } from './tileStyle';
import { buildWheel } from './words';

// ---- Story constants -------------------------------------------------------
const GUESS = 'CRANE';
const WINNER = 'MONEY';
const ROUND = 42;
const PRIZE = 0.042;
const wheelData = buildWheel(WINNER, 40);

// Contiguous frame plan @30fps -> 630 frames (21.0s)
export const PROMO_FRAMES = 630;
const S = {
  money: [0, 54],
  same: [54, 123],
  type: [123, 213],
  elim: [213, 276],
  wheel: [276, 456], // S5+S6 share the spinning wheel
  s5cap: [276, 372],
  s6cap: [372, 456],
  payout: [456, 528],
  fair: [528, 570],
  cta: [570, 630],
} as const;
const dur = (k: keyof typeof S) => S[k][1] - S[k][0];

// ---- small helpers ---------------------------------------------------------
const appIconTL = (
  <Img
    src={staticFile('LHAW-icon-og.png')}
    style={{ position: 'absolute', top: 56, left: 56, width: 72, height: 72, borderRadius: 16 }}
  />
);

const Line: React.FC<{
  children: React.ReactNode;
  startAt: number;
  delay?: number;
  size: number;
  weight?: number;
  color?: string;
}> = ({ children, startAt, delay = 0, size, weight = W.black, color = COLORS.ink }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - startAt - delay;
  const s = spring({ frame: local, fps, config: { damping: 16, stiffness: 110, mass: 0.8 } });
  const y = interpolate(s, [0, 1], [34, 0]);
  const op = interpolate(local, [0, 7], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div
      style={{
        fontFamily: FONT,
        fontWeight: weight,
        fontSize: size,
        color,
        lineHeight: 1.04,
        letterSpacing: '-0.015em',
        textAlign: 'center',
        transform: `translateY(${y}px)`,
        opacity: op,
      }}
    >
      {children}
    </div>
  );
};

// ===========================================================================
// S1 — money hook
const MoneyHook: React.FC = () => (
  <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 26 }}>
    <Img src={staticFile('LHAW-icon-og.png')} style={{ width: 116, height: 116, borderRadius: 26 }} />
    <EthPrize to={PRIZE} from={0.0398} startAt={0} countFrames={30} size={168} />
  </AbsoluteFill>
);

// ===========================================================================
// S2 — "everyone hunts the same word" + empty tiles snap in
const SameWordHook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tagS = spring({ frame, fps, config: { damping: 14, stiffness: 130 } });
  const tagY = interpolate(tagS, [0, 1], [-18, 0]);
  const tagOp = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  const sameLocal = frame - 22;
  const sameS = spring({ frame: sameLocal, fps, config: { damping: 9, stiffness: 150 } });
  const sameScale = interpolate(sameS, [0, 1], [1.12, 1], { extrapolateLeft: 'clamp' });
  const sameOp = interpolate(sameLocal, [0, 5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill>
      {appIconTL}
      <div
        style={{
          position: 'absolute', top: 110, left: 0, right: 0, textAlign: 'center',
          fontFamily: FONT, fontWeight: W.bold, fontSize: 34, color: COLORS.ethGreen,
          transform: `translateY(${tagY}px)`, opacity: tagOp,
        }}
      >
        {PRIZE.toFixed(4)} ETH <span style={{ color: COLORS.inkSoft, fontWeight: W.book }}> · prize pool</span>
      </div>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 60 }}>
        <div>
          <Line startAt={0} size={92} weight={W.black}>EVERYONE HUNTS</Line>
          <div style={{ textAlign: 'center' }}>
            <span style={{ fontFamily: FONT, fontWeight: W.black, fontSize: 92, color: COLORS.ink, letterSpacing: '-0.015em' }}>THE </span>
            <span style={{ display: 'inline-block', fontFamily: FONT, fontWeight: W.black, fontSize: 92, color: COLORS.brandBlue, letterSpacing: '-0.015em', transform: `scale(${sameScale})`, opacity: sameOp }}>SAME</span>
            <span style={{ fontFamily: FONT, fontWeight: W.black, fontSize: 92, color: COLORS.ink, letterSpacing: '-0.015em' }}> WORD</span>
          </div>
        </div>
        <LetterTiles word="     " startAt={28} size={142} stagger={3} variant="blue" />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ===========================================================================
// S3 — type a guess (letters key in with caret) + stat pills count up
const TypeGuess: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const letters = GUESS.split('');
  const size = 150, gap = 18;
  const typeStart = 6, typeStagger = 9;
  const active = Math.min(letters.length, Math.max(0, Math.floor((frame - typeStart) / typeStagger) + 1));
  const caretOn = active < letters.length && (frame % 18 < 10);

  const pillStart = 52;
  const guesses = Math.round(interpolate(frame, [pillStart, pillStart + 28], [40, 1500], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) }));
  const players = Math.round(interpolate(frame, [pillStart, pillStart + 28], [3, 300], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) }));
  const pillS = spring({ frame: frame - pillStart, fps, config: { damping: 16, stiffness: 120 } });
  const pillY = interpolate(pillS, [0, 1], [18, 0]);
  const pillOp = interpolate(frame - pillStart, [0, 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 46 }}>
      {appIconTL}
      <div style={{ position: 'relative', display: 'flex', gap }}>
        {letters.map((ch, i) => {
          const local = frame - typeStart - i * typeStagger;
          const shown = local >= 0;
          const pop = spring({ frame: local, fps, config: { damping: 11, stiffness: 200, mass: 0.5 } });
          const sc = shown ? interpolate(pop, [0, 0.6, 1], [0.4, 1.12, 1], { extrapolateRight: 'clamp' }) : 0;
          return (
            <div key={i} style={tileBox(size, 'blue')}>
              <span style={{ display: 'inline-block', transform: `scale(${sc})`, opacity: shown ? 1 : 0 }}>{ch}</span>
            </div>
          );
        })}
        {caretOn && (
          <div
            style={{
              position: 'absolute', top: size * 0.18, height: size * 0.64, width: 7,
              left: active * (size + gap) - gap + 6, background: COLORS.tileBlue, borderRadius: 4,
            }}
          />
        )}
      </div>
      <div style={{ fontFamily: FONT, fontWeight: W.kraftig, fontSize: 40, color: COLORS.inkSoft, letterSpacing: '0.02em' }}>
        GUESS THE WORD
      </div>
      <div style={{ display: 'flex', gap: 22, transform: `translateY(${pillY}px)`, opacity: pillOp }}>
        <StatPill value={guesses.toLocaleString()} label="guesses" />
        <StatPill value={players.toLocaleString()} label="players" />
      </div>
    </AbsoluteFill>
  );
};

// ===========================================================================
// S4 — ELIMINATED: tiles flip blue -> red
const EliminatedFlip: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const letters = GUESS.split('');
  const size = 150, gap = 18;
  const flipStart = 6, stagger = 2;

  const stampLocal = frame - 8;
  const stampS = spring({ frame: stampLocal, fps, config: { damping: 9, stiffness: 170 } });
  const stampSc = interpolate(stampS, [0, 1], [1.18, 1], { extrapolateLeft: 'clamp' });
  const stampOp = interpolate(stampLocal, [0, 5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const shake = stampLocal >= 0 && stampLocal < 6 ? Math.sin(stampLocal * 3) * 3 : 0;

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 56 }}>
      {appIconTL}
      <div
        style={{
          fontFamily: FONT, fontWeight: W.bold, fontSize: 56, color: COLORS.eliminatedRed,
          letterSpacing: '10px', transform: `translateX(${shake}px) scale(${stampSc})`, opacity: stampOp,
        }}
      >
        ELIMINATED
      </div>
      <div style={{ display: 'flex', gap }}>
        {letters.map((ch, i) => {
          const local = frame - flipStart - i * stagger;
          const rot = interpolate(local, [0, 9], [0, 180], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          const v: TileVariant = rot >= 90 ? 'red' : 'blue';
          return (
            <div key={i} style={{ ...tileBox(size, v), transform: `perspective(900px) rotateX(${rot}deg)` }}>
              <span style={{ display: 'inline-block', transform: `rotateX(${rot >= 90 ? 180 : 0}deg)` }}>{ch}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ===========================================================================
// S5+S6 — the shared spinning wheel
const WheelScene: React.FC = () => {
  const frame = useCurrentFrame();
  // fling: a compact red GUESS row drops into the wheel + purple ripple
  const flingY = interpolate(frame, [0, 16], [-40, 260], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
  const flingScale = interpolate(frame, [0, 16], [0.6, 0.42], { extrapolateRight: 'clamp' });
  const flingOp = interpolate(frame, [0, 10, 18], [0, 1, 0], { extrapolateRight: 'clamp' });
  const ripple = interpolate(frame, [12, 36], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const rippleOp = interpolate(frame, [12, 36], [0.5, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill>
      {appIconTL}
      <WordWheel
        words={wheelData.words}
        winnerIndex={wheelData.winnerIndex}
        startAt={12}
        duration={150}
        rowHeight={130}
        spinRows={26}
        fontSize={92}
      />
      {/* purple "joins the shared wheel" ripple */}
      <div
        style={{
          position: 'absolute', left: '50%', top: '50%', width: 200, height: 200,
          marginLeft: -100, marginTop: -100, borderRadius: '50%',
          border: `4px solid ${COLORS.accentPurple}`, transform: `scale(${ripple * 1.8})`, opacity: rippleOp,
        }}
      />
      {/* flung guess row */}
      <div
        style={{
          position: 'absolute', left: 0, right: 0, top: '50%', textAlign: 'center',
          transform: `translateY(${flingY}px) scale(${flingScale})`, opacity: flingOp,
          fontFamily: FONT, fontWeight: W.black, fontSize: 92, color: COLORS.wheelWrong, letterSpacing: '0.1em',
        }}
      >
        {GUESS}
      </div>
    </AbsoluteFill>
  );
};

const WheelCaption: React.FC<{ a: React.ReactNode; b: React.ReactNode }> = ({ a, b }) => (
  <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-start', paddingTop: 96 }}>
    <div style={{ textAlign: 'center' }}>
      <Line startAt={0} size={62} weight={W.fett}>{a}</Line>
      <Line startAt={0} delay={4} size={62} weight={W.fett}>{b}</Line>
    </div>
  </AbsoluteFill>
);

// ===========================================================================
// S7 — animated OG payout card
const PayoutCard: React.FC = () => {
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
      <Img src={staticFile('LHAW-icon-og.png')} style={{ width: 84, height: 84, borderRadius: 18, marginBottom: 10 }} />
      <Line startAt={0} delay={3} size={50} weight={W.fett}>Round #{ROUND}</Line>
      <div style={{ marginTop: 8, marginBottom: 22 }}>
        <EthPrize to={PRIZE} from={0} startAt={6} countFrames={22} size={92} />
      </div>
      <div style={{ fontFamily: FONT, fontWeight: W.bold, fontSize: 38, color: '#a16207', letterSpacing: '9px', marginBottom: 14 }}>
        SOLVED
      </div>
      <LetterTiles word={WINNER} startAt={10} size={128} stagger={3} variant="gold" />
      <div style={{ display: 'flex', gap: 20, marginTop: 30 }}>
        <StatPill value="1,500" label="guesses" scale={0.82} />
        <StatPill value="300" label="players" scale={0.82} />
      </div>
      <div style={{ position: 'absolute', bottom: 60 }}>
        <Tagline startAt={26} size={44} />
      </div>
    </AbsoluteFill>
  );
};

// ===========================================================================
// S8 — provably fair
const Lock: React.FC<{ startAt?: number }> = ({ startAt = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - startAt, fps, config: { damping: 10, stiffness: 150 } });
  const sc = interpolate(s, [0, 1], [0, 1.06], { extrapolateRight: 'clamp' });
  return (
    <svg width={96} height={96} viewBox="0 0 24 24" style={{ transform: `scale(${sc})` }}>
      <rect x="4" y="10" width="16" height="11" rx="2.5" fill={COLORS.brandBlue} />
      <path d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10" fill="none" stroke={COLORS.brandBlue} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="15" r="1.7" fill="#fff" />
      <rect x="11.2" y="15" width="1.6" height="3.4" rx="0.8" fill="#fff" />
    </svg>
  );
};

const ProvablyFair: React.FC = () => {
  const frame = useCurrentFrame();
  const wipe = interpolate(frame, [18, 32], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 26 }}>
      <Lock startAt={4} />
      <div style={{ textAlign: 'center' }}>
        <Line startAt={0} delay={4} size={50} weight={W.fett} color={COLORS.inkSoft}>Answer committed onchain</Line>
        <Line startAt={0} delay={8} size={50} weight={W.fett} color={COLORS.inkSoft}>before the round.</Line>
      </div>
      <div style={{ position: 'relative', paddingBottom: 14 }}>
        <Line startAt={0} delay={12} size={78} weight={W.black}>Provably fair.</Line>
        <div style={{ position: 'absolute', left: 0, bottom: 0, height: 6, width: '100%', background: COLORS.brandBlue, borderRadius: 3, transform: `scaleX(${wipe})`, transformOrigin: 'left' }} />
      </div>
    </AbsoluteFill>
  );
};

// ===========================================================================
// S9 — end CTA (tagline meets in the middle)
const EndCta: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const iconS = spring({ frame, fps, config: { damping: 11, stiffness: 140, mass: 0.8 } });
  const iconSc = interpolate(iconS, [0, 1], [0.6, 1]);
  const meet = spring({ frame: frame - 8, fps, config: { damping: 16, stiffness: 120 } });
  const leftX = interpolate(meet, [0, 1], [-160, 0]);
  const rightX = interpolate(meet, [0, 1], [160, 0]);
  const tagOp = interpolate(frame - 8, [0, 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const subOp = interpolate(frame - 30, [0, 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 30 }}>
      <Img src={staticFile('LHAW-icon.png')} style={{ width: 188, height: 188, borderRadius: 40, transform: `scale(${iconSc})`, boxShadow: '0 22px 50px -14px rgba(45,104,199,0.5)' }} />
      <div style={{ fontFamily: FONT, fontWeight: W.black, fontSize: 78, color: COLORS.ink, letterSpacing: '-0.02em', opacity: interpolate(frame - 6, [0, 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
        Let&rsquo;s Have A Word!
      </div>
      <div style={{ display: 'flex', gap: '0.28em', fontFamily: FONT, fontWeight: W.fett, fontSize: 64, opacity: tagOp }}>
        <span style={{ color: COLORS.taglineBlue, transform: `translateX(${leftX}px)`, display: 'inline-block' }}>GUESS WORDS.</span>
        <span style={{ color: COLORS.taglineDeep, transform: `translateX(${rightX}px)`, display: 'inline-block' }}>WIN CRYPTO.</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: subOp, marginTop: 6 }}>
        <span style={{ fontFamily: FONT, fontWeight: W.fett, fontSize: 38, color: COLORS.white, background: COLORS.brandBlue, padding: '12px 30px', borderRadius: 9999 }}>Play on Farcaster</span>
        <span style={{ fontFamily: FONT, fontWeight: W.kraftig, fontSize: 38, color: COLORS.accentPurple }}>@letshaveaword</span>
      </div>
    </AbsoluteFill>
  );
};

// ===========================================================================
export const Promo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bgOuter }}>
      <Background />
      <Sequence from={S.money[0]} durationInFrames={dur('money')} name="S1 money"><MoneyHook /></Sequence>
      <Sequence from={S.same[0]} durationInFrames={dur('same')} name="S2 same word"><SameWordHook /></Sequence>
      <Sequence from={S.type[0]} durationInFrames={dur('type')} name="S3 type"><TypeGuess /></Sequence>
      <Sequence from={S.elim[0]} durationInFrames={dur('elim')} name="S4 eliminated"><EliminatedFlip /></Sequence>
      <Sequence from={S.wheel[0]} durationInFrames={dur('wheel')} name="S5/6 wheel"><WheelScene /></Sequence>
      <Sequence from={S.s5cap[0]} durationInFrames={dur('s5cap')} name="S5 caption">
        <WheelCaption a="WRONG GUESSES SPIN" b={<>ONTO A <span style={{ color: COLORS.accentPurple }}>SHARED</span> WHEEL</>} />
      </Sequence>
      <Sequence from={S.s6cap[0]} durationInFrames={dur('s6cap')} name="S6 caption">
        <WheelCaption a="ONE PLAYER" b="HITS THE WORD" />
      </Sequence>
      <Sequence from={S.payout[0]} durationInFrames={dur('payout')} name="S7 payout"><PayoutCard /></Sequence>
      <Sequence from={S.fair[0]} durationInFrames={dur('fair')} name="S8 fair"><ProvablyFair /></Sequence>
      <Sequence from={S.cta[0]} durationInFrames={dur('cta')} name="S9 cta"><EndCta /></Sequence>
    </AbsoluteFill>
  );
};
