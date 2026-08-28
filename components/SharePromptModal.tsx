import { useState, useMemo, useEffect } from 'react';
import { formatPrize } from '../src/lib/prize-display';
import { useReloadHold } from '../src/lib/buildFreshness';
import { withHostTimeout, openXComposer, HOST_COMPOSE_TIMEOUT_MS } from '../src/lib/hostActions';
import { useIsInMiniApp } from '../src/hooks/useIsInMiniApp';
import { playerSessionHeaders } from '../src/lib/playerSessionClient';
import { X_HANDLE, FARCASTER_HANDLE } from '../config/economy';
import sdk from '@farcaster/miniapp-sdk';
import type { SubmitGuessResult } from '../src/types';
import { haptics } from '../src/lib/haptics';
import { useTranslation } from '../src/hooks/useTranslation';
import { getRandomTemplate, renderShareTemplate } from '../src/lib/shareTemplates';

interface SharePromptModalProps {
  fid: number | null;
  /** Quick Auth token. share-callback is authenticated now, so a Farcaster
   *  player must present one or their bonus cannot be awarded. */
  authToken?: string | null;
  guessResult?: SubmitGuessResult;
  onClose: () => void;
  onShareSuccess: () => void;
}

/**
 * SharePromptModal
 * Milestone 4.2, Updated Milestone 6.3, Updated Milestone 7.0
 *
 * Prompts user to share to Farcaster to earn +1 free guess.
 *
 * Milestone 7.0: Visual polish
 * - Uses unified design token classes
 * - Consistent button styling
 */
