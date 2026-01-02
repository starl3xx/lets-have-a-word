import { useState, useMemo, useEffect } from 'react';
import sdk from '@farcaster/miniapp-sdk';
import type { SubmitGuessResult } from '../src/types';
import { haptics } from '../src/lib/haptics';
import { useTranslation } from '../src/hooks/useTranslation';
import { getRandomTemplate, renderShareTemplate } from '../src/lib/shareTemplates';

interface InstallPromptModalProps {
  fid: number | null;
  guessResult?: SubmitGuessResult;
  onClose: () => void;
  onShareSuccess: () => void;
  onInstallSuccess: () => void;
}

const INSTALL_PROMPT_SEEN_KEY = 'lhaw_seen_install_prompt';

/**
 * Check if user has already seen the install prompt
 */
export function hasSeenInstallPrompt(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(INSTALL_PROMPT_SEEN_KEY) === 'true';
}

/**
 * Mark install prompt as seen
 */
export function markInstallPromptSeen(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(INSTALL_PROMPT_SEEN_KEY, 'true');
}

/**
 * InstallPromptModal
 *
 * One-time post-guess prompt for users who haven't installed the mini app.
 * Shows after first successful guess with two CTAs:
 * - Primary: Share your guess (opens composer)
 * - Secondary: Install mini app (enables notifications)
 *
 * Once dismissed or installed, never shows again (tracked via localStorage).
 */
