/**
 * WordmarkDetailModal Component
 *
 * Tap a Wordmark in the Lexicon — held or not — and see what it means:
 * how it's earned, how rare it is, and (when held) the story of the earn
 * from the award metadata. Unheld marks show the goal, which is the point:
 * the Lexicon reads as a collection with visible goals, not a row of icons.
 *
 * Metadata shapes vary by mark and era (old awards can miss keys), so every
 * detail line degrades to nothing rather than to a broken sentence.
 *
 * Rendered through a portal to document.body: a `position: fixed` overlay
 * inside the Stats sheet's `overflow-y-auto` container is mispositioned or
 * clipped on mobile WebKit (the Farcaster/Base webviews). React portals
 * still bubble events through the REACT tree, so the overlay's own
 * stopPropagation keeps clicks from ever reaching the sheet's backdrop.
 */
import { createPortal } from 'react-dom';
import sdk from '@farcaster/miniapp-sdk';
import { withHostTimeout } from '../src/lib/hostActions';
import type { UserWordmark } from '../src/lib/wordmarks';
import { WORDMARK_COLORS, WORDMARK_COLOR_FALLBACK } from './wordmark-display';
import { triggerHaptic, haptics } from '../src/lib/haptics';

interface WordmarkDetailModalProps {
  wordmark: UserWordmark;
  onClose: () => void;
}

/** Uppercase a guessed word from metadata, defensively. */
function word(meta: Record<string, unknown>, key = 'word'): string | null {
  const value = meta[key];
  return typeof value === 'string' && value.length > 0 ? value.toUpperCase() : null;
}

