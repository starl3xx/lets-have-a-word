import { useState, useMemo, useEffect } from 'react';
import sdk from '@farcaster/miniapp-sdk';
import type { SubmitGuessResult } from '../src/types';
import { haptics } from '../src/lib/haptics';
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
  const [isSharing, setIsSharing] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [prizePoolEth, setPrizePoolEth] = useState<string>('0.0000');

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
   * Handle share action - opens composer
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

      // Mark as seen and close
      markInstallPromptSeen();

      // Try to verify share and award bonus
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
        onClose();
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
        {/* Header */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">
            Get another guess
          </h2>
          <p className="text-gray-600 mt-2">
            {word ? (
              <>
                <span className="font-bold">{word.toUpperCase()}</span> wasn't the word, but you're in the hunt!
              </>
            ) : (
              <>You're in the hunt!</>
            )}
          </p>
        </div>

        {/* Primary action: Share */}
        <div className="flex flex-col gap-3">
          <button
            onClick={handleShare}
            disabled={isSharing || isInstalling}
            className={`btn-accent w-full text-lg flex items-center justify-center gap-3 ${
              (isSharing || isInstalling) ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {!isSharing && (
              <img src="/FC-arch-icon.png" alt="Farcaster" className="w-3 h-3" />
            )}
            <span>
              {isSharing ? 'Opening...' : 'Share your guess → +1 guess'}
            </span>
          </button>
        </div>

        {/* Secondary: Install section - framed as utility */}
        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs text-gray-500 text-center mb-3">
            Want to know when rounds end or guesses reset?
          </p>
          <button
            onClick={handleInstall}
            disabled={isSharing || isInstalling}
            className={`w-full text-sm text-gray-500 hover:text-gray-700 transition-colors flex items-center justify-center gap-1 ${
              (isSharing || isInstalling) ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <span>
              {isInstalling ? 'Installing...' : 'Enable notifications'}
            </span>
          </button>
        </div>

        {/* Tertiary: Skip */}
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