export default function InstallPromptModal({
  fid,
  guessResult,
  onClose,
  onShareSuccess,
  onInstallSuccess,
}: InstallPromptModalProps) {
  const { t, getRandomInterjection } = useTranslation();
  const [isSharing, setIsSharing] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [hasSharedSuccessfully, setHasSharedSuccessfully] = useState(false);
  const [prizePoolEth, setPrizePoolEth] = useState<string>('0.0000');

  // Get random interjection once when modal mounts
  const interjection = useMemo(() => getRandomInterjection(), [getRandomInterjection]);

  // Select random share template once when modal mounts
  const selectedTemplate = useMemo(() => getRandomTemplate(), []);

  // Fetch prize pool when modal mounts
  useEffect(() => {
    const fetchPrizePool = async () => {
      try {
        const response = await fetch('/api/round-state');
        if (response.ok) {
          const data = await response.json();
          if (data.prizePoolEth) {
            setPrizePoolEth(data.prizePoolEth);
          }
        }
      } catch (err) {
        console.error('[InstallPromptModal] Error fetching prize pool:', err);
      }
    };
    fetchPrizePool();
  }, []);

  /**
   * Get the guessed word from the result
   */
  const getGuessedWord = (): string | null => {
    if (!guessResult) return null;
    if (guessResult.status === 'incorrect' || guessResult.status === 'correct') {
      return guessResult.word;
    }
    return null;
  };

  /**
   * Format jackpot ETH for display
   */
  const formatJackpotEth = (eth: string | undefined): string => {
    if (!eth) return '0.0000';
    const num = parseFloat(eth);
    if (isNaN(num)) return '0.0000';
    return num.toFixed(4);
  };

  /**
   * Get the share text using selected template
   */
  const getShareText = (): string => {
    const word = getGuessedWord();
    const jackpot = formatJackpotEth(prizePoolEth);

    if (word) {
      return renderShareTemplate(selectedTemplate, word, jackpot);
    }

    return `I'm playing Let's Have A Word!\n\nDaily jackpot-based word puzzle on Base.\n\n@letshaveaword`;
  };

  const shareText = useMemo(() => getShareText(), [selectedTemplate, guessResult, prizePoolEth]);

  /**
   * Handle share action - opens composer, then transitions to success state
   */
  const handleShare = async () => {
    if (!fid) {
      console.error('[InstallPromptModal] No FID available');
      return;
    }

    void haptics.buttonTapMinor();
    setIsSharing(true);

    try {
      await sdk.actions.composeCast({
        text: shareText,
        embeds: ['https://letshaveaword.fun'],
      });

      // Mark as seen
      markInstallPromptSeen();

      // Try to verify share and award bonus, then transition to success state
      setTimeout(async () => {
        try {
          const response = await fetch('/api/share-callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fid }),
          });
          const data = await response.json();
          if (data.ok && data.verified !== false) {
            void haptics.shareCompleted();
            onShareSuccess();
          }
        } catch (err) {
          console.error('[InstallPromptModal] Error verifying share:', err);
        }
        // Transition to success state instead of closing
        setIsSharing(false);
        setHasSharedSuccessfully(true);
      }, 4000);
    } catch (err) {
      console.error('[InstallPromptModal] Error opening composer:', err);
      setIsSharing(false);
    }
  };

  /**
   * Handle install action - prompts to add mini app
   */
  const handleInstall = async () => {
    void haptics.buttonTapMinor();
    setIsInstalling(true);

    try {
      const result = await sdk.actions.addMiniApp();
      const notificationsEnabled = !!result.notificationDetails;

      // Record the add
      if (fid) {
        try {
          await fetch('/api/og-hunter/record-add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fid }),
          });
        } catch (err) {
          console.error('[InstallPromptModal] Failed to record add:', err);
        }
      }

      // Log analytics
      fetch('/api/analytics/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'post_guess_install_accepted',
          userId: fid?.toString(),
          data: { notificationsEnabled },
        }),
      }).catch(() => {});

      void haptics.shareBonusUnlocked();
      markInstallPromptSeen();
      onInstallSuccess();
      onClose();
    } catch (error) {
      console.log('[InstallPromptModal] Install declined:', error);
      // Log skip
      fetch('/api/analytics/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'post_guess_install_declined',
          userId: fid?.toString(),
        }),
      }).catch(() => {});
      setIsInstalling(false);
    }
  };

  /**
   * Handle dismiss - mark as seen and close
   */
  const handleDismiss = () => {
    void haptics.buttonTapMinor();
    markInstallPromptSeen();

    // Log skip
    fetch('/api/analytics/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: 'post_guess_install_dismissed',
        userId: fid?.toString(),
      }),
    }).catch(() => {});

    onClose();
  };

  const word = getGuessedWord();

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={handleDismiss}
    >
      <div
        className="bg-white rounded-card shadow-modal max-w-md w-full p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with interjection */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">
            {hasSharedSuccessfully ? '+1 guess unlocked 🎉' : `${interjection} ${t('shareForGuess.titleSuffix')}`}
          </h2>
          {!hasSharedSuccessfully && (
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
          )}
        </div>

        {/* Share button - transforms to success state after sharing */}
        <button
          onClick={handleShare}
          disabled={isSharing || isInstalling || hasSharedSuccessfully}
          className={`w-full text-lg flex items-center justify-center gap-3 ${
            hasSharedSuccessfully
              ? 'bg-green-500 text-white rounded-btn py-3 px-4 font-semibold cursor-default'
              : `btn-accent ${(isSharing || isInstalling) ? 'opacity-50 cursor-not-allowed' : ''}`
          }`}
        >
          {!isSharing && !hasSharedSuccessfully && (
            <img src="/FC-arch-icon.png" alt="Farcaster" className="w-3 h-3" />
          )}
          <span>
            {hasSharedSuccessfully ? '+1 guess granted' : isSharing ? 'Opening…' : 'Share your guess'}
          </span>
        </button>

        {/* Install section */}
        <div className="bg-gray-50 rounded-lg p-4 space-y-2">
          <p className="text-sm text-gray-700 font-medium">
            Install the mini app to get notified when:
          </p>
          <ul className="text-sm text-gray-600 space-y-1">
            <li className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              Someone finds the word (round ends)
            </li>
            <li className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              Your free guesses reset daily
            </li>
          </ul>
        </div>

        {/* Install button - becomes primary after successful share */}
        <button
          onClick={handleInstall}
          disabled={isSharing || isInstalling}
          className={`w-full flex items-center justify-center gap-2 ${
            hasSharedSuccessfully
              ? `btn-accent text-lg ${isInstalling ? 'opacity-50 cursor-not-allowed' : ''}`
              : `btn-secondary ${(isSharing || isInstalling) ? 'opacity-50 cursor-not-allowed' : ''}`
          }`}
        >
          <span>
            {isInstalling ? 'Installing…' : 'Install mini app'}
          </span>
        </button>

        {/* Skip */}
        <button
          onClick={handleDismiss}
          disabled={isSharing || isInstalling}
          className="w-full text-sm text-gray-400 hover:text-gray-500 transition-colors"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