export default function SharePromptModal({
  fid,
  authToken,
  guessResult,
  onClose,
  onShareSuccess,
}: SharePromptModalProps) {
  const { t, getRandomInterjection } = useTranslation();
  const { inMiniApp, resolved } = useIsInMiniApp();
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prizePoolEth, setPrizePoolEth] = useState<string>('0.0000');
  const [prizeCurrency, setPrizeCurrency] = useState<'eth' | 'word'>('eth');
  const [prizePoolWord, setPrizePoolWord] = useState<string | undefined>(undefined);
  const [roundStats, setRoundStats] = useState<{
    roundId: number;
    guesses: number;
    players: number;
  } | null>(null);

  // Get random interjection once when modal mounts
  const interjection = useMemo(() => getRandomInterjection(), [getRandomInterjection]);

  // Milestone 8.1: Select random share template once when modal mounts
  // This ensures the template doesn't change during the share flow
  const selectedTemplate = useMemo(() => getRandomTemplate(), []);

  // Fetch round state (prize pool + stats for dynamic OG embed)
  useEffect(() => {
    const fetchRoundState = async () => {
      try {
        const [roundRes, guessersRes] = await Promise.all([
          fetch('/api/round-state'),
          fetch('/api/round/top-guessers'),
        ]);
        if (roundRes.ok) {
          const data = await roundRes.json();
          if (data.prizePoolEth) setPrizePoolEth(data.prizePoolEth);
          if (data.prizeCurrency) setPrizeCurrency(data.prizeCurrency);
          if (data.prizePoolWord) setPrizePoolWord(data.prizePoolWord);
          if (data.roundId) {
            setRoundStats(prev => ({
              roundId: data.roundId,
              guesses: data.globalGuessCount || 0,
              players: prev?.players || 0,
            }));
          }
        }
        if (guessersRes.ok) {
          const data = await guessersRes.json();
          if (data.uniqueGuessersCount != null) {
            setRoundStats(prev => prev ? { ...prev, players: data.uniqueGuessersCount } : prev);
          }
        }
      } catch (err) {
        console.error('[SharePromptModal] Error fetching round state:', err);
      }
    };
    fetchRoundState();
  }, []);

  /**
   * Get the guessed word from the result (if available)
   */
  const getGuessedWord = (): string | null => {
    if (!guessResult) return null;
    if (guessResult.status === 'incorrect' || guessResult.status === 'correct') {
      return guessResult.word;
    }
    return null;
  };

  /**
   * Get the global guess number for this user's round
   */
  const getGuessNumber = (): number | null => {
    if (!guessResult) return null;
    if (guessResult.status === 'incorrect') {
      return guessResult.totalGuessesForUserThisRound;
    }
    return null;
  };

  /**
   * Get the round ID
   */
  const getRoundId = (): number | null => {
    if (!guessResult) return null;
    if (guessResult.status === 'correct') {
      return guessResult.roundId;
    }
    return null;
  };

  /**
   * The prize with its unit, e.g. "0.0216 ETH" or "78,125,000 $WORD".
   *
   * The unit is part of the value rather than hardcoded in the templates,
   * because the share text is public — a $WORD round advertising an ETH prize
   * would be wrong on nine different casts.
   */
  const formatJackpot = (): string =>
    formatPrize({
      currency: prizeCurrency,
      eth: prizePoolEth ? parseFloat(prizePoolEth).toFixed(4) : '0.0000',
      word: prizePoolWord,
    });

  /**
   * Get the share text using selected template
   * Milestone 8.1: Uses rotating templates with dynamic values
   */
  const getShareText = (): string => {
    const word = getGuessedWord();
    const jackpot = formatJackpot();

    // If we have a word (incorrect guess), use the rotating template
    if (word) {
      return renderShareTemplate(selectedTemplate, word, jackpot);
    }

    // Fallback for cases without a word (URL provided via embed)
    return `I'm playing Let's Have A Word! 🔤\n\nDaily jackpot-based word puzzle on Base.\n\n@letshaveaword`;
  };

  // Memoize the share text so it doesn't change during the modal session
  const shareText = useMemo(() => getShareText(), [selectedTemplate, guessResult, prizePoolEth, prizeCurrency, prizePoolWord]);

  /**
   * Build the dynamic embed URL with word + round stats for OG image
   * Falls back to base URL if word or stats aren't available
   */
  const getEmbedUrl = (): string => {
    // Only generate dynamic OG for incorrect guesses (correct guesses use WinnerShareCard)
    if (!guessResult || guessResult.status !== 'incorrect') return 'https://letshaveaword.fun';
    const word = guessResult.word;
    if (!word || !roundStats) return 'https://letshaveaword.fun';

    const params = new URLSearchParams({
      round: String(roundStats.roundId),
      jackpot: formatJackpot(),
      guesses: String(roundStats.guesses),
      players: String(roundStats.players),
    });
    return `https://letshaveaword.fun/share/${word.toUpperCase()}?${params}`;
  };

  // Pre-warm the OG image on Vercel's CDN so it's cached before the crawler hits it
  // (cold start + Satori render can take 2-3s, which may exceed crawler timeouts)
  const embedUrl = getEmbedUrl();
  useEffect(() => {
    if (!roundStats || !guessResult || guessResult.status !== 'incorrect') return;
    const word = guessResult.word;
    if (!word) return;
    const params = new URLSearchParams({
      word: word.toUpperCase(),
      round: String(roundStats.roundId),
      jackpot: formatJackpot(),
      guesses: String(roundStats.guesses),
      players: String(roundStats.players),
    });
    fetch(`/api/og/share?${params}`, { method: 'HEAD' }).catch(() => {});
  }, [roundStats, guessResult, prizePoolEth]);

  // State for verification flow
  const [hasOpenedComposer, setHasOpenedComposer] = useState(false);
  const [verificationAttempts, setVerificationAttempts] = useState(0);
  const MAX_VERIFICATION_ATTEMPTS = 5;

  // A stale-runtime reload between composeCast and the share-callback POST
  // silently drops the bonus claim — the composer backgrounds the page, which
  // is exactly when automatic reloads fire. Held until the modal unmounts,
  // which releases via the effect cleanup.
  useReloadHold(isSharing || hasOpenedComposer);

  /**
   * Verify the cast was posted
   */
  const verifyShare = async (): Promise<boolean> => {
    try {
      // CREDENTIALS, not a claimed fid. The endpoint authenticates now: a
      // Farcaster player presents their Quick Auth token, a wallet player
      // their session header. `fid` is no longer read from the body at all.
      const response = await fetch('/api/share-callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...playerSessionHeaders() },
        body: JSON.stringify({ authToken }),
      });

      const data = await response.json();

      if (data.ok && data.verified !== false) {
        console.log('[SharePromptModal] Share bonus awarded!', data);
        void haptics.shareCompleted();
        onShareSuccess();
        onClose();
        return true;
      } else if (data.verified === false) {
        // Cast not found yet - can retry
        console.log('[SharePromptModal] Cast not verified yet:', data.message);
        return false;
      } else if (data.message?.includes('already claimed')) {
        // Already has bonus - close modal
        console.log('[SharePromptModal] Already claimed today');
        onClose();
        return true;
      } else {
        setError(data.message || 'Failed to verify share');
        return false;
      }
    } catch (err) {
      console.error('[SharePromptModal] Error verifying share:', err);
      setError('Failed to verify share');
      return false;
    }
  };

  /**
   * Handle opening the share composer
   */
  const handleOpenComposer = async () => {
    if (!fid) {
      setError('Unable to share: Not authenticated');
      return;
    }

    void haptics.buttonTapMinor();
    setIsSharing(true);
    setError(null);

    try {
      console.log('[SharePromptModal] Opening composer with text:', shareText);

      // OFF-HOST: share to X, and the bonus is awarded on the intent. A wallet
      // player cannot cast, so verifyRecentShareCast can never find anything
      // for them — waiting to "verify" would mean a bonus they can never earn.
      // The server bounds this the same way it bounds everyone: idempotent per
      // FID per UTC day, so the ceiling is the +1 a Farcaster player gets.
      if (!inMiniApp && (resolved || !(await sdk.isInMiniApp()))) {
        openXComposer(shareText.replace(FARCASTER_HANDLE, X_HANDLE), embedUrl);
        setHasOpenedComposer(true);
        const awarded = await verifyShare();
        if (!awarded) setError('Could not add your free guess. Try again in a moment.');
        setIsSharing(false);
        return;
      }

      await withHostTimeout(
        sdk.actions.composeCast({
          text: shareText,
          embeds: [embedUrl],
        }),
        'composeCast',
        HOST_COMPOSE_TIMEOUT_MS
      );

      console.log('[SharePromptModal] Composer opened');
      setHasOpenedComposer(true);

      // Wait for cast to propagate then verify
      setTimeout(async () => {
        setVerificationAttempts(1);
        const verified = await verifyShare();
        if (!verified) {
          setError("Couldn't find your cast yet.");
        }
        setIsSharing(false);
      }, 4000);
    } catch (err) {
      console.error('[SharePromptModal] Error opening composer:', err);
      setError('Failed to open share dialog');
      setIsSharing(false);
    }
  };

  /**
   * Handle retry verification
   */
  const handleRetryVerification = async () => {
    if (verificationAttempts >= MAX_VERIFICATION_ATTEMPTS) {
      setError('Maximum attempts reached. Please try again later.');
      return;
    }

    setIsSharing(true);
    setError(null);
    setVerificationAttempts((prev) => prev + 1);

    const verified = await verifyShare();
    if (!verified && verificationAttempts < MAX_VERIFICATION_ATTEMPTS - 1) {
      setError("Couldn't find your cast yet.");
    }
    setIsSharing(false);
  };

  /**
   * Main share handler - either opens composer or retries verification
   */
  const handleShare = async () => {
    if (hasOpenedComposer) {
      await handleRetryVerification();
    } else {
      await handleOpenComposer();
    }
  };

  const word = getGuessedWord();

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-card shadow-modal max-w-md w-full p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with interjection */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">
            {interjection} {t('shareForGuess.titleSuffix')}
          </h2>
          <p className="text-gray-600 mt-3">
            {word ? (
              <>
                Share your guess <span className="font-bold">{word.toUpperCase()}</span> to unlock{' '}
                <span className="font-bold text-success-600">+1 free guess</span> today!
              </>
            ) : (
              <>
                Share to unlock <span className="font-bold text-success-600">+1 free guess</span> today!
              </>
            )}
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="bg-error-50 border border-error-200 rounded-btn p-3">
            <p className="text-sm text-error-700 text-center">{error}</p>
          </div>
        )}

        {/* Buttons */}
        <div className="flex flex-col gap-3">
          {/* Primary CTA button */}
          <button
            onClick={handleShare}
            disabled={isSharing}
            className={`btn-accent w-full text-lg flex items-center justify-center gap-3 ${
              isSharing ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {!isSharing && !hasOpenedComposer && (
              <img src="/FC-arch-icon.png" alt="Farcaster" className="w-3 h-3" />
            )}
            <span>
              {isSharing
                ? hasOpenedComposer
                  ? 'Checking...'
                  : t('shareForGuess.sharing')
                : hasOpenedComposer
                  ? 'Check again'
                  : t('shareForGuess.ctaButton')}
            </span>
          </button>

          {/* Secondary button. NEVER disabled by the share button's pending
              state: a way out must not depend on another control succeeding.
              While composeCast hung off-host this was the difference between a
              modal and a trap, with a backdrop tap the only escape. */}
          <button onClick={onClose} className="btn-secondary w-full">
            {t('anotherGuess.notNow')}
          </button>
        </div>

        {/* Footer info */}
        <p className="text-xs text-gray-500 text-center">
          {t('shareForGuess.footer')}
        </p>
      </div>
    </div>
  );
}