function num(meta: Record<string, unknown>, key: string): number | null {
  const value = meta[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The story of the earn, per mark, from award metadata. Returns null when
 * the metadata can't support the sentence (old rows, missing keys).
 */
function earnedDetail(wordmark: UserWordmark): string | null {
  const meta = wordmark.metadata;
  if (!meta) return null;
  const roundId = num(meta, 'roundId');

  switch (wordmark.id) {
    case 'JACKPOT_WINNER': {
      const w = word(meta);
      if (roundId && w) return `Won Round ${roundId} with “${w}”`;
      return roundId ? `Won Round ${roundId}` : null;
    }
    case 'BONUS_WORD_FINDER': {
      const w = word(meta);
      if (roundId && w) return `Hooked “${w}” in Round ${roundId}`;
      return roundId ? `First bonus word in Round ${roundId}` : null;
    }
    case 'BURN_WORD_FINDER': {
      const w = word(meta);
      if (roundId && w) return `Burned “${w}” in Round ${roundId}`;
      return roundId ? `First burn word in Round ${roundId}` : null;
    }
    case 'DOUBLE_W': {
      const bonus = num(meta, 'bonusWordsFound') ?? 0;
      const burn = num(meta, 'burnWordsFound') ?? 0;
      const secret = meta.foundSecretWord === true;
      if (!roundId) return null;
      const parts = [];
      if (bonus > 0) parts.push(`${bonus} bonus`);
      if (burn > 0) parts.push(`${burn} burn`);
      if (secret) parts.push('the jackpot');
      return parts.length >= 2 ? `Round ${roundId}: ${parts.join(' + ')}` : `Earned in Round ${roundId}`;
    }
    case 'PATRON':
      return roundId ? `Your referral won Round ${roundId}` : null;
    case 'QUICKDRAW': {
      const rank = num(meta, 'rank');
      if (roundId && rank) return `#${rank} early guesser in Round ${roundId}`;
      return roundId ? `Top 10 early guesser in Round ${roundId}` : null;
    }
    case 'ENCYCLOPEDIC':
      return 'A to Z, all 26 first letters';
    case 'BAKERS_DOZEN': {
      const days = num(meta, 'distinctDays');
      const letters = num(meta, 'distinctLetters');
      return days && letters ? `${days} days played, ${letters} letters` : null;
    }
    case 'TRAILBLAZER':
      return roundId ? `Guess #1 of Round ${roundId}` : null;
    case 'EARLY_ADOPTER': {
      const first = num(meta, 'firstGuessRound');
      return first ? `Your first guess was in Round ${first}` : null;
    }
    case 'SHOWSTOPPER':
      return roundId ? `Superguess in Round ${roundId}` : null;
    default:
      return null;
  }
}

/**
 * The "by …" clause of the share cast, per mark. Generic on purpose — the
 * cast should read well for every holder — except where a roundId makes the
 * brag concrete and the metadata reliably has one.
 */
function sharePhrase(wordmark: UserWordmark): string {
  const roundId = wordmark.metadata ? num(wordmark.metadata, 'roundId') : null;

  switch (wordmark.id) {
    case 'OG_HUNTER':
      return 'by joining the OG Hunter campaign before launch';
    case 'BONUS_WORD_FINDER':
      return 'by finding a bonus word';
    case 'BURN_WORD_FINDER':
      return 'by finding a burn word';
    case 'JACKPOT_WINNER':
      return roundId ? `by winning Round ${roundId}’s jackpot` : 'by winning a round’s jackpot';
    case 'DOUBLE_W':
      return 'by finding two special words in one round';
    case 'PATRON':
      return 'by referring a jackpot winner';
    case 'QUICKDRAW':
      return 'by placing in a round’s Top 10 Early Guessers';
    case 'ENCYCLOPEDIC':
      return 'by guessing words starting with every letter, A to Z';
    case 'BAKERS_DOZEN':
      return 'by guessing words starting with 13 different letters across 13 different days';
    case 'SHOWSTOPPER':
      return 'by firing off a Superguess';
    case 'EARLY_ADOPTER':
      return 'by playing in the first 18 rounds';
    case 'TRAILBLAZER':
      return roundId
        ? `by making Round ${roundId}’s #1 global guess`
        : 'by making a round’s #1 global guess';
    default:
      return `by earning it`;
  }
}

/** "Only N other players hold this Wordmark" — self excluded from the count. */
function shareRarityClause(holders: number): string {
  const others = holders - 1;
  if (others <= 0) return 'I’m the only player who holds this Wordmark';
  if (others === 1) return 'Only 1 other player holds this Wordmark';
  if (others < 1000) return `Only ${others} other players hold this Wordmark`;
  return `${others.toLocaleString()} other players hold this Wordmark`;
}

function rarityLine(wordmark: UserWordmark): string {
  const n = wordmark.holders;
  if (n === 0) return 'No one holds this yet... be the first!';
  if (n === 1) return wordmark.earned ? 'You’re the only player with this 👑' : 'Only 1 player holds this';
  if (n <= 50) return `Only ${n} players hold this`;
  return `Held by ${n.toLocaleString()} players`;
}

function formatEarnedDate(earnedAt: Date | string | undefined): string | null {
  if (!earnedAt) return null;
  const date = new Date(earnedAt);
  if (isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function WordmarkDetailModal({ wordmark, onClose }: WordmarkDetailModalProps) {
  const colors = WORDMARK_COLORS[wordmark.color] || WORDMARK_COLOR_FALLBACK;
  const detail = wordmark.earned ? earnedDetail(wordmark) : null;
  const earnedDate = wordmark.earned ? formatEarnedDate(wordmark.earnedAt) : null;
  const earnedRound =
    (wordmark.earned ? wordmark.earnedRoundId : null) ??
    (wordmark.earned && wordmark.metadata ? num(wordmark.metadata, 'roundId') : null);

  const handleShare = async () => {
    try {
      void haptics.buttonTapMinor();

      const castText =
        `I earned the “${wordmark.name}” Wordmark in @letshaveaword ${sharePhrase(wordmark)}! ` +
        `${shareRarityClause(wordmark.holders)}\n` +
        `letshaveaword.fun`;

      await withHostTimeout(
        sdk.actions.composeCast({
          text: castText,
          embeds: ['https://letshaveaword.fun'],
        }),
        'composeCast'
      );

      void haptics.shareCompleted();
    } catch (error) {
      console.error('[WordmarkDetailModal] Error sharing wordmark:', error);
      triggerHaptic('error');
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-6"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="bg-white rounded-card shadow-modal max-w-xs w-full p-6 text-center space-y-3 wordmark-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center text-3xl ${
            wordmark.earned ? colors.bg : 'bg-gray-200'
          }`}
          style={{
            boxShadow: wordmark.earned ? `0 0 0 3px ${colors.ring}` : '0 0 0 2px #d1d5db',
            filter: wordmark.earned ? undefined : 'grayscale(60%)',
          }}
        >
          <span role="img" aria-label={wordmark.name}>{wordmark.emoji}</span>
        </div>

        <div>
          <h3 className="text-lg font-bold text-gray-900">{wordmark.name}</h3>
          {wordmark.earned ? (
            <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-medium">
              Earned{earnedRound ? ` · Round ${earnedRound}` : ''}{earnedDate ? ` · ${earnedDate}` : ''}
            </span>
          ) : (
            <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">
              Not yet earned
            </span>
          )}
        </div>

        <p className="text-sm text-gray-600">{wordmark.description}</p>

        {detail && (
          <p className="text-sm font-medium text-gray-900">{detail}</p>
        )}

        <p className="text-xs text-gray-400">{rarityLine(wordmark)}</p>

        {wordmark.earned ? (
          <div className="flex gap-3">
            <button
              onClick={handleShare}
              className="btn-accent flex-1 flex items-center justify-center gap-2"
            >
              <img src="/FC-arch-icon.png" alt="Farcaster" className="w-3 h-3" />
              Share
            </button>
            <button onClick={onClose} className="btn-primary-lg flex-1">
              Nice 👌
            </button>
          </div>
        ) : (
          <button onClick={onClose} className="btn-primary-lg w-full">
            Challenge accepted 🫡
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
